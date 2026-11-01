// Secret scrubbing for all launcher output and generated log files.
// The launcher itself never prints secrets; this module additionally removes
// any secret values that could leak through child process output (e.g. if
// Mindcraft or ViaProxy ever echoed a token into their logs).

import { existsSync, readFileSync } from 'fs';

// Collects secret-looking values from keys.json (API keys) and saves.json
// (Microsoft tokens stored by ViaProxy). Only used for redaction - never
// printed anywhere.
export function collectSecrets(keysPath, savesPath) {
    const secrets = new Set();
    const addIfSecret = (key, value) => {
        if (typeof value !== 'string' || value.length < 8) return;
        if (/key|secret|token|cert|signature|password|credential/i.test(key)) secrets.add(value);
    };

    if (keysPath && existsSync(keysPath)) {
        try {
            const keys = JSON.parse(readFileSync(keysPath, 'utf8'));
            for (const [key, value] of Object.entries(keys)) addIfSecret(key, value);
        } catch (_) { /* keys.json unreadable - nothing to redact from it */ }
    }

    if (savesPath && existsSync(savesPath)) {
        try {
            const saves = JSON.parse(readFileSync(savesPath, 'utf8'));
            walkSecretValues(saves, addIfSecret);
        } catch (_) { /* saves.json unreadable - nothing to redact from it */ }
    }

    return [...secrets];
}

function walkSecretValues(node, add) {
    if (Array.isArray(node)) {
        for (const item of node) walkSecretValues(item, add);
        return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string') add(key, value);
        else walkSecretValues(value, add);
    }
}

// Replaces every occurrence of every secret with "***".
export function redactLine(line, secrets) {
    let result = line;
    for (const secret of secrets) {
        if (secret && result.includes(secret)) result = result.split(secret).join('***');
    }
    return result;
}

export function redactLines(lines, secrets) {
    return lines.map((line) => redactLine(line, secrets));
}
