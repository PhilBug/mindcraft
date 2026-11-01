// Shared paths for the local Mindcraft + ViaProxy launcher.
// All generated/runtime files live under .local/ (gitignored).
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// launcher/lib -> launcher -> repo root
export const LAUNCHER_DIR = path.dirname(__dirname);
export const REPO_ROOT = path.dirname(LAUNCHER_DIR);

export const CONFIG_PATH = path.join(REPO_ROOT, 'launcher.config.json');
export const CONFIG_EXAMPLE_PATH = path.join(REPO_ROOT, 'launcher.config.example.json');

export const RUNTIME_DIR = path.join(REPO_ROOT, '.local', 'runtime');
export const VIAPROXY_RUN_DIR = path.join(RUNTIME_DIR, 'viaproxy'); // ViaProxy working dir (viaproxy.yml + saves.json)
export const LOGS_DIR = path.join(RUNTIME_DIR, 'logs');
export const AGENT_PROFILE_PATH = path.join(RUNTIME_DIR, 'agent-profile.json');
export const EFFECTIVE_SETTINGS_PATH = path.join(RUNTIME_DIR, 'mindcraft-settings.json');
export const VIAPROXY_LOG_PATH = path.join(LOGS_DIR, 'viaproxy.log');
export const MINDCRAFT_LOG_PATH = path.join(LOGS_DIR, 'mindcraft.log');
export const SAVES_PATH = path.join(VIAPROXY_RUN_DIR, 'saves.json');
export const MAIN_JS_PATH = path.join(REPO_ROOT, 'main.js');

export const RUNTIME_REL_DIR = path.relative(REPO_ROOT, RUNTIME_DIR);
