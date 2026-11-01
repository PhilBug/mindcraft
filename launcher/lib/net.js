// Small TCP helpers: readiness probing and port-in-use checks.
import net from 'net';

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single TCP connect attempt. Resolves true if the port accepts connections.
export function isPortOpen(host, port, timeoutMs = 1000) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

// Repeatedly probes host:port until it accepts connections or timeoutMs elapses.
// Rejects with Error('timeout') if the port never opens.
export async function waitForPort({ host, port, timeoutMs, intervalMs = 250 }) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await isPortOpen(host, port, Math.min(1000, Math.max(intervalMs, 100)))) return true;
        if (Date.now() >= deadline) {
            throw new Error(`timeout: port ${host}:${port} did not accept connections within ${timeoutMs} ms`);
        }
        await sleep(intervalMs);
    }
}
