/**
 * End-to-end smoke tests for the CORS proxy.
 *
 * A throwaway origin server is started in-process, and the proxy itself is
 * spawned as a child process (server.js calls `app.listen` on import, so it
 * cannot simply be imported). Requests are then sent through the proxy and the
 * responses are checked for both the forwarded payload and the injected CORS
 * headers.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ORIGIN_PORT = 9911;
const PROXY_PORT = 9910;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;
const ORIGIN_URL = `http://127.0.0.1:${ORIGIN_PORT}`;

const serverPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'server.js',
);

let origin;
let proxy;

/**
 * Poll the proxy until it accepts connections, so tests do not race the boot.
 *
 * @param {number} [timeoutMs=10000] Total time to wait before giving up.
 * @returns {Promise<void>} Resolves once the proxy answers, rejects on timeout.
 */
async function waitForProxy(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            // Any answer means the listener is up; the status code is irrelevant.
            await fetch(`${PROXY_URL}/proxy/`, { method: 'OPTIONS' });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    throw new Error('proxy did not start in time');
}

describe('cors proxy', () => {
    before(async () => {
        // Minimal origin echoing back the path it was reached on.
        origin = http.createServer((req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ path: req.url, ua: req.headers['x-custom'] ?? null }));
        });
        origin.listen(ORIGIN_PORT);
        await once(origin, 'listening');

        proxy = spawn(process.execPath, [serverPath], {
            env: { ...process.env, PORT: String(PROXY_PORT) },
            stdio: 'ignore',
        });

        await waitForProxy();
    });

    after(async () => {
        proxy?.kill();
        origin?.close();
        await once(origin, 'close');
    });

    it('forwards a request given via the X-Url-Destination header', async () => {
        const res = await fetch(`${PROXY_URL}/proxy`, {
            headers: { 'x-url-destination': `${ORIGIN_URL}/hello?a=1` },
        });

        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { path: '/hello?a=1', ua: null });
    });

    it('forwards a request given as a path after /proxy/', async () => {
        const res = await fetch(`${PROXY_URL}/proxy/${ORIGIN_URL}/deep/path?b=2`);

        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { path: '/deep/path?b=2', ua: null });
    });

    it('injects CORS headers echoing the request origin', async () => {
        const res = await fetch(`${PROXY_URL}/proxy`, {
            headers: {
                'x-url-destination': `${ORIGIN_URL}/`,
                origin: 'https://example.test',
            },
        });

        assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.test');
        assert.match(res.headers.get('access-control-allow-methods'), /GET/);
    });

    it('answers preflight OPTIONS requests directly', async () => {
        const res = await fetch(`${PROXY_URL}/proxy`, {
            method: 'OPTIONS',
            headers: { origin: 'https://example.test' },
        });

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.test');
        assert.equal(res.headers.get('access-control-max-age'), '86400');
    });

    it('strips the headers listed in X-Headers-Delete', async () => {
        const res = await fetch(`${PROXY_URL}/proxy`, {
            headers: {
                'x-url-destination': `${ORIGIN_URL}/`,
                'x-headers-delete': 'x-custom',
                'x-custom': 'should-be-removed',
            },
        });

        const body = await res.json();
        assert.equal(body.ua, null);
    });
});
