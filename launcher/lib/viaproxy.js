// ViaProxy integration: CLI arguments (names verified against ViaProxy
// v3.4.14 source), Java check, official-release download with SHA-256
// verification, and safe reading of saved accounts.
//
// Verified ViaProxy facts (source: ViaVersion/ViaProxy tag v3.4.14):
//   - CLI mode: `java -jar ViaProxy.jar cli --help`; options are loaded from
//     CLI arguments and defaults come from viaproxy.yml in the working dir.
//   - Option names: bind-address, target-address, target-version,
//     auth-method (ACCOUNT | NONE), minecraft-account-index (0-indexed).
//   - `account` console command (when stdin is attached) supports:
//     account list / select <index> / deselect / add (offline <name> |
//     microsoft | bedrock) / remove <index>. Microsoft login uses the device
//     code flow (URL + code printed to the console).
//   - Config and accounts are stored in the working dir (env VP_RUN_DIR is
//     honored first): viaproxy.yml and saves.json (accountsV4, contains
//     tokens - must never be committed or printed).
//   - Main jar requires Java 17+ (a separate Java 8 build exists).
//   - Supports target servers: Release 1.0.0 - 26.3.

import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export const MIN_JAVA_MAJOR = 17;
export const DEFAULT_VIAPROXY_VERSION = 'v3.4.14';
export const RELEASES_API_BASE = 'https://api.github.com/repos/ViaVersion/ViaProxy/releases';

// Builds the argv array for ViaProxy CLI mode. Spawned without a shell, so no
// quoting/escaping issues even with spaces in paths (jarPath is a separate arg).
export function buildViaProxyArgs(config) {
    const args = [
        'cli',
        '--bind-address', `${config.proxy.bindHost}:${config.proxy.bindPort}`,
        '--target-address', `${config.server.host}:${config.server.port}`,
        '--target-version', config.server.version,
    ];
    if (config.account.auth === 'microsoft') {
        args.push('--auth-method', 'ACCOUNT');
        args.push('--minecraft-account-index', String(config.account.accountIndex));
    } else {
        args.push('--auth-method', 'NONE');
    }
    if (config.proxy.extraArgs && config.proxy.extraArgs.length > 0) {
        args.push(...config.proxy.extraArgs);
    }
    return args;
}

// Parses `java -version` output, e.g.:
//   openjdk version "21.0.4" 2024-07-16
//   java version "17.0.2" 2022-01-18
export function parseJavaVersionOutput(output) {
    const match = output.match(/version "([^"]+)"/);
    if (!match) return null;
    const version = match[1]; // np. "21.0.4", "17.0.2", "1.8.0_392"
    // Starsze Javy (< 9) raportują "1.8.x" - major to wtedy druga składowa.
    const parts = version.split('.');
    const major = parts[0] === '1' && parts.length > 1 ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
    if (!Number.isFinite(major)) return null;
    return { major, version };
}

// Runs `java -version` (spawn, no shell). Resolves { ok, major, version } or { ok: false, error }.
export function checkJava(javaPath) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(javaPath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        } catch (err) {
            resolve({ ok: false, error: `Failed to run "${javaPath}": ${err.message}` });
            return;
        }
        let output = '';
        let settled = false;
        const onOutput = (data) => { output += data.toString(); };
        child.stdout.on('data', onOutput); // java -version prints to stderr, but be tolerant
        child.stderr.on('data', onOutput);
        const fail = (error) => {
            if (settled) return;
            settled = true;
            resolve({ ok: false, error });
        };
        child.on('error', (err) => fail(`Java not found ("${javaPath}"): ${err.message}. Install JDK/JRE 17+ and/or set proxy.javaPath.`));
        child.on('close', () => {
            if (settled) return;
            settled = true;
            const parsed = parseJavaVersionOutput(output);
            if (!parsed) {
                fail(`Could not parse the Java version from the output of "${javaPath} -version".`);
                return;
            }
            resolve({ ok: parsed.major >= MIN_JAVA_MAJOR, major: parsed.major, version: parsed.version });
        });
    });
}

// Picks the main (Java 17+) jar asset from a GitHub release API response.
// Asset name must match exactly; the Java 8 variant and other files are skipped.
export function pickReleaseAsset(releaseJson) {
    if (!releaseJson || releaseJson.tag_name === undefined || !Array.isArray(releaseJson.assets)) return null;
    const jarName = `ViaProxy-${String(releaseJson.tag_name).replace(/^v/, '')}.jar`;
    const asset = releaseJson.assets.find((a) => a && a.name === jarName && typeof a.browser_download_url === 'string');
    if (!asset) return null;
    return { name: asset.name, url: asset.browser_download_url, digest: asset.digest || null, tag: releaseJson.tag_name };
}

