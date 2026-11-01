import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { spawn } from 'child_process';
import { waitForPort } from '../../launcher/lib/net.js';
import { createPrefixedSink, killTree, launch } from '../../launcher/lib/runner.js';

const config = {
    server: { host: 'mc.example.org', port: 25565, version: '26.3' },
    account: { username: 'Stefan', auth: 'microsoft', accountIndex: 0 },
    proxy: { bindHost: '127.0.0.1', bindPort: 25599, javaPath: 'java', jarPath: 'ViaProxy.jar', startupTimeoutMs: 5000, extraArgs: [], download: { pinVersion: 'v3.4.14' } },
    mindcraft: { clientVersion: '1.21.6', profilePath: './andy.json' },
};

const paths = {
    repoRoot: '/tmp', mainJs: 'main.js',
    viaproxyRunDir: '/tmp', viaproxyLogPath: '/tmp/launcher-test-vp.log', mindcraftLogPath: '/tmp/launcher-test-mc.log',
    agentProfilePath: '/tmp/launcher-test-profile.json',
};

// Spawnuje "uśpione" dzieci, które nie blokują event loopa testów i można je posprzątać.
function spawnTracker() {
    const spawned = [];
    const spawnImpl = () => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true });
        child.unref();
        spawned.push(child);
        return child;
    };
    const cleanup = () => {
        for (const child of spawned) {
            try { child.kill('SIGKILL'); } catch (_) { /* już martwy */ }
        }
    };
    return { spawnImpl, cleanup, spawned };
}

function dyingChild(code) {
    return spawn(process.execPath, ['-e', `process.exit(${code})`], { stdio: 'ignore' });
}

test('waitForPort: sukces, gdy port nasłuchuje', async () => {
    const server = net.createServer(() => {});
    const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    try {
        assert.ok(await waitForPort({ host: '127.0.0.1', port, timeoutMs: 3000, intervalMs: 50 }));
    } finally {
        server.close();
    }
});

test('timeout startu proxy: waitForPort odrzuca po przekroczeniu limitu', async () => {
    const start = Date.now();
    await assert.rejects(
        () => waitForPort({ host: '127.0.0.1', port: 1, timeoutMs: 600, intervalMs: 100 }),
        /timeout/,
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 500 && elapsed < 5000, `timeout powinien nastąpić w ~600 ms (było ${elapsed} ms)`);
});

test('prefiksowanie logów: linie rozbite na wiele chunków, bez utraty danych', () => {
    const lines = [];
    const sink = createPrefixedSink({ prefix: '[ViaProxy]', onLine: (l) => lines.push(l) });
    sink.write('linia1\nlin');
    sink.write('ia2\nlinia3');
    sink.close();
    assert.deepEqual(lines, ['linia1', 'linia2', 'linia3']);
});

test('killTree zabija proces potomny', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true });
    child.unref();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await killTree(child);
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'proces powinien być martwy po killTree');
});

test('supervisor: awaria ViaProxy przed gotowością portu zwraca kod błędu i nie startuje Mindcraft', async () => {
    let mindcraftSpawned = false;
    const tracker = spawnTracker();
    try {
        const result = await launch(config, paths, {
            viaproxyArgs: [],
            effectiveSettings: {},
            spawnImpl: (opts) => {
                if (opts.args.includes('ViaProxy.jar')) return dyingChild(3);
                mindcraftSpawned = true;
                return tracker.spawnImpl(opts);
            },
            waitPortImpl: () => new Promise(() => {}),
            killTreeImpl: async () => {},
            log: () => {},
            registerAbort: () => {},
        });
        assert.equal(result.code, 3);
        assert.equal(mindcraftSpawned, false);
    } finally {
        await tracker.cleanup();
    }
});

