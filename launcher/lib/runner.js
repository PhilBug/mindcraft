// Supervisor launching ViaProxy and Mindcraft as child processes.
//
// Guarantees:
//   - Mindcraft starts only after the local proxy port accepts connections
//     (bounded by proxy.startupTimeoutMs).
//   - Output of both processes is streamed with prefixes [ViaProxy] /
//     [Mindcraft] to the console and to log files (secrets redacted).
//   - Ctrl+C (SIGINT) or SIGTERM kills both process trees.
//   - If either process fails, the other is cleaned up and the failing
//     process's exit code is returned.
//   - No automatic restarts, no automatic updates.
//
// spawnImpl / waitPortImpl / killTreeImpl are injectable for tests.

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import path from 'path';
import { waitForPort } from './net.js';
import { redactLine } from './redact.js';

export const EXIT_SIGINT = 130;

// Default tree-kill: process group on POSIX (children spawn detached), taskkill on Windows.
export function killTree(child) {
    return new Promise((resolve) => {
        if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        let finished = false;
        const onExit = () => {
            if (finished) return;
            finished = true;
            clearTimeout(escalateTimer);
            resolve();
        };
        child.once('exit', onExit);
        const forceKill = () => {
            try {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
                } else {
                    process.kill(-child.pid, 'SIGKILL');
                }
            } catch (_) { /* already dead */ }
        };
        const terminate = () => {
            try {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
                } else {
                    process.kill(-child.pid, 'SIGTERM');
                }
            } catch (_) {
                try { child.kill('SIGTERM'); } catch (_) { /* already dead */ }
            }
        };
        terminate();
        const escalateTimer = setTimeout(() => {
            if (!finished) forceKill();
        }, 3000);
    });
}

// Line-buffered sink that prefixes each line and mirrors it to console and a log file.
export function createPrefixedSink({ prefix, logFilePath = null, secrets = [], onLine = () => {} }) {
    let remainder = '';
    let closed = false;
    let logStream = null;
    if (logFilePath) {
        logStream = createWriteStream(logFilePath, { flags: 'a' });
    }
    const emit = (line) => {
        const clean = redactLine(line, secrets);
        console.log(`${prefix} ${clean}`);
        if (logStream) logStream.write(`${clean}\n`);
        onLine(clean);
    };
    return {
        write(chunk) {
            remainder += chunk.toString('utf8');
            let index;
            while ((index = remainder.indexOf('\n')) !== -1) {
                const line = remainder.slice(0, index).replace(/\r$/, '');
                remainder = remainder.slice(index + 1);
                if (line.length > 0) emit(line);
            }
        },
        flush() {
            if (remainder.length > 0) {
                emit(remainder.replace(/\r$/, ''));
                remainder = '';
            }
        },
        close() {
            if (closed) return;
            closed = true;
            this.flush();
            if (logStream) logStream.end();
        },
    };
}

function spawnChild({ command, args, cwd, env, stdio }) {
    const child = spawn(command, args, {
        cwd,
        env,
        stdio: stdio || ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32', // own process group -> clean tree kill on POSIX
        windowsHide: true,
    });
    return child;
}

function wireOutput(child, sink, onClose) {
    if (child.stdout) child.stdout.on('data', (chunk) => sink.write(chunk));
    if (child.stderr) child.stderr.on('data', (chunk) => sink.write(chunk));
    const wrap = (fn) => (...args) => {
        sink.close();
        fn(...args);
    };
    return { onExit: (fn) => { child.once('exit', wrap(fn)); }, onError: (fn) => { child.once('error', wrap(fn)); } };
}

function describeExit(code, signal) {
    if (signal) return `sygnał ${signal}`;
    return `kod wyjścia ${code}`;
}