// Downloads the pinned ViaProxy release into destPath:
//  - queries the official ViaVersion/ViaProxy GitHub releases API for the pinned tag,
//  - downloads to destPath + '.part' (temporary file),
//  - verifies SHA-256 against the digest published by the release (when present),
//  - renames into place only after success.
// Never auto-updates: the version is always taken from config.proxy.download.pinVersion.
export async function downloadViaProxyJar({ pinVersion, destPath, log = () => {}, fetchImpl = globalThis.fetch }) {
    const tag = pinVersion;
    log(`Downloading ViaProxy ${tag} from the official ViaVersion/ViaProxy releases...`);
    let release;
    try {
        const response = await fetchImpl(`${RELEASES_API_BASE}/tags/${encodeURIComponent(tag)}`, { headers: { 'Accept': 'application/vnd.github+json' } });
        if (!response.ok) {
            throw new Error(`GitHub API responded with ${response.status} for release ${tag}. Check pinVersion in the config or point to the .jar manually via proxy.jarPath.`);
        }
        release = await response.json();
    } catch (err) {
        if (err instanceof TypeError) {
            throw new Error(`Cannot reach api.github.com: ${err.message}. Check your network or point to the .jar manually via proxy.jarPath.`);
        }
        throw err;
    }

    const asset = pickReleaseAsset(release);
    if (!asset) {
        throw new Error(`No asset with the expected name (ViaProxy-${String(tag).replace(/^v/, '')}.jar) was found in release ${tag}. Not downloading anything blindly - point to the .jar manually via proxy.jarPath.`);
    }
    log(`Found asset ${asset.name}${asset.digest ? ` (sha256: ${asset.digest})` : ' (the release does not publish a checksum)'}.`);

    mkdirSync(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.part`;

    let response;
    try {
        response = await fetchImpl(asset.url, { redirect: 'follow' });
        if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
    } catch (err) {
        if (err instanceof TypeError) throw new Error(`Cannot reach github.com: ${err.message}.`);
        throw err;
    }

    try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath));
    } catch (err) {
        try { unlinkSync(tmpPath); } catch (_) { /* the temp file may not exist yet */ }
        throw new Error(`Download interrupted: ${err.message}`);
    }

    if (asset.digest && asset.digest.startsWith('sha256:')) {
        const expected = asset.digest.slice('sha256:'.length).toLowerCase();
        const actual = createHash('sha256').update(readFileSync(tmpPath)).digest('hex');
        if (actual !== expected) {
            try { unlinkSync(tmpPath); } catch (_) { /* delete the unverified file if possible */ }
            throw new Error(`SHA-256 checksum of the downloaded file does not match the official checksum of release ${tag}. The file has been deleted.`);
        }
        log(`SHA-256 checksum verified (${actual}).`);
    } else {
        log('WARNING: the official release does not publish a SHA-256 checksum - the downloaded file was not cryptographically verified.');
    }

    renameSync(tmpPath, destPath);
    const size = statSync(destPath).size;
    log(`Saved ${destPath} (${(size / 1024 / 1024).toFixed(1)} MB), pinned version: ${tag}.`);
    return { path: destPath, tag: asset.tag, bytes: size };
}

// Reads ViaProxy saves.json and returns only safe, non-secret info:
// index, accountType and (for Microsoft accounts) the in-game profile name.
// Token values are never returned or printed.
export function readAccountsSafe(savesPath) {
    if (!existsSync(savesPath)) return { exists: false, accounts: [] };
    let saves;
    try {
        saves = JSON.parse(readFileSync(savesPath, 'utf8'));
    } catch (err) {
        return { exists: true, error: `Failed to read file ${savesPath}: ${err.message}`, accounts: [] };
    }
    const list = saves && Array.isArray(saves.accountsV4) ? saves.accountsV4 : [];
    const accounts = list.map((entry, index) => {
        const type = typeof entry?.accountType === 'string' ? entry.accountType.split('.').pop() : 'nieznany';
        let name = null;
        if (typeof entry?.minecraftProfile?.name === 'string') name = entry.minecraftProfile.name;
        return { index, type, name };
    });
    return { exists: true, accounts };
}
