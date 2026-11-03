// npm run bot:start
//
// Validates the config, checks the environment, generates runtime files, starts
// ViaProxy, waits for the proxy port to become ready and only then starts
// Mindcraft. Handles Ctrl+C (closes both processes and their child processes)
// and cleans up the other process when one of them fails. No restarts, no
// automatic updates.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { isPortOpen } from '../lib/net.js';
import {
    AGENT_PROFILE_PATH, EFFECTIVE_SETTINGS_PATH, LOGS_DIR, MAIN_JS_PATH, MINDCRAFT_LOG_PATH,
    REPO_ROOT, RUNTIME_DIR, VIAPROXY_LOG_PATH, VIAPROXY_RUN_DIR,
} from '../lib/paths.js';
import { resolveConfigPath, loadUserConfig, printValidationErrors, ok, err, warn, info, secretsForRedaction, resolvePathFromRepo } from '../lib/cli_common.js';
import { buildViaProxyArgs, checkJava } from '../lib/viaproxy.js';
import { buildEffectiveSettings, buildEffectiveProfile, checkProfileStructure } from '../lib/effective.js';
import { launch } from '../lib/runner.js';

const argv = process.argv.slice(2);
const configPath = resolveConfigPath(argv);
let abortHandler = null;

function onAbort() {
    if (abortHandler) abortHandler();
}

async function preflight(config) {
    let failed = false;

    // Java
    const java = await checkJava(config.proxy.javaPath);
    if (!java.ok) {
        err(java.error || 'Required Java not found.');
        failed = true;
    } else {
        ok(`Java ${java.version}`);
    }

    // ViaProxy jar
    const jarPath = resolvePathFromRepo(config.proxy.jarPath);
    if (!existsSync(jarPath)) {
        err(`ViaProxy file not found: ${jarPath}. Run "npm run bot:setup -- --download" or set proxy.jarPath.`);
        failed = true;
    } else {
        ok(`ViaProxy jar: ${jarPath}`);
    }

    // Bot profile
    const profilePath = resolvePathFromRepo(config.mindcraft.profilePath);
    if (!existsSync(profilePath)) {
        err(`Bot profile not found: ${profilePath} (mindcraft.profilePath).`);
        failed = true;
    } else {
        let profileRaw;
        try {
            profileRaw = JSON.parse(readFileSync(profilePath, 'utf8'));
            const profileCheck = checkProfileStructure(profileRaw);
            if (profileCheck.errors.length > 0) {
                for (const e of profileCheck.errors) err(`Profile ${profilePath}: ${e}`);
                failed = true;
            } else {
                ok(`Bot profile: ${profilePath}`);
            }
        } catch (e) {
            err(`Profile ${profilePath} is not valid JSON: ${e.message}`);
            failed = true;
        }
    }

    // Mindcraft dependencies
    if (!existsSync(path.join(REPO_ROOT, 'node_modules', 'mineflayer'))) {
        err('Missing dependencies (node_modules/mineflayer). Run "npm install".');
        failed = true;
    } else {
        ok('Mindcraft dependencies present (node_modules).');
    }

    // main.js
    if (!existsSync(MAIN_JS_PATH)) {
        err(`${MAIN_JS_PATH} not found - run the launcher from the Mindcraft repository directory.`);
        failed = true;
    }

    // Is the proxy port already taken by something else?
    if (await isPortOpen(config.proxy.bindHost, config.proxy.bindPort, 500)) {
        err(`Port ${config.proxy.bindHost}:${config.proxy.bindPort} is already in use by another process - free it or change proxy.bindPort.`);
        failed = true;
    }

    return !failed;
}

