// npm run bot:setup
//
//   (no flags)            - creates launcher.config.json from the example (if it does not exist) and shows status + next steps
//   --download            - downloads the pinned ViaProxy version from official releases (SHA-256 verified)
//   --login               - starts ViaProxy with an interactive console to add a Microsoft account (`account add microsoft`)
//
// Never overwrites an existing launcher.config.json and never stores passwords/tokens.

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import {
    CONFIG_EXAMPLE_PATH, LOGS_DIR, RUNTIME_DIR, SAVES_PATH, VIAPROXY_RUN_DIR,
} from '../lib/paths.js';
import { resolveConfigPath, loadUserConfig, printValidationErrors, ok, err, warn, info } from '../lib/cli_common.js';
import { buildViaProxyArgs, checkJava, downloadViaProxyJar, readAccountsSafe, DEFAULT_VIAPROXY_VERSION, MIN_JAVA_MAJOR } from '../lib/viaproxy.js';
import { resolvePathFromRepo } from '../lib/cli_common.js';

const argv = process.argv.slice(2);
const configPath = resolveConfigPath(argv);

function ensureConfig() {
    if (existsSync(configPath)) {
        ok(`User config already exists: ${configPath} (not overwriting).`);
        return true;
    }
    if (!existsSync(CONFIG_EXAMPLE_PATH)) {
        err(`Example file not found: ${CONFIG_EXAMPLE_PATH}. Cannot create the config.`);
        return false;
    }
    copyFileSync(CONFIG_EXAMPLE_PATH, configPath);
    ok(`Created ${configPath} from launcher.config.example.json.`);
    info('Fill in the server address, version, your username and the bot protocol version.');
    return true;
}

async function download() {
    const loaded = loadUserConfig(configPath);
    if (!loaded.ok) {
        err('The config is invalid - fix it first:');
        printValidationErrors(loaded.errors, loaded.warnings);
        return 1;
    }
    const config = loaded.config;
    const java = await checkJava(config.proxy.javaPath);
    if (!java.ok) {
        warn(java.error || `Java ${MIN_JAVA_MAJOR}+ is required (main ViaProxy .jar file).`);
    } else if (java.major < MIN_JAVA_MAJOR) {
        warn(`Found Java version ${java.version}, which is too old. ViaProxy requires Java ${MIN_JAVA_MAJOR}+ (or the separate "+java8" build).`);
    } else {
        ok(`Java OK: ${java.version}`);
    }
    const jarPath = resolvePathFromRepo(config.proxy.jarPath);
    try {
        const result = await downloadViaProxyJar({ pinVersion: config.proxy.download.pinVersion, destPath: jarPath, log: info });
        ok(`ViaProxy ${result.tag} ready: ${result.path}`);
        info('The version is pinned in the config (proxy.download.pinVersion) - the launcher never updates it automatically.');
        return 0;
    } catch (e) {
        err(`Download failed: ${e.message}`);
        info('You can also download the .jar manually from https://github.com/ViaVersion/ViaProxy/releases and point to it via proxy.jarPath.');
        return 1;
    }
}

