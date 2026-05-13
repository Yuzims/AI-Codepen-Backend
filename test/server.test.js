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

test('POST /api/generate rejects oversized prompt', async () => {
  await withServer(async (port) => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/generate',
      body: {
        prompt: 'x'.repeat(8001)
      }
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Field "prompt" is too long.');
  });
});

test('POST /api/code/generate returns fallback code without API key', { concurrency: false }, async () => {
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

test('POST /api/generate uses OpenAI-compatible response when API key exists', { concurrency: false }, async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;

  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: 'function hello() { return "world"; }'
            }
          }
        ]
      };
    }
  });

  try {
    await withServer(async (port) => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/generate',
        body: {
          prompt: 'Create hello function',
          language: 'javascript'
        }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.provider, 'openai');
      assert.match(res.body.code, /function hello/);
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }

    global.fetch = originalFetch;
  }
});

test('POST /api/generate handles OpenAI failure response', { concurrency: false }, async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;

  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: false,
    status: 500,
    async text() {
      return 'upstream error';
    }
  });

  try {
    await withServer(async (port) => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/generate',
        body: {
          prompt: 'Create hello function'
        }
      });

      assert.equal(res.statusCode, 502);
      assert.equal(res.body.error, 'Failed to generate code from AI provider.');
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    global.fetch = originalFetch;
  }
});

test('POST /api/generate handles empty OpenAI content', { concurrency: false }, async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;

  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: '   ' } }]
      };
    }
  });

  try {
    await withServer(async (port) => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/generate',
        body: {
          prompt: 'Create hello function'
        }
      });

      assert.equal(res.statusCode, 502);
      assert.equal(res.body.error, 'Failed to generate code from AI provider.');
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    global.fetch = originalFetch;
  }
});
