// Loading and validation of launcher.config.json.
// Pure functions (no I/O except loadConfigFile) so they are easy to unit test.

export const DEFAULTS = Object.freeze({
    proxy: {
        javaPath: 'java',
        jarPath: './.local/viaproxy/ViaProxy.jar',
        startupTimeoutMs: 60000,
        download: {
            pinVersion: 'v3.4.14', // official release, verified to support target servers up to 26.3
        },
    },
    account: {
        auth: 'microsoft',
        accountIndex: 0,
    },
});

export const AUTH_METHODS = Object.freeze(['microsoft', 'offline']);

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPort(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isOptionalIntInRange(value, min, max) {
    return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max);
}

const KNOWN_TOP_KEYS = ['server', 'account', 'proxy', 'mindcraft'];

// Validates a raw config object. Returns { errors: [], warnings: [], config }.
// config is a normalized deep copy (defaults applied) and is only set when there are no errors.
export function validateConfig(raw) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(raw)) {
        return { errors: ['The configuration file must be a JSON object.'], warnings, config: null };
    }

    for (const key of Object.keys(raw)) {
        if (!KNOWN_TOP_KEYS.includes(key)) warnings.push(`Unknown top-level key: "${key}" (ignored).`);
    }

    // --- server ---
    const server = raw.server;
    if (!isPlainObject(server)) {
        errors.push('Missing "server" section (an object with host, port, version).');
    } else {
        if (typeof server.host !== 'string' || server.host.trim() === '') errors.push('server.host must be a non-empty string (address of the target Minecraft server).');
        if (!isPort(server.port)) errors.push('server.port must be an integer in the 1-65535 range.');
        if (typeof server.version !== 'string' || server.version.trim() === '') errors.push('server.version must be a non-empty string, e.g. "26.3".');
    }

    // --- account ---
    const account = raw.account;
    if (!isPlainObject(account)) {
        errors.push('Missing "account" section (an object with username, auth).');
    } else {
        if (typeof account.username !== 'string' || account.username.trim() === '') errors.push('account.username must be a non-empty string (the in-game name, not an e-mail address).');
        else if (!/^[A-Za-z0-9_]{3,16}$/.test(account.username)) warnings.push('account.username does not look like a valid Java Edition player name (3-16 characters: letters, digits, _).');
        if (!AUTH_METHODS.includes(account.auth)) errors.push(`account.auth must be one of: ${AUTH_METHODS.map((a) => `"${a}"`).join(', ')}.`);
        if (!isOptionalIntInRange(account.accountIndex, 0, Number.MAX_SAFE_INTEGER)) errors.push('account.accountIndex must be an integer >= 0 (index of the account in the ViaProxy account list).');
    }

    // --- proxy ---
    const proxy = raw.proxy;
    if (!isPlainObject(proxy)) {
        errors.push('Missing "proxy" section (an object with bindHost, bindPort).');
    } else {
        if (typeof proxy.bindHost !== 'string' || proxy.bindHost.trim() === '') errors.push('proxy.bindHost must be a non-empty string.');
        if (!isPort(proxy.bindPort)) errors.push('proxy.bindPort must be an integer in the 1-65535 range.');
        if (proxy.javaPath !== undefined && (typeof proxy.javaPath !== 'string' || proxy.javaPath.trim() === '')) errors.push('proxy.javaPath must be a non-empty string (path to the java executable).');
        if (proxy.jarPath !== undefined && (typeof proxy.jarPath !== 'string' || proxy.jarPath.trim() === '')) errors.push('proxy.jarPath must be a non-empty string (path to the ViaProxy .jar).');
        if (!isOptionalIntInRange(proxy.startupTimeoutMs, 1000, 600000)) errors.push('proxy.startupTimeoutMs must be an integer in the 1000-600000 range.');
        if (proxy.extraArgs !== undefined && (!Array.isArray(proxy.extraArgs) || proxy.extraArgs.some((a) => typeof a !== 'string'))) errors.push('proxy.extraArgs must be an array of strings (extra ViaProxy CLI arguments).');
        if (proxy.download !== undefined) {
            if (!isPlainObject(proxy.download)) errors.push('proxy.download must be an object.');
            else if (proxy.download.pinVersion !== undefined && (typeof proxy.download.pinVersion !== 'string' || proxy.download.pinVersion.trim() === '')) errors.push('proxy.download.pinVersion must be a non-empty string, e.g. "v3.4.14".');
        }
    }

    // --- mindcraft ---
    const mindcraft = raw.mindcraft;
    if (!isPlainObject(mindcraft)) {
        errors.push('Missing "mindcraft" section (an object with clientVersion, profilePath).');
    } else {
        if (typeof mindcraft.clientVersion !== 'string' || mindcraft.clientVersion.trim() === '') errors.push('mindcraft.clientVersion must be a non-empty string, e.g. "1.21.6" (the protocol version the bot uses to connect to ViaProxy).');
        if (typeof mindcraft.profilePath !== 'string' || mindcraft.profilePath.trim() === '') errors.push('mindcraft.profilePath must be a non-empty string (path to the bot profile JSON).');
        if (mindcraft.model !== undefined && (typeof mindcraft.model !== 'string' || mindcraft.model.trim() === '')) errors.push('mindcraft.model must be a non-empty string or be omitted (the model from the profile is used then).');
        if (mindcraft.allowVision !== undefined && typeof mindcraft.allowVision !== 'boolean') errors.push('mindcraft.allowVision must be a boolean or be omitted (default false).');
    }

    // --- cross-field checks (only when shapes are valid enough) ---
    if (isPlainObject(server) && isPlainObject(proxy) && isPort(server.port) && isPort(proxy.bindPort)) {
        const sameHost = typeof proxy.bindHost === 'string' && (proxy.bindHost === server.host || proxy.bindHost === 'localhost' && (server.host === '127.0.0.1' || server.host === 'localhost'));
        if (proxy.bindPort === server.port && sameHost) {
            errors.push('proxy.bindPort is the same as server.port on the same address - ViaProxy would listen where it also connects to the target server (loop).');
        }
    }
    if (isPlainObject(proxy) && typeof proxy.bindHost === 'string' && !['127.0.0.1', 'localhost', '::1'].includes(proxy.bindHost.trim())) {
        warnings.push(`proxy.bindHost = "${proxy.bindHost}" is not a loopback address - the proxy will be reachable from the network. It should be 127.0.0.1 by default.`);
    }
    if (isPlainObject(account) && account.auth === 'offline' && typeof account.username === 'string' && account.username.trim() !== '') {
        warnings.push('account.auth = "offline": ViaProxy will join the target server without an account. Works only on servers with online-mode=false.');
    }

    if (errors.length > 0) return { errors, warnings, config: null };

    // normalized copy with defaults
    const config = {
        server: { host: server.host.trim(), port: server.port, version: server.version.trim() },
        account: {
            username: account.username.trim(),
            auth: account.auth,
            accountIndex: account.accountIndex ?? DEFAULTS.account.accountIndex,
        },
        proxy: {
            bindHost: proxy.bindHost.trim(),
            bindPort: proxy.bindPort,
            javaPath: proxy.javaPath ?? DEFAULTS.proxy.javaPath,
            jarPath: proxy.jarPath ?? DEFAULTS.proxy.jarPath,
            startupTimeoutMs: proxy.startupTimeoutMs ?? DEFAULTS.proxy.startupTimeoutMs,
            extraArgs: proxy.extraArgs ?? [],
            download: { pinVersion: proxy.download?.pinVersion ?? DEFAULTS.proxy.download.pinVersion },
        },
        mindcraft: {
            clientVersion: mindcraft.clientVersion.trim(),
            profilePath: mindcraft.profilePath,
            model: mindcraft.model,
            allowVision: mindcraft.allowVision ?? false,
        },
    };

    return { errors, warnings, config };
}

// Reads and parses the JSON file; throws on I/O or parse errors.
export function parseConfigText(text) {
    return JSON.parse(text);
}
