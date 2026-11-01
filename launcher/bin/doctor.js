// npm run bot:doctor
//
// Checks the config, Java, the ViaProxy file, the profile, dependencies, port
// availability and the state of accounts saved in ViaProxy. Messages are in
// English and never reveal API keys or tokens. It clearly separates "local
// configuration is OK" from "server connection and login tested" (doctor does
// NOT test those; the optional --probe only checks TCP reachability of the
// target server).

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { isPortOpen } from '../lib/net.js';
import {
    AGENT_PROFILE_PATH, MAIN_JS_PATH, REPO_ROOT, SAVES_PATH,
} from '../lib/paths.js';
import { resolveConfigPath, loadUserConfig, printValidationErrors, ok, err, warn, info, secretsForRedaction, resolvePathFromRepo, redactConsoleLine } from '../lib/cli_common.js';
import { checkJava, readAccountsSafe, MIN_JAVA_MAJOR, DEFAULT_VIAPROXY_VERSION } from '../lib/viaproxy.js';

const argv = process.argv.slice(2);
const configPath = resolveConfigPath(argv);
const probe = argv.includes('--probe');

// Everything we print goes through secret redaction (defense in depth - doctor
// only ever prints safe information anyway).
const secrets = secretsForRedaction();
const originalLog = console.log;
console.log = (...args) => originalLog(...args.map((a) => (typeof a === 'string' ? redactConsoleLine(a, secrets) : a)));

async function main() {
    let failed = false;

    info('=== bot:doctor - local launcher diagnostics ===');
    info('');

    // 1. Config
    const loaded = loadUserConfig(configPath);
    if (!loaded.ok) {
        failed = true;
        err('The configuration contains errors:');
        printValidationErrors(loaded.errors, loaded.warnings);
    } else {
        ok(`Config OK: ${configPath}`);
        for (const w of loaded.warnings) warn(w);
    }
    const config = loaded.config;

    let java = null;
    let jarPath = null;
    let profilePath = null;

    if (config) {
        // 2. Java
        java = await checkJava(config.proxy.javaPath);
        if (!java.ok) {
            failed = true;
            err(java.error || 'Java not found.');
        } else if (java.major < MIN_JAVA_MAJOR) {
            failed = true;
            err(`Java version ${java.version} is too old - ViaProxy requires Java ${MIN_JAVA_MAJOR}+.`);
        } else {
            ok(`Java ${java.version}`);
        }

        // 3. ViaProxy jar
        jarPath = resolvePathFromRepo(config.proxy.jarPath);
        if (!existsSync(jarPath)) {
            failed = true;
            err(`ViaProxy file missing: ${jarPath}. Download it: npm run bot:setup -- --download (pinned version: ${config.proxy.download.pinVersion}).`);
        } else {
            ok(`ViaProxy jar present: ${jarPath} (version pinned in config: ${config.proxy.download.pinVersion})`);
        }

        // 4. Profile
        profilePath = resolvePathFromRepo(config.mindcraft.profilePath);
        if (!existsSync(profilePath)) {
            failed = true;
            err(`Bot profile missing: ${profilePath}.`);
        } else {
            try {
                const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
                if (typeof profile.name !== 'string' || profile.name === '') {
                    failed = true;
                    err(`Profile ${profilePath} does not contain a "name" field.`);
                } else {
                    ok(`Bot profile present: ${profilePath} (the name will be set to "${config.account.username}")`);
                }
            } catch (e) {
                failed = true;
                err(`Profile ${profilePath} is not valid JSON: ${e.message}`);
            }
        }

        // 5. Dependencies
        if (!existsSync(path.join(REPO_ROOT, 'node_modules', 'mineflayer'))) {
            failed = true;
            err('Mindcraft dependencies missing (node_modules/mineflayer). Run "npm install".');
        } else if (!existsSync(MAIN_JS_PATH)) {
            failed = true;
            err(`${MAIN_JS_PATH} missing - run the launcher from the repository directory.`);
        } else {
            ok('Mindcraft dependencies present.');
        }

        // 6. Proxy port
        if (await isPortOpen(config.proxy.bindHost, config.proxy.bindPort, 500)) {
            warn(`Proxy port ${config.proxy.bindHost}:${config.proxy.bindPort} is currently in use - if a previous ViaProxy instance is running there, bot:start will refuse to start.`);
        } else {
            ok(`Proxy port ${config.proxy.bindHost}:${config.proxy.bindPort} is free.`);
        }

        // 7. ViaProxy accounts (saves.json) - only safe information
        if (config.account.auth === 'microsoft') {
            const saves = readAccountsSafe(SAVES_PATH);
            if (!saves.exists || saves.accounts.length === 0) {
                warn('No Microsoft accounts saved in ViaProxy (saves.json). For online-mode servers run: npm run bot:setup -- --login');
            } else {
                const wanted = config.account.accountIndex;
                if (wanted >= saves.accounts.length) {
                    failed = true;
                    err(`account.accountIndex = ${wanted}, but only ${saves.accounts.length} accounts are saved.`);
                } else {
                    const account = saves.accounts[wanted];
                    ok(`Saved account #${wanted} (type: ${account.type}${account.name ? `, name: ${account.name}` : ''}) - it can be selected automatically.`);
                    if (account.type !== 'MicrosoftAccount') warn(`Account #${wanted} is not a Microsoft account - online-mode servers will reject the login.`);
                    if (account.name && account.name !== config.account.username) {
                        warn(`The username in the config ("${config.account.username}") differs from the profile name of the logged-in account ("${account.name}").`);
                    }
                }
                info(`(The contents of ${SAVES_PATH} contain tokens - the launcher never displays them.)`);
            }
        } else {
            info('account.auth = "offline" - Microsoft login is not needed (offline servers only).');
        }

        // 8. Optional TCP probe to the target server
        if (probe) {
            const reachable = await isPortOpen(config.server.host, config.server.port, 3000);
            if (reachable) ok(`The target server ${config.server.host}:${config.server.port} accepts TCP connections.`);
            else warn(`The target server ${config.server.host}:${config.server.port} does not respond on TCP (it may be down, your IP may be banned, or the address/port is wrong).`);
            info('(The probe only checks TCP reachability - it does not check the version or the login.)');
        }
    }

    info('');
    info('=== Summary ===');
    if (failed) {
        err('Local configuration: CONTAINS ERRORS - fix them before bot:start.');
    } else {
        ok('Local configuration: OK.');
    }
    if (probe) {
        info('Server connection: only TCP reachability was checked.');
    }
    info('Server connection and Microsoft login: NOT TESTED.');
    info('Verify the actual login only with "npm run bot:start" against a real server (requires an account and network).');
    info(`Pinned ViaProxy version: ${config?.proxy?.download?.pinVersion || DEFAULT_VIAPROXY_VERSION}.`);
    return failed ? 1 : 0;
}

main().then((code) => {
    console.log = originalLog;
    process.exit(code);
}).catch((e) => {
    console.log = originalLog;
    err(`Unexpected error: ${e.message}`);
    process.exit(1);
});
