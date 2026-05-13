// metrics 路由单元测试
// 运行方式：cd FeiShu-Codepen-Backend && npm test

const request = require('supertest');
const express = require('express');
const metricsRouter = require('../routes/metrics');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/metrics', metricsRouter);
  return app;
}

describe('POST /api/metrics', () => {
  it('接受合法 payload，返回 { ok: true }', async () => {
    const app = buildApp();
    const payload = {
      metrics: {
        compile_babel_ms: { count: 3, avg: 120, p95: 200, max: 250 },
      },
      userAgent: 'jest-test',
    };
    const res = await request(app).post('/api/metrics').send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('空 metrics 对象也返回 { ok: true }', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/metrics').send({ metrics: {}, userAgent: 'jest' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('缺少 body 字段时不崩溃', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/metrics').send({});
    expect(res.status).toBe(200);
  });
});

describe('GET /api/metrics/summary', () => {
  it('初始返回空数组', async () => {
    // 每次 buildApp 共享同一个 metricsStore（模块级变量），
    // 所以先 POST 再 GET 验证数据流转
    const app = buildApp();
    const res = await request(app).get('/api/metrics/summary');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST 后 GET summary 能查到刚上报的数据', async () => {
    const app = buildApp();
    const payload = {
      metrics: { preview_full_rebuild_ms: { count: 1, avg: 80, p95: 80, max: 80 } },
      userAgent: 'jest-summary-test',
    };
    await request(app).post('/api/metrics').send(payload);
    const res = await request(app).get('/api/metrics/summary');
    expect(res.status).toBe(200);
    const last = res.body[res.body.length - 1];
    expect(last.userAgent).toBe('jest-summary-test');
    expect(last.metrics.preview_full_rebuild_ms.avg).toBe(80);
  });

  it('summary 最多返回 10 条', async () => {
    const app = buildApp();
    for (let i = 0; i < 15; i++) {
      await request(app).post('/api/metrics').send({ metrics: { compile_ts_ms: { count: 1, avg: i, p95: i, max: i } }, userAgent: `u${i}` });
    }
    const res = await request(app).get('/api/metrics/summary');
    expect(res.body.length).toBeLessThanOrEqual(10);
  });
});
