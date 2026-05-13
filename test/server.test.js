import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    await run(address.port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(port, { method = 'GET', path = '/', body } = {}) {
  const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': payload.byteLength
            }
          : undefined
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode,
            body: text ? JSON.parse(text) : null
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test('GET /health returns ok status', async () => {
  await withServer(async (port) => {
    const res = await request(port, { path: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });
});

test('POST /api/generate validates prompt', async () => {
  await withServer(async (port) => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/generate',
      body: {}
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Field "prompt" is required.');
  });
});

test('POST /api/code/generate returns fallback code without API key', async () => {
  delete process.env.OPENAI_API_KEY;

  await withServer(async (port) => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/code/generate',
      body: {
        prompt: 'Build a button component',
        language: 'typescript'
      }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.provider, 'mock');
    assert.match(res.body.code, /Build a button component/);
  });
});
