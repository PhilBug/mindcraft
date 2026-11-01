// Shared CLI helpers for the launcher commands (Polish console output).
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { CONFIG_PATH, REPO_ROOT } from './paths.js';
import { parseConfigText, validateConfig } from './config.js';
import { collectSecrets, redactLine } from './redact.js';
import { SAVES_PATH } from './paths.js';

export function printStatus(marker, message) {
    console.log(`${marker} ${message}`);
}
export const ok = (msg) => printStatus('[OK]', msg);
export const err = (msg) => printStatus('[ERROR]', msg);
export const warn = (msg) => printStatus('[WARNING]', msg);
export const info = (msg) => console.log(msg);

// Resolves the config path from --config <path> (default: repo root).
export function resolveConfigPath(argv) {
    const index = argv.indexOf('--config');
    if (index !== -1 && argv[index + 1]) return path.resolve(argv[index + 1]);
    return CONFIG_PATH;
}

// Loads and validates the user's config. Returns { ok, config, warnings } or { ok: false, errors, warnings }.
export function loadUserConfig(configPath = CONFIG_PATH) {
    if (!existsSync(configPath)) {
        return { ok: false, errors: [`Configuration file not found: ${configPath}. Run "npm run bot:setup" to create it.`], warnings: [] };
    }
    let raw;
    try {
        raw = parseConfigText(readFileSync(configPath, 'utf8'));
    } catch (err) {
        return { ok: false, errors: [`File ${configPath} is not valid JSON: ${err.message}`], warnings: [] };
    }
    const result = validateConfig(raw);
    return { ok: result.errors.length === 0, config: result.config, errors: result.errors, warnings: result.warnings, raw };
}

export function printValidationErrors(errors, warnings) {
    for (const e of errors) err(e);
    for (const w of warnings) warn(w);
}

// Collects known secret values (keys.json, ViaProxy saves.json) for redaction.
export function secretsForRedaction() {
    return collectSecrets(path.join(REPO_ROOT, 'keys.json'), SAVES_PATH);
}

export function resolvePathFromRepo(configPath) {
    return path.isAbsolute(configPath) ? configPath : path.resolve(REPO_ROOT, configPath);
}

// Redakcja pojedynczej linii (wygodne w skryptach CLI).
export function redactConsoleLine(line, secrets) {
    return redactLine(line, secrets);
}