async function login() {
    const loaded = loadUserConfig(configPath);
    if (!loaded.ok) {
        err('The config is invalid:');
        printValidationErrors(loaded.errors, loaded.warnings);
        return 1;
    }
    const config = loaded.config;
    const jarPath = resolvePathFromRepo(config.proxy.jarPath);
    if (!existsSync(jarPath)) {
        err(`ViaProxy file not found: ${jarPath}. Run "npm run bot:setup -- --download" or download the .jar manually and set proxy.jarPath.`);
        return 1;
    }

    info('');
    info('=== One-time Microsoft login (device code flow, in this console) ===');
    info('ViaProxy will start in a moment. Type this command into it:');
    info('  account add microsoft');
    info('ViaProxy will print a link and a code - open the link in your browser,');
    info('sign in with your Microsoft account and enter the code (if it was not');
    info('inserted automatically).');
    info('Then check the list:  account list');
    info('Finish with Ctrl+C (the launcher will clean up the process).');
    info('====================================================================');
    info('');

    const args = buildViaProxyArgs(config);
    mkdirSync(VIAPROXY_RUN_DIR, { recursive: true });
    const child = spawn(config.proxy.javaPath, ['-jar', jarPath, ...args], {
        cwd: VIAPROXY_RUN_DIR,
        env: { ...process.env, VP_RUN_DIR: VIAPROXY_RUN_DIR },
        stdio: 'inherit',
        windowsHide: false,
    });
    const exitCode = await new Promise((resolve) => {
        child.on('error', (e) => {
            err(`Failed to start ViaProxy: ${e.message}`);
            resolve(1);
        });
        child.on('exit', (code) => resolve(code ?? 1));
    });

    // Verification: can the saved account be selected in automatic mode?
    const saves = readAccountsSafe(SAVES_PATH);
    if (!saves.exists || saves.accounts.length === 0) {
        warn('No saved accounts found in saves.json - automatic mode (auth-method=ACCOUNT) will not work.');
        return exitCode === 0 ? 1 : exitCode;
    }
    ok(`Accounts saved in ViaProxy: ${saves.accounts.length}. Indexes: ${saves.accounts.map((a) => a.index).join(', ')} (types: ${saves.accounts.map((a) => a.type).join(', ')}).`);
    const wanted = config.account.accountIndex;
    if (config.account.auth === 'microsoft') {
        if (wanted >= saves.accounts.length) {
            err(`account.accountIndex = ${wanted}, but only ${saves.accounts.length} accounts are saved. Fix the config or add an account.`);
            return 1;
        }
        const account = saves.accounts[wanted];
        if (account.type !== 'MicrosoftAccount') {
            warn(`The account at index ${wanted} is not a Microsoft account (type: ${account.type}) - online-mode servers will reject this login.`);
        }
        if (account.name && account.name !== config.account.username) {
            warn(`The username in the config ("${config.account.username}") differs from the Minecraft profile name of the logged-in account ("${account.name}"). The bot will appear on the server as "${account.name}".`);
        } else if (account.name) {
            ok(`The username in the config matches the Minecraft profile name of the saved account ("${account.name}").`);
        }
        ok(`The account at index ${wanted} can be selected automatically (the launcher starts ViaProxy with --auth-method ACCOUNT --minecraft-account-index ${wanted}).`);
    }
    return exitCode === 0 ? 0 : exitCode;
}

function status() {
    const loaded = loadUserConfig(configPath);
    if (!loaded.ok) {
        err('The config is invalid:');
        printValidationErrors(loaded.errors, loaded.warnings);
    }
    const config = loaded.config;
    const jarPath = config ? resolvePathFromRepo(config.proxy.jarPath) : null;
    const profilePath = config ? resolvePathFromRepo(config.mindcraft.profilePath) : null;

    info('');
    info('Environment status:');
    if (!config) {
        info(`- config: ${configPath} (invalid)`);
    } else {
        info(`- config: ${configPath}`);
        info(`- ViaProxy jar: ${jarPath} ${existsSync(jarPath) ? '[found]' : '[missing - run "npm run bot:setup -- --download"]'}`);
        info(`- bot profile: ${profilePath} ${existsSync(profilePath) ? '[found]' : '[missing]'}`);
        info(`- runtime directory: ${RUNTIME_DIR} (gitignored)`);
    }

    info('');
    info('Next steps:');
    info('  1. Fill in launcher.config.json (server, version, username, bot protocol version).');
    info(`  2. Download ViaProxy:  npm run bot:setup -- --download   (pinned version: ${config?.proxy?.download?.pinVersion || DEFAULT_VIAPROXY_VERSION})`);
    info('  3. Log in with your Microsoft account (only for online-mode servers):  npm run bot:setup -- --login');
    info('  4. Start:  npm run bot:start');
    info('  Diagnostics:  npm run bot:doctor');
}

async function main() {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    mkdirSync(LOGS_DIR, { recursive: true });
    mkdirSync(VIAPROXY_RUN_DIR, { recursive: true });

    let code = 0;
    if (argv.includes('--download')) {
        if (!ensureConfig()) return 1;
        code = await download();
    } else if (argv.includes('--login')) {
        if (!ensureConfig()) return 1;
        code = await login();
    } else {
        ensureConfig();
        status();
    }
    return code;
}

main().then((code) => process.exit(code)).catch((e) => {
    err(`Unexpected error: ${e.message}`);
    process.exit(1);
});