test('supervisor: Mindcraft startuje dopiero po gotowości portu proxy, z SETTINGS_JSON i --profiles', async () => {
    const started = [];
    const tracker = spawnTracker();
    let abortCallback = null;
    try {
        const launchPromise = launch(config, paths, {
            viaproxyArgs: ['cli'],
            effectiveSettings: { host: '127.0.0.1', port: 25568, minecraft_version: '1.21.6', auth: 'offline' },
            spawnImpl: (opts) => {
                const child = tracker.spawnImpl(opts);
                started.push(opts);
                return child;
            },
            waitPortImpl: () => Promise.resolve(true),
            killTreeImpl: async () => {},
            log: () => {},
            registerAbort: (handler) => { abortCallback = handler; },
        });
        // czekamy aż oba procesy wystartują
        for (let i = 0; i < 100 && started.length < 2; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(started.length, 2, 'oba procesy powinny wystartować po gotowości portu');
        assert.ok(started[0].args.includes('ViaProxy.jar'));
        assert.ok(started[0].args.includes('cli'));
        assert.equal(started[0].env.VP_RUN_DIR, paths.viaproxyRunDir);
        assert.ok(started[1].args.includes('--profiles'));
        assert.deepEqual(JSON.parse(started[1].env.SETTINGS_JSON), { host: '127.0.0.1', port: 25568, minecraft_version: '1.21.6', auth: 'offline' });
        // kończymy sesję przez abort (jak Ctrl+C)
        await abortCallback();
        const result = await launchPromise;
        assert.equal(result.code, 130);
    } finally {
        await tracker.cleanup();
    }
});

test('supervisor: awaria Mindcraft po starcie sprząta ViaProxy i zwraca kod błędu', async () => {
    const spawned = [];
    const killed = [];
    const tracker = spawnTracker();
    const dying = dyingChild(2);
    try {
        const result = await launch(config, paths, {
            viaproxyArgs: [],
            effectiveSettings: {},
            spawnImpl: () => {
                const child = spawned.length === 0 ? tracker.spawnImpl({}) : dying;
                spawned.push(child);
                return child;
            },
            waitPortImpl: () => Promise.resolve(true),
            killTreeImpl: (child) => { if (child) killed.push(child); return Promise.resolve(); },
            log: () => {},
            registerAbort: () => {},
        });
        assert.equal(result.code, 2);
        assert.ok(killed.includes(spawned[0]), 'ViaProxy powinien zostać posprzątany po awarii Mindcraft');
    } finally {
        await tracker.cleanup();
    }
});

test('supervisor: timeout startu proxy -> kod 1 i sprzątanie ViaProxy', async () => {
    const killed = [];
    const tracker = spawnTracker();
    try {
        const result = await launch(config, paths, {
            viaproxyArgs: [],
            effectiveSettings: {},
            spawnImpl: tracker.spawnImpl,
            waitPortImpl: () => Promise.reject(new Error("timeout")),
            killTreeImpl: (child) => { if (child) killed.push(child); return Promise.resolve(); },
            log: () => {},
            registerAbort: () => {},
        });
        assert.equal(result.code, 1);
        assert.equal(killed.length, 1);
        assert.equal(killed[0], tracker.spawned[0]);
    } finally {
        await tracker.cleanup();
    }
});

test('supervisor: abort (Ctrl+C) zamyka oba procesy i zwraca kod 130', async () => {
    const killed = [];
    const tracker = spawnTracker();
    let abortCallback = null;
    try {
        const launchPromise = launch(config, paths, {
            viaproxyArgs: [],
            effectiveSettings: {},
            spawnImpl: tracker.spawnImpl,
            waitPortImpl: () => Promise.resolve(true),
            killTreeImpl: (child) => { if (child) killed.push(child); return Promise.resolve(); },
            log: () => {},
            registerAbort: (handler) => { abortCallback = handler; },
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(typeof abortCallback, 'function');
        await abortCallback();
        const result = await launchPromise;
        assert.equal(result.code, 130);
        assert.equal(killed.length, 2, 'abort musi zabić oba procesy');
    } finally {
        await tracker.cleanup();
    }
});
