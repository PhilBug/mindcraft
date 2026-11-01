import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEffectiveSettings, buildEffectiveProfile, checkProfileStructure } from '../../launcher/lib/effective.js';
import { validateConfig } from '../../launcher/lib/config.js';

const config = validateConfig({
    server: { host: 'mc.example.org', port: 25565, version: '26.3' },
    account: { username: 'Stefan', auth: 'microsoft', accountIndex: 0 },
    proxy: { bindHost: '127.0.0.1', bindPort: 25568 },
    mindcraft: { clientVersion: '1.21.6', profilePath: './andy.json' },
}).config;

test('efektywne ustawienia Mindcraft wskazują na proxy, nie na serwer docelowy', () => {
    const settings = buildEffectiveSettings(config);
    assert.equal(settings.host, '127.0.0.1'); // proxy.bindHost, nie server.host
    assert.equal(settings.port, 25568); // proxy.bindPort, nie server.port
    assert.equal(settings.minecraft_version, '1.21.6'); // clientVersion, nie server.version (26.3)
    assert.equal(settings.auth, 'offline'); // bot łączy się lokalnie; konto Microsoft żyje w ViaProxy
});

test('efektywny profil: nazwa z configu, reszta pól (model itd.) zachowana, oryginał bez zmian', () => {
    const original = { name: 'andy', model: 'gpt-5.4-mini', cooldown: 5, modes: { scraping: false } };
    const snapshot = JSON.stringify(original);
    const effective = buildEffectiveProfile(config, original);

    assert.equal(effective.name, 'Stefan');
    assert.equal(effective.model, 'gpt-5.4-mini'); // bez wymuszania modelu, jeśli profil go ma
    assert.equal(effective.cooldown, 5);
    assert.deepEqual(effective.modes, { scraping: false });
    assert.equal(JSON.stringify(original), snapshot, 'oryginalny profil nie może być modyfikowany');
});

test('efektywny profil: opcjonalny override modelu z configu', () => {
    const cfg = validateConfig({
        ...{ server: { host: 'x', port: 25565, version: '26.3' }, account: { username: 'A', auth: 'offline' }, proxy: { bindHost: '127.0.0.1', bindPort: 25568 }, mindcraft: { clientVersion: '1.21.6', profilePath: './a.json', model: 'claude-4.5' } },
    }).config;
    const effective = buildEffectiveProfile(cfg, { name: 'andy', model: 'gpt-5.4-mini' });
    assert.equal(effective.model, 'claude-4.5');
});

test('efektywny profil: profil bez pola name dostaje je z configu', () => {
    const effective = buildEffectiveProfile(config, { model: 'm' });
    assert.equal(effective.name, 'Stefan');
});

test('checkProfileStructure wykrywa brak name i zły model', () => {
    assert.equal(checkProfileStructure({ name: 'x', model: 'm' }).errors.length, 0);
    assert.ok(checkProfileStructure({}).errors.some((e) => e.includes('name')));
    assert.ok(checkProfileStructure({ name: 'x', model: '' }).errors.some((e) => e.includes('model')));
    assert.ok(checkProfileStructure(null).errors.length > 0);
});
