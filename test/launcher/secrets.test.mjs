import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { collectSecrets, redactLine, redactLines } from '../../launcher/lib/redact.js';
import { readAccountsSafe } from '../../launcher/lib/viaproxy.js';

// Fixture: strukturze saves.json odpowiada prawdziwy zapis ViaProxy (accountsV4),
// z fałszywymi tokenami zamiast prawdziwych.
const fakeSaves = {
    accountsV4: [
        {
            accountType: 'net.raphimc.viaproxy.saves.impl.accounts.MicrosoftAccount',
            msaToken: { accessToken: 'FAKE_MS_ACCESS_TOKEN_1234567890', refreshToken: 'FAKE_MS_REFRESH_TOKEN_0987654321' },
            javaXstsToken: { data: { token: 'FAKE_XSTS_TOKEN_abcdefgh' } },
            minecraftToken: { data: { token: 'FAKE_MC_TOKEN_qq111222333' } },
            minecraftProfile: { id: '00000000-0000-0000-0000-000000000001', name: 'Stefan' },
        },
        {
            accountType: 'net.raphimc.viaproxy.saves.impl.accounts.OfflineAccount',
            name: 'OfflineBot',
        },
    ],
};

const fakeKeys = {
    OPENAI_API_KEY: 'sk-FAKE-OPENAI-KEY-abcdef0123456789',
    GEMINI_API_KEY: 'FAKE_GEMINI_KEY_zzz999',
    EMPTY_KEY: '',
};

test('collectSecrets zbiera tokeny z saves.json i klucze z keys.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launcher-secrets-'));
    const keysPath = path.join(dir, 'keys.json');
    const savesPath = path.join(dir, 'saves.json');
    writeFileSync(keysPath, JSON.stringify(fakeKeys));
    writeFileSync(savesPath, JSON.stringify(fakeSaves));

    const secrets = collectSecrets(keysPath, savesPath);
    assert.ok(secrets.includes('sk-FAKE-OPENAI-KEY-abcdef0123456789'));
    assert.ok(secrets.includes('FAKE_GEMINI_KEY_zzz999'));
    assert.ok(secrets.includes('FAKE_MS_ACCESS_TOKEN_1234567890'));
    assert.ok(secrets.includes('FAKE_MC_TOKEN_qq111222333'));
    assert.equal(secrets.length, new Set(secrets).size, 'sekrety nie powinny się duplikować');
    // puste wartości i krótkie stringi nie są sekretami
    assert.ok(!secrets.includes(''));
});

test('redactLine usuwa sekrety z linii logu, resztę tekstu zostawia', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launcher-secrets-'));
    const keysPath = path.join(dir, 'keys.json');
    const savesPath = path.join(dir, 'saves.json');
    writeFileSync(keysPath, JSON.stringify(fakeKeys));
    writeFileSync(savesPath, JSON.stringify(fakeSaves));
    const secrets = collectSecrets(keysPath, savesPath);

    const line = 'logging in with token FAKE_MC_TOKEN_qq111222333 and key sk-FAKE-OPENAI-KEY-abcdef0123456789 done';
    const clean = redactLine(line, secrets);
    assert.ok(!clean.includes('FAKE_MC_TOKEN'), `token wyciekł: ${clean}`);
    assert.ok(!clean.includes('sk-FAKE-OPENAI'), `klucz wyciekł: ${clean}`);
    assert.ok(clean.includes('logging in with token *** and key *** done'), clean);
});

test('redactLines działa listowo', () => {
    const clean = redactLines(['a FAKE_GEMINI_KEY_zzz999', 'brak sekretu'], ['FAKE_GEMINI_KEY_zzz999']);
    assert.equal(clean[0], 'a ***');
    assert.equal(clean[1], 'brak sekretu');
});

test('readAccountsSafe zwraca tylko bezpieczne informacje o kontach (bez tokenów)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launcher-secrets-'));
    const savesPath = path.join(dir, 'saves.json');
    writeFileSync(savesPath, JSON.stringify(fakeSaves));

    const result = readAccountsSafe(savesPath);
    assert.equal(result.exists, true);
    assert.equal(result.accounts.length, 2);
    assert.equal(result.accounts[0].index, 0);
    assert.equal(result.accounts[0].type, 'MicrosoftAccount');
    assert.equal(result.accounts[0].name, 'Stefan');
    assert.equal(result.accounts[1].type, 'OfflineAccount');
    assert.equal(result.accounts[1].name, null);
    // kluczowe: wynik nie zawiera żadnego tokena
    const serialized = JSON.stringify(result);
    for (const secret of ['FAKE_MS_ACCESS_TOKEN_1234567890', 'FAKE_XSTS_TOKEN_abcdefgh', 'FAKE_MC_TOKEN_qq111222333']) {
        assert.ok(!serialized.includes(secret), `readAccountsSafe nie może zwracać tokenów (${secret})`);
    }
});

test('readAccountsSafe: brak pliku i uszkodzony JSON są obsłużone', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launcher-secrets-'));
    const missing = readAccountsSafe(path.join(dir, 'nie-ma.json'));
    assert.equal(missing.exists, false);
    assert.deepEqual(missing.accounts, []);

    const brokenPath = path.join(dir, 'broken.json');
    writeFileSync(brokenPath, '{not json');
    const broken = readAccountsSafe(brokenPath);
    assert.equal(broken.exists, true);
    assert.ok(broken.error);
    assert.deepEqual(broken.accounts, []);
});
