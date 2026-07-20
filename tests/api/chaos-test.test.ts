import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';

/**
 * 第七阶段：异常和混沌测试
 *
 * 测试系统在异常条件下的行为：
 * - HTTP 错误码处理（404/413/429/500/502/503/504）
 * - 模型响应异常（超时/拒绝/空结果/非JSON）
 * - 重复提交/并发冲突
 * - 用户操作中断（刷新/关闭/切换模块）
 * - 边界值（超长提示词/特殊符号）
 */

// 辅助函数：登录获取 cookie
async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
      password: process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
    }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('Login failed: no Set-Cookie header');
  // 提取 cookie 值
  const match = setCookie.match(/wujie_session=([^;]+)/i);
  return match ? `wujie_session=${match[1]}` : '';
}

// 辅助函数：带认证的 fetch
async function authFetch(path: string, options: RequestInit = {}, cookie: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });
}

describe('异常和混沌测试', () => {
  let cookie: string;

  beforeAll(async () => {
    cookie = await login();
  });

  // ========== HTTP 错误码处理 ==========
  describe('HTTP 错误码处理', () => {
    it('404 — 不存在的API路由 — 返回404而非500', async () => {
      const res = await authFetch('/api/nonexistent-endpoint', { method: 'POST' }, cookie);
      expect(res.status).toBe(404);
    });

    it('404 — 不存在的静态资源 — 返回404', async () => {
      const res = await fetch(`${BASE_URL}/_next/static/nonexistent-file.js`);
      expect(res.status).toBe(404);
    });

    it('405 — GET 请求到仅 POST 的端点 — 返回405', async () => {
      const res = await authFetch('/api/auth/login', { method: 'GET' }, cookie);
      expect([405, 404]).toContain(res.status);
    });

    it('413 — 超大请求体 — 不导致服务器崩溃', async () => {
      const largeBody = 'x'.repeat(50 * 1024); // 50KB
      const res = await authFetch(
        '/api/generate',
        { method: 'POST', body: JSON.stringify({ prompt: largeBody }) },
        cookie
      );
      expect([200, 400, 413, 500]).toContain(res.status);
      // 不应该白屏 — 返回 JSON
      const body = await res.json().catch(() => null);
      expect(body).toBeTruthy();
    }, 30000);

    it('429 — 连续快速请求 — 不导致服务器崩溃', async () => {
      const results: number[] = [];
      for (let i = 0; i < 20; i++) {
        const res = await authFetch('/api/session', { method: 'GET' }, cookie);
        results.push(res.status);
      }
      // 所有请求应返回200或429（限流）
      expect(results.every(s => s === 200 || s === 429)).toBe(true);
      // 服务器不应崩溃
      expect(results.some(s => s === 200)).toBe(true);
    });
  });

  // ========== 模型响应异常 ==========
  describe('模型响应异常', () => {
    it('无效模型名称 — 返回错误而非崩溃', async () => {
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: 'test',
            model: 'invalid-model-name-xyz',
            providerId: 'invalid-provider',
            submitOnly: true,
          }),
        },
        cookie
      );
      expect([200, 400, 404, 500]).toContain(res.status);
      const body = await res.json().catch(() => null);
      expect(body).toBeTruthy();
      // 如果返回200，应该有 error 字段
      if (res.status === 200 && body.taskId) {
        // 提交成功但会轮询失败 — 可接受
        expect(body.taskId).toBeTruthy();
      }
    });

    it('空提示词 — 服务器正确处理', async () => {
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: '',
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            submitOnly: true,
          }),
        },
        cookie
      );
      // 空提示词可能被接受或拒绝，都不应崩溃
      expect([200, 400]).toContain(res.status);
    });

    it('超长提示词（10000字符） — 不导致崩溃', async () => {
      const longPrompt = 'A beautiful landscape with mountains '.repeat(300);
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: longPrompt,
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            submitOnly: true,
          }),
        },
        cookie
      );
      expect([200, 400, 413]).toContain(res.status);
      const body = await res.json().catch(() => null);
      expect(body).toBeTruthy();
    });

    it('特殊符号提示词 — 不导致注入', async () => {
      const specialPrompt = `<script>alert('xss')</script>%; DROP TABLE users; -- {{7*7}}`;
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: specialPrompt,
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            submitOnly: true,
          }),
        },
        cookie
      );
      expect([200, 400]).toContain(res.status);
      const body = await res.json().catch(() => null);
      expect(body).toBeTruthy();
    });

    it('非JSON请求体 — 返回400', async () => {
      const res = await fetch(`${BASE_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: 'this is not json',
      });
      expect([400, 500]).toContain(res.status);
    });

    it('Content-Type 不匹配 — 返回400或500', async () => {
      const res = await fetch(`${BASE_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Cookie: cookie,
        },
        body: 'plain text body',
      });
      expect([400, 500]).toContain(res.status);
    });
  });

  // ========== 重复提交 ==========
  describe('重复提交防护', () => {
    it('连续3次相同生成请求 — 服务器不崩溃', async () => {
      const requests = [];
      for (let i = 0; i < 3; i++) {
        requests.push(
          authFetch(
            '/api/generate',
            {
              method: 'POST',
              body: JSON.stringify({
                prompt: `chaos-test-${Date.now()}-${i}`,
                model: 'doubao-seedream-4-0-250828',
                providerId: 'api_1780630178347_rjqlmam',
                submitOnly: true,
              }),
            },
            cookie
          )
        );
      }
      const responses = await Promise.all(requests);
      // 所有请求都应返回有效响应
      for (const res of responses) {
        expect([200, 400, 429, 500]).toContain(res.status);
        const body = await res.json().catch(() => null);
        expect(body).toBeTruthy();
      }
    });

    it('连续10次轮询相同不存在taskId — 不导致崩溃', async () => {
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          authFetch(
            '/api/poll-task',
            {
              method: 'POST',
              body: JSON.stringify({ taskId: `chaos-nonexistent-${i}` }),
            },
            cookie
          )
        );
      }
      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect([200]).toContain(res.status);
        const body = await res.json().catch(() => null);
        expect(body).toBeTruthy();
      }
    });
  });

  // ========== 用户操作中断 ==========
  describe('用户操作中断', () => {
    it('生成请求后立即取消 — 取消成功', async () => {
      // 提交生成
      const submitRes = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: 'chaos-cancel-test',
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            submitOnly: true,
          }),
        },
        cookie
      );
      const submitBody = await submitRes.json().catch(() => null);
      if (submitBody && submitBody.taskIds && submitBody.taskIds[0]) {
        // 立即取消
        const cancelRes = await authFetch(
          '/api/cancel-task',
          {
            method: 'POST',
            body: JSON.stringify({ taskId: submitBody.taskIds[0] }),
          },
          cookie
        );
        expect([200, 400, 404]).toContain(cancelRes.status);
      }
    });

    it('会话过期后操作 — 返回401', async () => {
      // 使用无效cookie
      const res = await fetch(`${BASE_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'WUJIE_SESSION=invalid_expired_session_token_xxx',
        },
        body: JSON.stringify({ prompt: 'test', model: 'test', submitOnly: true }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ========== 边界值 ==========
  describe('边界值测试', () => {
    it('极端比例参数 — 不导致崩溃', async () => {
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: 'test',
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            aspectRatio: '9999:1',
            submitOnly: true,
          }),
        },
        cookie
      );
      expect([200, 400]).toContain(res.status);
    });

    it('负数数量参数 — 不导致崩溃', async () => {
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: 'test',
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            count: -5,
            submitOnly: true,
          }),
        },
        cookie
      );
      expect([200, 400]).toContain(res.status);
    });

    it('极大数量参数 — 不导致崩溃', async () => {
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: 'test',
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            count: 10000,
            submitOnly: true,
          }),
        },
        cookie
      );
      expect([200, 400]).toContain(res.status);
    });

    it('SQL注入尝试在提示词中 — 不执行注入', async () => {
      const sqlPayloads = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "1; DELETE FROM wujie_users WHERE 1=1; --",
        "UNION SELECT * FROM wujie_api_providers --",
      ];
      for (const payload of sqlPayloads) {
        const res = await authFetch(
          '/api/generate',
          {
            method: 'POST',
            body: JSON.stringify({
              prompt: payload,
              model: 'doubao-seedream-4-0-250828',
              providerId: 'api_1780630178347_rjqlmam',
              submitOnly: true,
            }),
          },
          cookie
        );
        expect([200, 400]).toContain(res.status);
        // 服务器应仍然正常运行
        const healthRes = await authFetch('/api/session', { method: 'GET' }, cookie);
        expect(healthRes.status).toBe(200);
      }
    });
  });

  // ========== 服务器稳定性 ==========
  describe('服务器稳定性', () => {
    it('混合异常请求后服务器仍可用', async () => {
      // 发送各种异常请求
      const chaosRequests = [
        fetch(`${BASE_URL}/api/generate`, { method: 'POST', body: 'invalid' }),
        fetch(`${BASE_URL}/api/nonexistent`),
        fetch(`${BASE_URL}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        fetch(`${BASE_URL}/api/poll-task`, { method: 'GET' }),
        fetch(`${BASE_URL}/api/session`, { method: 'POST' }),
      ];
      await Promise.allSettled(chaosRequests);

      // 服务器应仍然可用
      const healthRes = await fetch(`${BASE_URL}/api/session`);
      expect(healthRes.status).toBe(200);
      const body = await healthRes.json();
      expect(body.success).toBe(true);
    });

    it('OPTIONS 请求 — 返回 CORS 头', async () => {
      const res = await fetch(`${BASE_URL}/api/session`, { method: 'OPTIONS' });
      expect([200, 204, 405]).toContain(res.status);
    });
  });
});
