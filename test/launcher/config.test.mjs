import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, DEFAULTS } from '../../launcher/lib/config.js';

const valid = {
    server: { host: 'mc.example.org', port: 25565, version: '26.3' },
    account: { username: 'MojNickMinecraft', auth: 'microsoft', accountIndex: 0 },
    proxy: { bindHost: '127.0.0.1', bindPort: 25568 },
    mindcraft: { clientVersion: '1.21.6', profilePath: './andy.json' },
};

test('walidacja: poprawny config przechodzi i dostaje wartości domyślne', () => {
    const { errors, warnings, config } = validateConfig(valid);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    assert.ok(config);
    assert.equal(config.proxy.javaPath, DEFAULTS.proxy.javaPath);
    assert.equal(config.proxy.jarPath, DEFAULTS.proxy.jarPath);
    assert.equal(config.proxy.startupTimeoutMs, DEFAULTS.proxy.startupTimeoutMs);
    assert.equal(config.proxy.download.pinVersion, DEFAULTS.proxy.download.pinVersion);
    assert.equal(config.account.accountIndex, 0);
});

test('walidacja: port poza zakresem (0, 65536, niecałkowity, string)', () => {
    for (const port of [0, 65536, 25565.5, '25565', -1]) {
        const { errors, config } = validateConfig({ ...valid, server: { ...valid.server, port } });
        assert.ok(errors.some((e) => e.includes('server.port')), `port ${JSON.stringify(port)} powinien dać błąd`);
        assert.equal(config, null);
    }
    for (const port of [0, 65536, 'abc']) {
        const { errors } = validateConfig({ ...valid, proxy: { ...valid.proxy, bindPort: port } });
        assert.ok(errors.some((e) => e.includes('proxy.bindPort')), `bindPort ${JSON.stringify(port)} powinien dać błąd`);
    }
});

test('walidacja: brakujące sekcje i pola', () => {
    assert.ok(validateConfig(null).errors.length > 0);
    assert.ok(validateConfig({}).errors.length >= 4);
    const { errors } = validateConfig({
        server: { host: '', port: 25565, version: '' },
        account: { auth: 'superuser' },
        proxy: { bindPort: 1 },
        mindcraft: {},
    });
    assert.ok(errors.some((e) => e.includes('server.host')));
    assert.ok(errors.some((e) => e.includes('server.version')));
    assert.ok(errors.some((e) => e.includes('account.username')));
    assert.ok(errors.some((e) => e.includes('account.auth')));
    assert.ok(errors.some((e) => e.includes('proxy.bindHost')));
    assert.ok(errors.some((e) => e.includes('clientVersion')));
    assert.ok(errors.some((e) => e.includes('profilePath')));
});

test('walidacja: bindPort == server.port przy tym samym hoście to błąd (pętla)', () => {
    const { errors } = validateConfig({ ...valid, proxy: { ...valid.proxy, bindPort: 25565 }, server: { ...valid.server, host: '127.0.0.1' } });
    assert.ok(errors.some((e) => e.includes('loop')));
});

test('walidacja: nie-loopback bindHost daje ostrzeżenie, nie błąd', () => {
    const { errors, warnings } = validateConfig({ ...valid, proxy: { ...valid.proxy, bindHost: '0.0.0.0' } });
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('loopback')));
});

test('walidacja: auth offline daje ostrzeżenie; zły accountIndex i startupTimeoutMs dają błędy', () => {
    const warnResult = validateConfig({ ...valid, account: { ...valid.account, auth: 'offline' } });
    assert.deepEqual(warnResult.errors, []);
    assert.ok(warnResult.warnings.some((w) => w.includes('offline')));

    const { errors } = validateConfig({
        ...valid,
        account: { ...valid.account, accountIndex: -1 },
        proxy: { ...valid.proxy, startupTimeoutMs: 50 },
    });
    assert.ok(errors.some((e) => e.includes('accountIndex')));
    assert.ok(errors.some((e) => e.includes('startupTimeoutMs')));
});

test('walidacja: nieznane klucze najwyższego poziomu -> ostrzeżenie, config nadal poprawny', () => {
    const { errors, warnings, config } = validateConfig({ ...valid, hackerOption: true });
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('hackerOption')));
    assert.ok(config);
});
