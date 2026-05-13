const express = require('express');
const request = require('supertest');

const mockAuth = jest.fn((req, res, next) => {
  req.user = { id: 'user-1', username: 'tester' };
  next();
});

jest.mock('../middleware/auth', () => mockAuth);

const mockCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }));
});

function buildApp() {
  let aiRouter;
  jest.isolateModules(() => {
    aiRouter = require('../routes/ai');
  });

  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  return app;
}

describe('POST /api/ai/generate', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalKey;
    }
  });

  it('缺少 prompt 时返回 400', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/ai/generate').send({ prompt: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: '请输入生成描述' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('未配置 DEEPSEEK_API_KEY 时返回 500', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const app = buildApp();
    const res = await request(app).post('/api/ai/generate').send({ prompt: '生成一个待办应用' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: '服务端未配置 DEEPSEEK_API_KEY' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('成功时按 SSE 返回 delta 和 DONE', async () => {
    const chunks = [
      { choices: [{ delta: { content: '{"title":"Todo Demo",' } }] },
      { choices: [{ delta: { content: '"html":"<div>demo</div>","css":"body{}","js":"console.log(1)"}' } }] },
    ];

    mockCreate.mockResolvedValueOnce((async function* () {
      for (const chunk of chunks) yield chunk;
    })());

    const app = buildApp();
    const res = await request(app).post('/api/ai/generate').send({ prompt: '生成一个待办应用' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('Todo Demo');
    expect(res.text).toContain('data: [DONE]');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-chat',
      max_tokens: 4096,
      stream: true,
    }));
  });

  it('流式生成失败时返回 SSE error 事件', async () => {
    mockCreate.mockRejectedValueOnce(new Error('deepseek failed'));

    const app = buildApp();
    const res = await request(app).post('/api/ai/generate').send({ prompt: '生成一个待办应用' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('deepseek failed');
    expect(res.text).toContain('data: {"error":"deepseek failed"}');
  });
});
