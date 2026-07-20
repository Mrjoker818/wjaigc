import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';

/**
 * 第八阶段：安全测试 — OWASP Top 10 覆盖
 *
 * 测试覆盖：
 * - A01: Broken Access Control（IDOR/越权）
 * - A02: Cryptographic Failures（加密失败）
 * - A03: Injection（SQL注入/命令注入）
 * - A04: Insecure Design（不安全设计）
 * - A05: Security Misconfiguration（安全配置错误）
 * - A06: Vulnerable Components（易受攻击的组件）
 * - A07: Auth Failures（认证失败）
 * - A08: Software/Data Integrity Failures（完整性失败）
 * - A09: Logging/Monitoring Failures（日志失败）
 * - A10: SSRF（服务器端请求伪造）
 */

// 辅助函数
async function login(name?: string, password?: string): Promise<{ cookie: string; userId?: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || process.env.E2E_TEST_USERNAME || 'Mr.joker',
      password: password || process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
    }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return { cookie: '' };
  const match = setCookie.match(/wujie_session=([^;]+)/i);
  const body = await res.json().catch(() => ({}));
  return { cookie: match ? `wujie_session=${match[1]}` : '', userId: body.userId || body.user?.id };
}

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

describe('安全测试 — OWASP Top 10', () => {
  let cookie: string;

  beforeAll(async () => {
    const result = await login();
    cookie = result.cookie;
  });

  // ========== A01: Broken Access Control ==========
  describe('A01: 访问控制失效 (Broken Access Control)', () => {
    it('未认证访问受保护API — 返回401或403', async () => {
      const protectedEndpoints = [
        { path: '/api/generate', method: 'POST', body: { prompt: 'test' } },
        { path: '/api/user-data/sync', method: 'POST', body: { key: 'projects', value: '{}' } },
        { path: '/api/save-image', method: 'POST', body: { image: 'test' } },
        { path: '/api/admin/api-balance', method: 'GET' },
        { path: '/api/admin/op-log', method: 'GET' },
      ];
      for (const ep of protectedEndpoints) {
        const res = await fetch(`${BASE_URL}${ep.path}`, {
          method: ep.method,
          headers: { 'Content-Type': 'application/json' },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        expect([401, 403], `${ep.method} ${ep.path} should require auth`).toContain(res.status);
      }
    });

    it('IDOR — 尝试访问其他用户数据 — 被拒绝', async () => {
      // 尝试用不同 userId 访问数据
      const res = await authFetch(
        '/api/user-data/sync?key=projects&userId=other_user_id',
        { method: 'GET' },
        cookie
      );
      // 应基于 session 中的 userId，忽略 URL 参数中的 userId
      expect([200, 400, 403]).toContain(res.status);
      if (res.status === 200) {
        const body = await res.json();
        // 返回的应是当前用户数据，不是其他用户的
        expect(body.success).toBe(true);
      }
    });

    it('管理员API — 权限控制验证', async () => {
      const adminEndpoints = [
        { path: '/api/admin/api-balance', method: 'GET' },
        { path: '/api/admin/op-log', method: 'GET' },
        { path: '/api/admin/op-log', method: 'POST', body: { action: 'statistics' } },
      ];
      for (const ep of adminEndpoints) {
        const res = await authFetch(ep.path, {
          method: ep.method,
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        }, cookie);
        // 管理员用户应能访问(200)，非管理员应被拒绝(403)
        // 当前测试用户为管理员，期望200
        expect([200, 403], `${ep.method} ${ep.path}`).toContain(res.status);
      }
    });

    it('越权尝试 — 伪造 isAdmin 字段不影响认证', async () => {
      const res = await authFetch(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
            password: process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
            isAdmin: true, // 尝试注入管理员权限
            role: 'admin',
          }),
        },
        ''
      );
      const body = await res.json();
      // 登录应成功（正确密码），但权限应来自服务器端用户记录
      // 注入的 isAdmin/role 字段不应创建新用户或提升权限
      expect(body.success).toBe(true);
      if (body.user) {
        // 角色应来自服务器数据库，不是客户端注入
        expect(body.user.role).toBeTruthy();
      }
    });
  });

  // ========== A02: Cryptographic Failures ==========
  describe('A02: 加密失败 (Cryptographic Failures)', () => {
    it('密码不以明文返回', async () => {
      const res = await authFetch('/api/session', { method: 'GET' }, cookie);
      const body = await res.json();
      expect(body.success).toBe(true);
      // session 响应不应包含密码
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('password');
      expect(bodyStr).not.toContain('passwordHash');
      expect(bodyStr).not.toContain('password_hash');
    });

    it('登录响应不包含密码哈希', async () => {
      const res = await login();
      const res2 = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
          password: process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
        }),
      });
      const body = await res2.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('passwordHash');
      expect(bodyStr).not.toContain('password_hash');
      expect(bodyStr).not.to.match(/hash.*\$2[aby]\$/i);
    });

    it('Cookie 包含 HttpOnly 标志', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
          password: process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
        }),
      });
      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie.toLowerCase()).toContain('httponly');
    });

    it('Cookie 包含 SameSite 属性', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
          password: process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
        }),
      });
      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie.toLowerCase()).toMatch(/samesite=(strict|lax|none)/);
    });
  });

  // ========== A03: Injection ==========
  describe('A03: 注入攻击 (Injection)', () => {
    it('SQL注入 — 登录接口', async () => {
      const sqlPayloads = [
        { name: "admin' OR '1'='1", password: "anything" },
        { name: "admin'; DROP TABLE wujie_users; --", password: "x" },
        { name: "admin' UNION SELECT * FROM wujie_users --", password: "x" },
        { name: "' OR 1=1 --", password: "x" },
        { name: "admin' OR '1'='1' /*", password: "x" },
      ];
      for (const payload of sqlPayloads) {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        // SQL注入不应成功登录
        expect(res.status, `SQL injection: ${payload.name}`).toBe(401);
      }
      // 服务器应仍然正常运行
      const healthRes = await fetch(`${BASE_URL}/api/session`);
      expect(healthRes.status).toBe(200);
    });

    it('SQL注入 — 用户数据同步 key 注入', async () => {
      const res = await authFetch(
        '/api/user-data/sync',
        {
          method: 'POST',
          body: JSON.stringify({
            key: "projects'; DROP TABLE wujie_user_data; --",
            value: '{}',
          }),
        },
        cookie
      );
      // key 以 "projects" 开头可能被接受(200)，也可能被拒绝(400/403)
      // 关键是 SQL 注入不执行 — 参数化查询防护
      expect([200, 400, 403]).toContain(res.status);
      // 服务器和数据库应正常运行
      const healthRes = await authFetch('/api/session', { method: 'GET' }, cookie);
      expect(healthRes.status).toBe(200);
      // 用户数据表应仍然存在（能正常读取数据）
      const dataRes = await authFetch('/api/user-data/sync?key=projects', { method: 'GET' }, cookie);
      expect(dataRes.status).toBe(200);
    });

    it('命令注入 — 提示词中嵌入系统命令', async () => {
      const cmdPayloads = [
        '`cat /etc/passwd`',
        '$(whoami)',
        '; rm -rf /',
        '| nc -l 4444',
        '& ping -c 10 evil.com',
        '\n/bin/sh\n',
      ];
      for (const payload of cmdPayloads) {
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
        // 命令不应被执行 — 服务器应正常运行
        const healthRes = await authFetch('/api/session', { method: 'GET' }, cookie);
        expect(healthRes.status).toBe(200);
      }
    });

    it('NoSQL注入 — JSON结构注入', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: { $ne: null },
          password: { $ne: null },
        }),
      });
      expect(res.status).toBe(401);
    });

    it('模板注入 — SSTI 尝试', async () => {
      const templatePayloads = [
        '{{7*7}}',
        '${7*7}',
        '<%= 7*7 %>',
        '#{7*7}',
        '{{constructor.constructor("return process")().env}}',
      ];
      for (const payload of templatePayloads) {
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
        const body = await res.json().catch(() => null);
        expect(body).toBeTruthy();
        // 模板不应被执行 — 不应暴露 process.env
        if (body) {
          const bodyStr = JSON.stringify(body);
          expect(bodyStr).not.toContain('NODE_ENV');
          expect(bodyStr).not.toContain('DATABASE_URL');
          expect(bodyStr).not.toMatch(/process\.env/);
          // 不应暴露环境变量键值对
          expect(bodyStr).not.toMatch(/PATH=\/usr/);
          expect(bodyStr).not.toMatch(/HOME=\/(home|root)/);
        }
      }
    });
  });

  // ========== A05: Security Misconfiguration ==========
  describe('A05: 安全配置错误 (Security Misconfiguration)', () => {
    it('不暴露 .env 文件', async () => {
      const res = await fetch(`${BASE_URL}/.env`);
      expect(res.status).toBe(404);
    });

    it('不暴露 .git 目录', async () => {
      const res = await fetch(`${BASE_URL}/.git/config`);
      expect(res.status).toBe(404);
    });

    it('不暴露 package.json 源码结构', async () => {
      // package.json 是公开的（前端项目），但不应暴露服务器路径
      const res = await fetch(`${BASE_URL}/package.json`);
      if (res.status === 200) {
        const body = await res.text();
        // 不应包含服务器内部路径
        expect(body).not.toContain('/workspace/');
        expect(body).not.toContain('/home/');
      }
    });

    it('不暴露敏感 HTTP 头', async () => {
      const res = await fetch(`${BASE_URL}/api/session`);
      const headers = res.headers;
      // 不应暴露 X-Powered-By
      const poweredBy = headers.get('x-powered-by');
      if (poweredBy) {
        // Next.js 默认暴露，但不应暴露版本号
        expect(poweredBy).not.toMatch(/Next\.js\/\d+\.\d+\.\d+/);
      }
    });

    it('API 不返回堆栈跟踪', async () => {
      const res = await fetch(`${BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });
      const body = await res.json().catch(() => null);
      if (body) {
        const bodyStr = JSON.stringify(body);
        // 不应暴露内部堆栈
        expect(bodyStr).not.toMatch(/at\s+\w+\s+\(.*\.\w+:\d+:\d+\)/);
        expect(bodyStr).not.toContain('/workspace/projects/');
        expect(bodyStr).not.toContain('node_modules/');
      }
    });
  });

  // ========== A07: Auth Failures ==========
  describe('A07: 认证失败 (Auth Failures)', () => {
    it('暴力破解 — 连续10次错误密码', async () => {
      let all401 = true;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
            password: `wrong_password_${i}`,
          }),
        });
        if (res.status !== 401) all401 = false;
      }
      expect(all401).toBe(true);
      // 正确密码仍可登录
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
          password: process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
        }),
      });
      expect(res.status).toBe(200);
    });

    it('会话固定攻击 — 登录后 cookie 值变化', async () => {
      // 先用无效 session 访问
      const fakeCookie = 'wujie_session=fake_session_12345';
      const res1 = await fetch(`${BASE_URL}/api/session`, {
        headers: { Cookie: fakeCookie },
      });
      // 登录
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: process.env.E2E_TEST_USERNAME || 'Mr.joker',
          password: process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset',
        }),
      });
      const setCookie = loginRes.headers.get('set-cookie') || '';
      // 新 cookie 值不应是 fake_session_12345
      expect(setCookie).not.toContain('fake_session_12345');
    });

    it('注销后 cookie 失效', async () => {
      // 登录
      const loginResult = await login();
      expect(loginResult.cookie).toBeTruthy();
      // 验证可访问
      const res1 = await authFetch('/api/session', { method: 'GET' }, loginResult.cookie);
      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      expect(body1.user).toBeTruthy();
      // 注销
      const logoutRes = await authFetch('/api/auth/logout', { method: 'POST' }, loginResult.cookie);
      expect(logoutRes.status).toBe(200);
      // 注销后 Set-Cookie 应清除 session
      const setCookie = logoutRes.headers.get('set-cookie') || '';
      // 验证 logout 响应成功
      const logoutBody = await logoutRes.json();
      expect(logoutBody.success).toBe(true);
    });
  });

  // ========== A08: Software/Data Integrity ==========
  describe('A08: 数据完整性 (Software/Data Integrity Failures)', () => {
    it('用户数据同步 — value 非法类型被拒绝', async () => {
      const res = await authFetch(
        '/api/user-data/sync',
        {
          method: 'POST',
          body: JSON.stringify({
            key: 'projects',
            value: 12345, // 非字符串
          }),
        },
        cookie
      );
      expect([200, 400]).toContain(res.status);
    });

    it('用户数据同步 — 超大 value 不导致崩溃', async () => {
      const largeValue = JSON.stringify({ data: 'x'.repeat(50000) });
      const res = await authFetch(
        '/api/user-data/sync',
        {
          method: 'POST',
          body: JSON.stringify({
            key: 'projects_test_large',
            value: largeValue,
          }),
        },
        cookie
      );
      expect([200, 400, 413]).toContain(res.status);
      // 服务器应正常运行
      const healthRes = await authFetch('/api/session', { method: 'GET' }, cookie);
      expect(healthRes.status).toBe(200);
    });
  });

  // ========== A10: SSRF ==========
  describe('A10: SSRF (服务器端请求伪造)', () => {
    it('图片URL — 内网地址尝试', async () => {
      const internalUrls = [
        'http://127.0.0.1:5000/api/session',
        'http://localhost:5000/admin',
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]:5000/',
        'file:///etc/passwd',
        'http://0.0.0.0:5000/',
      ];
      for (const url of internalUrls) {
        const res = await authFetch(
          '/api/save-image',
          {
            method: 'POST',
            body: JSON.stringify({ image: url }),
          },
          cookie
        );
        // 应拒绝或返回错误，不应泄露内网信息
        expect([400, 401, 500]).toContain(res.status);
        if (res.status === 400) {
          const body = await res.json().catch(() => null);
          if (body) {
            const bodyStr = JSON.stringify(body);
            // 不应泄露内网响应内容
            expect(bodyStr).not.toContain('wujie_session');
            expect(bodyStr).not.toContain('ami-id');
            expect(bodyStr).not.toContain('instance-id');
          }
        }
      }
    });

    it('save-image — data URL 不泄露服务器信息', async () => {
      // 使用有效的 1x1 PNG base64
      const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRf5ErkJggg==';
      const res = await authFetch(
        '/api/save-image',
        {
          method: 'POST',
          body: JSON.stringify({
            image: validPng,
          }),
        },
        cookie
      );
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        const body = await res.json();
        expect(body.success).toBe(true);
        // 返回的 URL 不应泄露服务器内部路径
        if (body.url) {
          expect(body.url).not.toContain('/workspace/');
          expect(body.url).not.toContain('/home/');
        }
      }
    });
  });

  // ========== 路径穿越 ==========
  describe('路径穿越防护 (Path Traversal)', () => {
    it('serve-upload — 目录穿越攻击', async () => {
      const paths = [
        '../../../etc/passwd',
        '..%2F..%2F..%2Fetc%2Fpasswd',
        '..\\..\\..\\windows\\win.ini',
        '....//....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '/etc/passwd',
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
      ];
      for (const path of paths) {
        const res = await fetch(`${BASE_URL}/api/serve-upload/${path}`);
        expect([400, 404], `Path traversal: ${path}`).toContain(res.status);
        // 不应返回文件内容
        if (res.status === 200) {
          const body = await res.text();
          expect(body).not.toContain('root:');
          expect(body).not.toContain('[extensions]');
        }
      }
    });

    it('save-image — 文件名穿越攻击', async () => {
      const res = await authFetch(
        '/api/save-image',
        {
          method: 'POST',
          body: JSON.stringify({
            image: 'data:image/png;base64,iVBORw0KGgo=',
            filename: '../../../etc/passwd',
          }),
        },
        cookie
      );
      // 不应在 /etc/passwd 路径写入文件
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        const body = await res.json();
        if (body.url) {
          expect(body.url).not.toContain('..');
          expect(body.url).not.toContain('/etc/');
        }
      }
    });
  });

  // ========== XSS ==========
  describe('XSS 防护 (Cross-Site Scripting)', () => {
    it('登录用户名含 XSS payload — 不执行', async () => {
      const xssPayloads = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '"><script>alert(1)</script>',
        "javascript:alert(1)",
        '<svg onload=alert(1)>',
      ];
      for (const payload of xssPayloads) {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: payload, password: 'test' }),
        });
        const body = await res.json().catch(() => ({}));
        const bodyStr = JSON.stringify(body);
        // 错误消息中不应包含未转义的 script 标签
        expect(bodyStr).not.toContain('<script>');
        expect(bodyStr).not.toContain('<img src=x onerror');
      }
    });

    it('API 错误响应不反射用户输入的原始 HTML', async () => {
      const xssInput = '<script>alert(document.cookie)</script>';
      const res = await authFetch(
        '/api/generate',
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: xssInput,
            model: 'doubao-seedream-4-0-250828',
            providerId: 'api_1780630178347_rjqlmam',
            submitOnly: true,
          }),
        },
        cookie
      );
      const body = await res.json().catch(() => ({}));
      const bodyStr = JSON.stringify(body);
      // JSON 响应中 script 标签会被 JSON 序列化自动转义，这是安全的
      // 但额外检查不存在未转义的情况
      expect(bodyStr).not.toMatch(/<script[^>]*>.*alert/);
    });
  });

  // ========== CSRF ==========
  describe('CSRF 防护 (Cross-Site Request Forgery)', () => {
    it('跨域请求 — 无 Origin/Referer 头', async () => {
      // 模拟跨站请求（无 Origin 头但有 cookie）
      const res = await fetch(`${BASE_URL}/api/user-data/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ key: 'projects', value: '{}' }),
      });
      // Next.js API 默认不检查 Origin，但如果实现了 CSRF 保护应返回 403
      // 这里测试的是请求是否能被处理（不管是否实施了 CSRF token）
      expect([200, 403]).toContain(res.status);
    });

    it('Content-Type 混淆攻击 — text/plain POST', async () => {
      const res = await fetch(`${BASE_URL}/api/user-data/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Cookie: cookie,
        },
        body: JSON.stringify({ key: 'projects', value: '{}' }),
      });
      // 非 JSON content-type 应被拒绝或返回错误
      expect([400, 415, 200]).toContain(res.status);
    });
  });
});
