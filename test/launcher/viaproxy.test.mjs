import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../../launcher/lib/config.js';
import { buildViaProxyArgs, parseJavaVersionOutput, pickReleaseAsset, MIN_JAVA_MAJOR } from '../../launcher/lib/viaproxy.js';

const microsoftConfig = validateConfig({
    server: { host: 'mc.example.org', port: 25565, version: '26.3' },
    account: { username: 'Stefan', auth: 'microsoft', accountIndex: 2 },
    proxy: { bindHost: '127.0.0.1', bindPort: 25568 },
    mindcraft: { clientVersion: '1.21.6', profilePath: './andy.json' },
}).config;

const offlineConfig = validateConfig({
    server: { host: 'localhost', port: 25565, version: '1.21.4' },
    account: { username: 'Bot', auth: 'offline' },
    proxy: { bindHost: '127.0.0.1', bindPort: 25569 },
    mindcraft: { clientVersion: '1.21.6', profilePath: './andy.json' },
}).config;

test('argumenty ViaProxy: tryb microsoft -> auth-method ACCOUNT + indeks konta', () => {
    const args = buildViaProxyArgs(microsoftConfig);
    assert.deepEqual(args, [
        'cli',
        '--bind-address', '127.0.0.1:25568',
        '--target-address', 'mc.example.org:25565',
        '--target-version', '26.3',
        '--auth-method', 'ACCOUNT',
        '--minecraft-account-index', '2',
    ]);
});

test('argumenty ViaProxy: tryb offline -> auth-method NONE, bez indeksu konta', () => {
    const args = buildViaProxyArgs(offlineConfig);
    assert.deepEqual(args, [
        'cli',
        '--bind-address', '127.0.0.1:25569',
        '--target-address', 'localhost:25565',
        '--target-version', '1.21.4',
        '--auth-method', 'NONE',
    ]);
});

test('argumenty ViaProxy: extraArgs trafiają na koniec listy', () => {
    const cfg = validateConfig({
        server: { host: 'mc.example.org', port: 25565, version: '26.3' },
        account: { username: 'Stefan', auth: 'microsoft' },
        proxy: { bindHost: '127.0.0.1', bindPort: 25568, extraArgs: ['--chat-signing', 'false'] },
        mindcraft: { clientVersion: '1.21.6', profilePath: './andy.json' },
    }).config;
    const args = buildViaProxyArgs(cfg);
    assert.deepEqual(args.slice(-2), ['--chat-signing', 'false']);
});

test('argumenty ViaProxy to tablica stringów - brak konkatenacji do shella', () => {
    const args = buildViaProxyArgs(microsoftConfig);
    assert.ok(args.every((a) => typeof a === 'string'));
    assert.ok(!args.join(' ').includes('"'));
});

test('parser wersji Javy: nowy i stary format', () => {
    assert.deepEqual(parseJavaVersionOutput('openjdk version "21.0.4" 2024-07-16'), { major: 21, version: '21.0.4' });
    assert.deepEqual(parseJavaVersionOutput('java version "17.0.2" 2022-01-18'), { major: 17, version: '17.0.2' });
    const old = parseJavaVersionOutput('java version "1.8.0_392"');
    assert.equal(old.major, 8);
    assert.equal(MIN_JAVA_MAJOR, 17);
    assert.equal(parseJavaVersionOutput('no version here'), null);
});

const release = {
    tag_name: 'v3.4.14',
    assets: [
        { name: 'ViaProxy-3.4.14+java8.jar', browser_download_url: 'https://example.com/java8.jar', digest: 'sha256:aaa' },
        { name: 'ViaProxy-3.4.14.jar', browser_download_url: 'https://example.com/main.jar', digest: 'sha256:bbb' },
        { name: 'source.zip', browser_download_url: 'https://example.com/src.zip', digest: null },
    ],
};

test('wybór assetu: dokładna nazwa głównego jara, bez zgadywania', () => {
    const asset = pickReleaseAsset(release);
    assert.equal(asset.name, 'ViaProxy-3.4.14.jar');
    assert.equal(asset.url, 'https://example.com/main.jar');
    assert.equal(asset.digest, 'sha256:bbb');
});

test('wybór assetu: brak pasującego assetu -> null (nie pobieramy niczego na czuja)', () => {
    assert.equal(pickReleaseAsset({ tag_name: 'v9.9.9', assets: release.assets }), null);
    assert.equal(pickReleaseAsset({}), null);
    assert.equal(pickReleaseAsset(null), null);
});
