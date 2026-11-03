// Emits shell-safe assignments for scripts/mcctl.sh, built from the same
// launcher libraries the launcher itself uses (single source of truth).
//
//   node scripts/mc-env.mjs proxy   -> MC_PROXY_* variables (ViaProxy command)
//   node scripts/mc-env.mjs bot     -> MC_BOT_* variables (Mindcraft command)
//
// Everything is printed with printf %q quoting, so `eval "$(node ...)"` is safe.

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { loadUserConfig, resolvePathFromRepo } from '../launcher/lib/cli_common.js';
import { buildViaProxyArgs } from '../launcher/lib/viaproxy.js';
import { buildEffectiveSettings, buildEffectiveProfile, checkProfileStructure } from '../launcher/lib/effective.js';
import {
    RUNTIME_DIR, LOGS_DIR, VIAPROXY_RUN_DIR, AGENT_PROFILE_PATH,
    EFFECTIVE_SETTINGS_PATH, MAIN_JS_PATH,
} from '../launcher/lib/paths.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const q = (value) => JSON.stringify(value); // JSON string == safely quoted shell word

process.chdir(REPO_ROOT);
const loaded = loadUserConfig(join(REPO_ROOT, 'launcher.config.json'));
if (!loaded.ok) {
    console.error('Invalid launcher.config.json:');
    for (const e of loaded.errors) console.error(`  - ${e}`);
    process.exit(1);
}
const config = loaded.config;

function out(...lines) {
    process.stdout.write(lines.join('\n') + '\n');
}

if (process.argv[2] === 'proxy') {
    mkdirSync(VIAPROXY_RUN_DIR, { recursive: true });
    mkdirSync(LOGS_DIR, { recursive: true });
    const jarAbs = resolvePathFromRepo(config.proxy.jarPath);
    const args = buildViaProxyArgs(config).map(q).join(' ');
    out(`MC_PROXY_CWD=${q(VIAPROXY_RUN_DIR)}`);
    out(`MC_PROXY_LOG=${q(join(LOGS_DIR, 'viaproxy-standalone.log'))}`);
    out(`MC_PROXY_PORT=${q(config.proxy.bindPort)}`);
    out(`MC_PROXY_HOST=${q(config.proxy.bindHost)}`);
    out(`MC_PROXY_CMD=(${q(config.proxy.javaPath)} -jar ${q(jarAbs)} ${args})`);
} else if (process.argv[2] === 'bot') {
    const profilePath = resolvePathFromRepo(config.mindcraft.profilePath);
    const profileRaw = JSON.parse(readFileSync(profilePath, 'utf8'));
    const profileCheck = checkProfileStructure(profileRaw);
    if (profileCheck.errors.length > 0) {
        console.error(`Invalid profile ${profilePath}:`);
        for (const e of profileCheck.errors) console.error(`  - ${e}`);
        process.exit(1);
    }
    const effectiveSettings = buildEffectiveSettings(config);
    const effectiveProfile = buildEffectiveProfile(config, profileRaw);
    mkdirSync(RUNTIME_DIR, { recursive: true });
    mkdirSync(LOGS_DIR, { recursive: true });
    writeFileSync(EFFECTIVE_SETTINGS_PATH, JSON.stringify(effectiveSettings, null, 4));
    writeFileSync(AGENT_PROFILE_PATH, JSON.stringify(effectiveProfile, null, 4));
    out(`MC_BOT_CWD=${q(REPO_ROOT)}`);
    out(`MC_BOT_LOG=${q(join(LOGS_DIR, 'mindcraft-standalone.log'))}`);
    out(`MC_BOT_UI_PORT=${q(8080)}`); // Mindcraft default mindserver/UI port
    out(`MC_BOT_ENV=(SETTINGS_JSON=${q(JSON.stringify(effectiveSettings))})`);
    out(`MC_BOT_CMD=(${q(process.execPath)} ${q(MAIN_JS_PATH)} --profiles ${q(AGENT_PROFILE_PATH)})`);
    out(`MC_BOT_NAME=${q(effectiveProfile.name)}`);
} else {
    console.error('Usage: node scripts/mc-env.mjs <proxy|bot>');
    process.exit(2);
}
