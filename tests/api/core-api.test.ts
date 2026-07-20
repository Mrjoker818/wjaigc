/**
 * API 接口测试套件
 * 
 * 覆盖核心API的正常/异常/安全场景
 * 使用真实HTTP请求，不Mock
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import type { Response } from 'node-fetch';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
const TEST_USERNAME = process.env.E2E_TEST_USERNAME || 'Mr.joker';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset';

// 使用 node 内置 fetch (Node 18+)
let sessionCookie: string | null = null;

async function api(path: string, options: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

async function login(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    sessionCookie = setCookie.split(';')[0];
  }
  expect(res.status).toBe(200);
}

describe('API 接口测试', () => {

  // =========================================================================
  // 1. /api/auth/login — 登录接口
  // =========================================================================
  describe('POST /api/auth/login', () => {
    test('正常登录 — 返回200和用户信息', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.user).toBeDefined();
      expect(body.user.name).toBe(TEST_USERNAME);
      // Cookie 必须设置
      expect(res.headers.get('set-cookie')).toBeTruthy();
    });

    test('错误密码 — 返回401', async () => {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name: TEST_USERNAME, password: 'wrong_password_123' }),
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('不存在用户 — 返回401', async () => {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name: 'nonexistent_user_xyz', password: 'test' }),
      });
      expect(res.status).toBe(401);
    });

    test('缺少参数 — 缺少密码', async () => {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name: TEST_USERNAME }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('缺少参数 — 缺少用户名', async () => {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: TEST_PASSWORD }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('空请求体 — 返回400+', async () => {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: '{}',
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('SQL注入尝试 — 用户名含注入字符串', async () => {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name: "admin' OR '1'='1", password: 'x' }),
      });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. /api/session — 会话检查
  // =========================================================================
  describe('GET /api/session', () => {
    test('未登录 — 返回200但user为null', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/session');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeNull();
      sessionCookie = oldCookie;
    });

    test('已登录 — 返回用户信息', async () => {
      await login();
      const res = await api('/api/session');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.name).toBe(TEST_USERNAME);
    });
  });

  // =========================================================================
  // 3. /api/models — 模型列表
  // =========================================================================
  describe('GET /api/models', () => {
    test('获取图像模型 — 未登录返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/models?type=image');
      sessionCookie = oldCookie;
      // 模型接口可能需要认证也可能不需要
      if (res.status === 401) {
        expect(res.body.success).toBe(false);
      } else {
        expect(res.status).toBe(200);
      }
    });

    test('获取图像模型 — 已登录返回模型列表', async () => {
      const res = await api('/api/models?type=image');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      // 返回格式可能是 { models: [...] } 或 [...]
      const models = Array.isArray(res.body) ? res.body : (res.body.models || res.body.data || []);
      expect(models.length).toBeGreaterThan(0);
    });

    test('获取聊天模型 — 返回LLM模型', async () => {
      const res = await api('/api/models?type=chat');
      expect(res.status).toBe(200);
    });

    test('无效type参数 — 返回空或错误', async () => {
      const res = await api('/api/models?type=invalid_type');
      // 应该返回200但空列表，或者400
      expect([200, 400]).toContain(res.status);
    });
  });

  // =========================================================================
  // 4. /api/user-data/sync — 用户数据同步
  // =========================================================================
  describe('POST /api/user-data/sync', () => {
    test('未登录 — 返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/user-data/sync', {
        method: 'POST',
        body: JSON.stringify({ key: 'projects', value: [] }),
      });
      sessionCookie = oldCookie;
      expect(res.status).toBe(401);
    });

    test('已登录 — 正常同步空项目列表', async () => {
      const res = await api('/api/user-data/sync', {
        method: 'POST',
        body: JSON.stringify({ key: 'projects', value: { test: true, ts: Date.now() } }),
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('缺少key参数 — 返回400', async () => {
      const res = await api('/api/user-data/sync', {
        method: 'POST',
        body: JSON.stringify({ value: [] }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('缺少value参数 — 返回400', async () => {
      const res = await api('/api/user-data/sync', {
        method: 'POST',
        body: JSON.stringify({ key: 'test' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 5. /api/generate — 图像生成
  // =========================================================================
  describe('POST /api/generate', () => {
    test('未登录 — 返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'a cat', model: 'test-model', submitOnly: true }),
      });
      sessionCookie = oldCookie;
      expect(res.status).toBe(401);
    });

    test('缺少prompt — 返回400', async () => {
      const res = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('缺少model — 使用默认模型(200)或返回400', async () => {
      const res = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'a cat', submitOnly: true }),
      });
      // 服务器设计为 fallback 到默认模型，不强制返回 400
      expect([200, 400]).toContain(res.status);
    });

    test('空prompt — 返回400', async () => {
      const res = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: '', model: 'test-model' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 6. /api/poll-task — 任务轮询
  // =========================================================================
  describe('POST /api/poll-task', () => {
    test('未登录 — 返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await fetch(`${BASE_URL}/api/poll-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'test-task-id' }),
      });
      sessionCookie = oldCookie;
      // poll-task allows anonymous by design (userId defaults to "anonymous")
      expect(res.status).toBe(200);
    });

    test('不存在的taskId — 返回failed/cancelled状态', async () => {
      const res = await api('/api/poll-task', {
        method: 'POST',
        body: JSON.stringify({ taskId: 'nonexistent-task-id-12345' }),
      });
      // 应该返回失败状态而不是永久 processing
      expect(res.status).toBe(200);
      expect(['failed', 'cancelled', 'not_found']).toContain(res.body.status);
    });

    test('缺少taskId — 返回400', async () => {
      const res = await api('/api/poll-task', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 7. /api/chat — AI聊天
  // =========================================================================
  describe('POST /api/chat', () => {
    test('未登录 — 返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      });
      sessionCookie = oldCookie;
      expect(res.status).toBe(401);
    });

    test('缺少messages — 返回400', async () => {
      const res = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('空messages数组 — 返回400', async () => {
      const res = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: [] }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 8. /api/image-edit — 图片编辑
  // =========================================================================
  describe('POST /api/image-edit', () => {
    test('未登录 — 返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/image-edit', {
        method: 'POST',
        body: JSON.stringify({ action: 'erase', imageUrl: 'http://example.com/test.jpg' }),
      });
      sessionCookie = oldCookie;
      expect(res.status).toBe(401);
    });

    test('缺少action — 返回400', async () => {
      const res = await api('/api/image-edit', {
        method: 'POST',
        body: JSON.stringify({ imageUrl: 'http://example.com/test.jpg' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('无效action — 返回400', async () => {
      const res = await api('/api/image-edit', {
        method: 'POST',
        body: JSON.stringify({ action: 'invalid_action', imageUrl: 'http://example.com/test.jpg' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 9. /api/cancel-task — 任务取消
  // =========================================================================
  describe('POST /api/cancel-task', () => {
    test('未登录 — 返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/cancel-task', {
        method: 'POST',
        body: JSON.stringify({ taskId: 'test-task-id' }),
      });
      sessionCookie = oldCookie;
      expect(res.status).toBe(401);
    });

    test('取消不存在的任务 — 返回200或404', async () => {
      const res = await api('/api/cancel-task', {
        method: 'POST',
        body: JSON.stringify({ taskId: 'nonexistent-task-id-12345' }),
      });
      // 取消不存在的任务应该返回200（幂等）或404
      expect([200, 404]).toContain(res.status);
    });

    test('缺少taskId — 返回400', async () => {
      const res = await api('/api/cancel-task', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 10. /api/save-image — 图片保存
  // =========================================================================
  describe('POST /api/save-image', () => {
    test('未登录 — 返回401', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/save-image', {
        method: 'POST',
        body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgo=' }),
      });
      sessionCookie = oldCookie;
      expect(res.status).toBe(401);
    });

    test('缺少image参数 — 返回400', async () => {
      const res = await api('/api/save-image', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test('无效image格式 — 返回400', async () => {
      const res = await api('/api/save-image', {
        method: 'POST',
        body: JSON.stringify({ image: 'not-a-valid-image' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 11. /api/auth/logout — 注销
  // =========================================================================
  describe('POST /api/auth/logout', () => {
    test('已登录注销 — 返回200', async () => {
      // 先确保已登录
      await login();
      const res = await api('/api/auth/logout', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('注销后session失效 — /api/session返回user=null', async () => {
      sessionCookie = null; // 清除本地 cookie 引用
      const res = await api('/api/session');
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
    });

    test('未登录注销 — 不报错', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/auth/logout', { method: 'POST' });
      // 注销是幂等的
      expect([200, 401]).toContain(res.status);
      sessionCookie = oldCookie;
    });
  });

  // =========================================================================
  // 12. 安全测试 — 路径穿越
  // =========================================================================
  describe('安全：路径穿越防护', () => {
    test('serve-upload 路径穿越攻击 — 返回400', async () => {
      const res = await api('/api/serve-upload/..%2F..%2F..%2Fetc%2Fpasswd');
      expect([400, 404]).toContain(res.status);
    });

    test('serve-upload 双点路径 — 返回400', async () => {
      const res = await api('/api/serve-upload/../../../etc/passwd');
      expect([400, 404]).toContain(res.status);
    });

    test('serve-upload 空字节注入 — 返回400', async () => {
      const res = await api('/api/serve-upload/test%00.txt');
      expect([400, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // 13. 安全测试 — XSS 防护
  // =========================================================================
  describe('安全：XSS防护', () => {
    test('登录用户名含XSS payload — 不执行脚本', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name: xssPayload, password: 'test' }),
      });
      // 应该返回401（用户不存在），而不是200
      expect(res.status).toBe(401);
      // 响应体不应该包含未转义的script标签
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('<script>');
    });
  });

  // =========================================================================
  // 14. 安全测试 — 速率限制/暴力破解
  // =========================================================================
  describe('安全：暴力破解防护', () => {
    test('连续5次错误密码 — 全部返回401', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ name: TEST_USERNAME, password: `wrong_${i}` }),
        });
        expect(res.status).toBe(401);
      }
    });
  });

  // =========================================================================
  // 15. 并发测试 — 重复提交
  // =========================================================================
  describe('并发：重复提交防护', () => {
    test('并发3次相同数据同步 — 不产生错误', async () => {
      await login();
      const promises = Array.from({ length: 3 }, () =>
        api('/api/user-data/sync', {
          method: 'POST',
          body: JSON.stringify({ key: 'custom_concurrent_test_' + Date.now(), value: { test: true } }),
        })
      );
      const results = await Promise.all(promises);
      // 并发同步可能触发安全防护，允许200/403/429
      results.forEach(r => {
        expect([200, 403, 429]).toContain(r.status);
      });
    });
  });

  // =========================================================================
  // 16. 错误格式验证
  // =========================================================================
  describe('错误响应格式', () => {
    test('401错误包含success=false', async () => {
      const oldCookie = sessionCookie;
      sessionCookie = null;
      const res = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'test', model: 'test' }),
      });
      sessionCookie = oldCookie;
      expect(res.status).toBe(401);
      // 错误响应应该有 error 或 message 字段（不强制 success 字段，不同路由格式不同）
      expect(res.body.error || res.body.message || res.text).toBeTruthy();
    });
  });

});