function prepareRuntime(config, profileRaw) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    mkdirSync(LOGS_DIR, { recursive: true });
    mkdirSync(VIAPROXY_RUN_DIR, { recursive: true });

    // Fresh logs for every session.
    for (const logPath of [VIAPROXY_LOG_PATH, MINDCRAFT_LOG_PATH]) {
        try { rmSync(logPath, { force: true }); } catch (_) { /* the log may not exist */ }
    }

    const effectiveSettings = buildEffectiveSettings(config);
    const effectiveProfile = buildEffectiveProfile(config, profileRaw);

    writeFileSync(EFFECTIVE_SETTINGS_PATH, JSON.stringify(effectiveSettings, null, 4));
    writeFileSync(AGENT_PROFILE_PATH, JSON.stringify(effectiveProfile, null, 4));
    return { effectiveSettings, effectiveProfile };
}

async function main() {
    const loaded = loadUserConfig(configPath);
    if (!loaded.ok) {
        err('The config is invalid - start aborted:');
        printValidationErrors(loaded.errors, loaded.warnings);
        return 1;
    }
    const config = loaded.config;
    for (const w of loaded.warnings) warn(w);

    // The profile is read again here (preflight validates, prepareRuntime generates).
    const profilePath = resolvePathFromRepo(config.mindcraft.profilePath);
    const profileRaw = JSON.parse(readFileSync(profilePath, 'utf8'));

    if (!(await preflight(config))) {
        err('Start aborted - fix the problems above. Diagnostics: npm run bot:doctor');
        return 1;
    }

    const { effectiveSettings, effectiveProfile } = prepareRuntime(config, profileRaw);

    // jarPath may be relative to the repo - ViaProxy starts with a different cwd,
    // so launching requires an absolute path.
    const launchConfig = { ...config, proxy: { ...config.proxy, jarPath: resolvePathFromRepo(config.proxy.jarPath) } };

    info('');
    info('Effective configuration:');
    info(`  Mindcraft  -> host: ${effectiveSettings.host}  port: ${effectiveSettings.port}  protocol version: ${effectiveSettings.minecraft_version}  auth: ${effectiveSettings.auth}`);
    info(`  Bot        -> name: ${effectiveProfile.name}  profile: ${AGENT_PROFILE_PATH}`);
    if (config.account.auth === 'microsoft') {
        info(`  ViaProxy   -> target: ${config.server.host}:${config.server.port}  version: ${config.server.version}  account: ACCOUNT[${config.account.accountIndex}]`);
    } else {
        info(`  ViaProxy   -> target: ${config.server.host}:${config.server.port}  version: ${config.server.version}  account: NONE (offline)`);
    }
    info('');

    ok('Note: Mindcraft logs may show a version mismatch warning when pinging ViaProxy - this is expected (ViaProxy advertises the target server version, the bot connects using clientVersion).');

    const result = await launch(launchConfig, {
        repoRoot: REPO_ROOT,
        mainJs: MAIN_JS_PATH,
        viaproxyRunDir: VIAPROXY_RUN_DIR,
        viaproxyLogPath: VIAPROXY_LOG_PATH,
        mindcraftLogPath: MINDCRAFT_LOG_PATH,
        agentProfilePath: AGENT_PROFILE_PATH,
    }, {
        viaproxyArgs: buildViaProxyArgs(config),
        effectiveSettings,
        secrets: secretsForRedaction(),
        // The mindserver survives agent process crashes - we detect them from the
        // log, otherwise the launcher would keep running with a broken bot.
        // Note: exit code 1 is Mindcraft's normal restart path (e.g. the UI
        // "Restart" button) - its supervisor respawns the agent with memory.
        // A broken bot is when the supervisor gives up respawning.
        agentFailurePatterns: [
            /Failed to start agent process/,
            /Agent process exited too quickly and will not be restarted/,
        ],
        registerAbort: (handler) => {
            abortHandler = handler;
            if (handler === null) {
                process.off('SIGINT', onAbort);
                process.off('SIGTERM', onAbort);
            } else {
                process.on('SIGINT', onAbort);
                process.on('SIGTERM', onAbort);
            }
        },
    });
    return result.code;
}

main().then((code) => process.exit(code)).catch((e) => {
    err(`Unexpected error: ${e.message}`);
    process.exit(1);
});