// Launches both processes and resolves with the final exit code of the launcher.
// opts.agentFailurePatterns: regexes matched against [Mindcraft] log lines - a match
// is treated as a Mindcraft failure (the mindserver would otherwise keep running
// with a broken agent, e.g. on missing API keys).
export function launch(config, paths, opts = {}) {
    const spawnImpl = opts.spawnImpl || spawnChild;
    const waitPortImpl = opts.waitPortImpl || waitForPort;
    const killTreeImpl = opts.killTreeImpl || killTree;
    const log = opts.log || ((msg) => console.log(msg));

    return new Promise((resolve) => {
        let viaproxy = null;
        let mindcraft = null;
        let finished = false;
        let aborting = false;

        const finish = (code) => {
            if (finished) return;
            finished = true;
            if (opts.registerAbort) opts.registerAbort(null); // unsubscribe
            resolve({ code });
        };

        const killBoth = async () => {
            const kills = [killTreeImpl(viaproxy), killTreeImpl(mindcraft)];
            await Promise.all(kills);
        };

        const fail = async (code, message) => {
            if (finished || aborting) return;
            if (message) log(message);
            aborting = true;
            await killBoth();
            finish(code);
        };

        // --- 1. ViaProxy ---
        const vpArgs = ['-jar', config.proxy.jarPath, ...opts.viaproxyArgs];
        log(`Starting ViaProxy: ${config.proxy.javaPath} ${vpArgs.map((a) => JSON.stringify(a)).join(' ')} (working directory: ${paths.viaproxyRunDir})`);
        let vp;
        try {
            vp = spawnImpl({ command: config.proxy.javaPath, args: vpArgs, cwd: paths.viaproxyRunDir, env: { ...process.env, VP_RUN_DIR: paths.viaproxyRunDir } });
        } catch (err) {
            finish(1, `Failed to start ViaProxy: ${err.message}`);
            return;
        }
        viaproxy = vp;
        const vpSink = createPrefixedSink({ prefix: '[ViaProxy]', logFilePath: paths.viaproxyLogPath, secrets: opts.secrets || [], onLine: opts.onViaProxyLine });
        const vpWired = wireOutput(vp, vpSink, () => {});

        vpWired.onError((err) => {
            viaproxy = null;
            fail(1, `[ViaProxy] Process error: ${err.message}`);
        });
        vpWired.onExit((code, signal) => {
            if (mindcraft === null && !aborting) {
                // proxy died before Mindcraft even started
                finish(code === 0 && !signal ? 0 : (code || 1), `[ViaProxy] Process exited (${describeExit(code, signal)}) before the proxy became ready.`);
            } else if (!aborting) {
                fail(code === 0 && !signal ? 0 : (code || 1), `[ViaProxy] Process exited unexpectedly (${describeExit(code, signal)}) - shutting down Mindcraft.`);
            }
        });

        // --- 2. Wait for the proxy port, then Mindcraft ---
        waitPortImpl({ host: config.proxy.bindHost, port: config.proxy.bindPort, timeoutMs: config.proxy.startupTimeoutMs })
            .then(async () => {
                if (finished || aborting) return;
                log(`Proxy port ${config.proxy.bindHost}:${config.proxy.bindPort} is ready - starting Mindcraft.`);
                const mcArgs = [paths.mainJs, '--profiles', paths.agentProfilePath];
                const mcEnv = { ...process.env, SETTINGS_JSON: JSON.stringify(opts.effectiveSettings) };
                let mc;
                try {
                    mc = spawnImpl({ command: process.execPath, args: mcArgs, cwd: paths.repoRoot, env: mcEnv });
                } catch (err) {
                    await fail(2, `Failed to start Mindcraft: ${err.message}`);
                    return;
                }
                mindcraft = mc;
                const mcSink = createPrefixedSink({
                    prefix: '[Mindcraft]',
                    logFilePath: paths.mindcraftLogPath,
                    secrets: opts.secrets || [],
                    onLine: (line) => {
                        if (opts.onMindcraftLine) opts.onMindcraftLine(line);
                        if (!finished && !aborting && (opts.agentFailurePatterns || []).some((re) => re.test(line))) {
                            void fail(2, `[Mindcraft] Agent failure detected - shutting down both processes (details above and in ${paths.mindcraftLogPath}).`);
                        }
                    },
                });
                const mcWired = wireOutput(mc, mcSink, () => {});
                mcWired.onError((err) => {
                    mindcraft = null;
                    fail(2, `[Mindcraft] Process error: ${err.message}`);
                });
                mcWired.onExit((code, signal) => {
                    if (!aborting) {
                        fail(code === 0 && !signal ? 0 : (code || 2), `[Mindcraft] Process exited (${describeExit(code, signal)}) - shutting down ViaProxy.`);
                    }
                });
            })
            .catch(async () => {
                await fail(1, `Proxy startup timed out after ${config.proxy.startupTimeoutMs} ms. Port ${config.proxy.bindHost}:${config.proxy.bindPort} did not accept connections. Check the logs: ${paths.viaproxyLogPath}`);
            });

        // --- 3. Abort handling (Ctrl+C / SIGTERM) ---
        if (opts.registerAbort) {
            opts.registerAbort(async () => {
                if (finished || aborting) return;
                aborting = true;
                log('Shutting down ViaProxy and Mindcraft...');
                await killBoth();
                finish(EXIT_SIGINT);
            });
        }
    });
}
