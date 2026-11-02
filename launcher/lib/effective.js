// Builders for the effective Mindcraft runtime configuration.
// These never modify the user's settings.js or the original profile - instead
// they produce runtime files passed to main.js through its existing mechanisms:
//   - SETTINGS_JSON environment variable (merged onto settings.js by main.js)
//   - --profiles CLI argument (list of profile paths)

// Runtime overrides for Mindcraft, passed via the SETTINGS_JSON env variable.
// The bot connects offline to the local ViaProxy; the Microsoft account lives
// inside ViaProxy (auth-method=ACCOUNT), never in mineflayer.
export function buildEffectiveSettings(config) {
    return {
        host: config.proxy.bindHost,
        port: config.proxy.bindPort,
        minecraft_version: config.mindcraft.clientVersion,
        auth: 'offline',
        // enables the agent's prismarine-viewer camera (screenshots in
        // bots/<name>/screenshots/ and !lookAtPlayer/!lookAtPosition commands)
        allow_vision: config.mindcraft.allowVision,
        // built-in live 3D view served at localhost:3000+agentIndex,
        // embedded in the web UI when the agent settings expose it
        render_bot_view: config.mindcraft.renderBotView,
    };
}

// Returns a copy of the profile with the bot name replaced by account.username.
// All other fields (model, params, modes, ...) are preserved so API keys/model
// setup from the original profile keeps working.
export function buildEffectiveProfile(config, profileObj) {
    if (!profileObj || typeof profileObj !== 'object' || Array.isArray(profileObj)) {
        throw new Error('The bot profile must be a JSON object.');
    }
    const effective = { ...profileObj };
    effective.name = config.account.username;
    if (config.mindcraft.model) {
        effective.model = config.mindcraft.model;
    }
    return effective;
}

// Basic structural check of the raw profile JSON (used by doctor / start).
export function checkProfileStructure(profileObj) {
    const errors = [];
    if (!profileObj || typeof profileObj !== 'object' || Array.isArray(profileObj)) {
        return { errors: ['The bot profile must be a JSON object (e.g. {"name": "andy", "model": "..."}).'] };
    }
    if (typeof profileObj.name !== 'string' || profileObj.name.trim() === '') {
        errors.push('The profile does not contain a "name" field (bot name).');
    }
    if (profileObj.model !== undefined) {
        // Mindcraft accepts either a model name string or an object {api, url, model, params}.
        const isName = typeof profileObj.model === 'string' && profileObj.model.trim() !== '';
        const isObj = profileObj.model && typeof profileObj.model === 'object' && !Array.isArray(profileObj.model);
        if (!isName && !isObj) errors.push('The "model" field in the profile must be a non-empty string or an object (e.g. {"api": "deepseek", "url": "...", "model": "..."}).');
    }
    return { errors };
}
