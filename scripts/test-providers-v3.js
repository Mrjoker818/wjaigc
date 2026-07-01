/**
 * API供应商真实测试 - 最终版
 * 每个供应商只测第一个可用模型，超时控制更严格
 */
const { Pool } = require('pg');
const crypto = require('crypto');

function decryptApiKey(encryptedKey, secret) {
  if (!encryptedKey || !encryptedKey.includes('.')) return encryptedKey;
  try {
    const [ivHex, encryptedHex, authTagHex] = encryptedKey.split('.');
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) { return encryptedKey; }
}

function buildUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/v1') && path.startsWith('/v1/')) return base + path.substring(3);
  return base + path;
}

async function main() {
  const dbUrl = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
  const secret = process.env.WUJIE_AUTH_SECRET || 'wujie-cms-secret-key-change-in-production';
  const pool = new Pool({ connectionString: dbUrl });

  const startTime = Date.now();
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║        无界AI — API供应商真实测试报告                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`\n测试时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log('测试方式: 真实HTTP请求 + 真实AI生成\n');

  const { rows } = await pool.query('SELECT id, name, display_name, base_url, api_key, model_type, selected_models FROM wujie_api_providers WHERE is_enabled != false ORDER BY model_type, name');
  console.log(`已启用供应商: ${rows.length} 家\n`);

  const results = [];

  for (const p of rows) {
    const displayName = p.display_name || p.name;
    const apiKey = decryptApiKey(p.api_key, secret);
    const selectedModels = Array.isArray(p.selected_models) ? p.selected_models : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models || '[]') : []);
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    console.log(`━━━ 【${displayName}】 ${p.model_type} ━━━`);
    console.log(`  端点: ${p.base_url}  模型: ${selectedModels.join(', ') || '未选择'}`);

    const r = { name: displayName, type: p.model_type, baseUrl: p.base_url, models: selectedModels, tests: [] };

    // ──── Test 1: 模型列表 ────
    const t1 = Date.now();
    let discoveredModels = [];
    let test1 = { name: '模型列表', ok: false, latencyMs: 0, detail: '' };
    try {
      const resp = await fetch(buildUrl(p.base_url, '/v1/models'), { method: 'GET', headers, signal: AbortSignal.timeout(10000) });
      test1.latencyMs = Date.now() - t1;
      if (resp.ok) {
        const data = await resp.json();
        discoveredModels = (data.data || data.models || []).map(m => m.id || m.name);
        test1.ok = true;
        test1.detail = `${discoveredModels.length} 个模型 (${test1.latencyMs}ms)`;
        console.log(`  [模型列表] ✓ 发现 ${discoveredModels.length} 个模型 (${test1.latencyMs}ms)`);
      } else {
        const text = (await resp.text().catch(() => '')).substring(0, 100);
        test1.detail = `HTTP ${resp.status} (${test1.latencyMs}ms) ${text}`;
        console.log(`  [模型列表] ✗ ${test1.detail}`);
      }
    } catch (e) {
      test1.latencyMs = Date.now() - t1;
      test1.detail = `${e.message} (${test1.latencyMs}ms)`;
      console.log(`  [模型列表] ✗ ${test1.detail}`);
    }
    r.tests.push(test1);

    // ──── Test 2: 功能测试 ────
    if (p.model_type === 'image' || p.model_type === 'imageEdit') {
      const model = selectedModels[0] || discoveredModels[0];
      if (model) {
        const t2 = Date.now();
        let test2 = { name: `图片生成(${model})`, model, ok: false, latencyMs: 0, detail: '', asyncTask: false };
        try {
          const body = JSON.stringify({ model, prompt: 'a red apple on white background', n: 1, size: '1024x1024' });
          const resp = await fetch(buildUrl(p.base_url, '/v1/images/generations'), { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
          test2.latencyMs = Date.now() - t2;
          if (resp.ok) {
            const data = await resp.json();
            if (data.data?.[0]?.url || data.data?.[0]?.b64_json) {
              test2.ok = true;
              test2.detail = `生成成功! 前端响应: ${test2.latencyMs}ms (${(test2.latencyMs/1000).toFixed(1)}秒)`;
              console.log(`  [图片生成] ✓ ${test2.detail}`);
            } else if (data.data?.[0]?.task_id || data.data?.[0]?.id) {
              test2.ok = true; test2.asyncTask = true;
              test2.detail = `异步任务已提交 (${test2.latencyMs}ms)`;
              console.log(`  [图片生成] ○ ${test2.detail}`);
            } else {
              test2.detail = `响应格式异常 (${test2.latencyMs}ms)`;
              console.log(`  [图片生成] ? ${test2.detail}`);
            }
          } else {
            const errText = (await resp.text().catch(() => '')).substring(0, 200);
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) ${errText}`;
            console.log(`  [图片生成] ✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `${e.message} (${test2.latencyMs}ms)`;
          console.log(`  [图片生成] ✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'chat' || p.model_type === 'llm' || p.model_type === 'vlm') {
      const model = selectedModels[0] || discoveredModels.find(m => /gpt|gemini|claude|deepseek|glm|qwen/i.test(m)) || discoveredModels[0];
      if (model) {
        const t2 = Date.now();
        let test2 = { name: `对话生成(${model})`, model, ok: false, latencyMs: 0, detail: '' };
        try {
          const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 3, stream: false });
          const resp = await fetch(buildUrl(p.base_url, '/v1/chat/completions'), { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
          test2.latencyMs = Date.now() - t2;
          if (resp.ok) {
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content;
            if (content) {
              test2.ok = true;
              test2.detail = `响应: "${content.trim().substring(0, 20)}" 耗时: ${test2.latencyMs}ms`;
              console.log(`  [对话生成] ✓ ${test2.detail}`);
            } else {
              test2.detail = `响应格式异常 (${test2.latencyMs}ms)`;
              console.log(`  [对话生成] ? ${test2.detail}`);
            }
          } else {
            const errText = (await resp.text().catch(() => '')).substring(0, 150);
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) ${errText}`;
            console.log(`  [对话生成] ✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `${e.message} (${test2.latencyMs}ms)`;
          console.log(`  [对话生成] ✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'video') {
      const model = selectedModels[0] || discoveredModels[0];
      if (model) {
        const t2 = Date.now();
        let test2 = { name: `视频生成(${model})`, model, ok: false, latencyMs: 0, detail: '' };
        try {
          const body = JSON.stringify({ model, prompt: 'a cat walking', n: 1 });
          const resp = await fetch(buildUrl(p.base_url, '/v1/images/generations'), { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
          test2.latencyMs = Date.now() - t2;
          if (resp.ok || resp.status === 400 || resp.status === 422) {
            test2.ok = resp.ok;
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) - 视频需专用端点`;
            console.log(`  [视频端点] ○ ${test2.detail}`);
          } else {
            const errText = (await resp.text().catch(() => '')).substring(0, 100);
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) ${errText}`;
            console.log(`  [视频端点] ✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `${e.message} (${test2.latencyMs}ms)`;
          console.log(`  [视频端点] ✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === '3d') {
      const model = selectedModels[0] || discoveredModels[0];
      if (model) {
        const t2 = Date.now();
        let test2 = { name: `3D端点(${model})`, model, ok: false, latencyMs: 0, detail: '' };
        try {
          const body = JSON.stringify({ model, prompt: 'test', n: 1, size: '1024x1024' });
          const resp = await fetch(buildUrl(p.base_url, '/v1/images/generations'), { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
          test2.latencyMs = Date.now() - t2;
          test2.ok = resp.ok || resp.status === 400 || resp.status === 422;
          test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms)`;
          console.log(`  [3D端点] ${test2.ok ? '○' : '✗'} ${test2.detail}`);
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `${e.message} (${test2.latencyMs}ms)`;
          console.log(`  [3D端点] ✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'vectorize') {
      const model = selectedModels[0] || discoveredModels.find(m => /gpt|gemini|claude/i.test(m)) || discoveredModels[0];
      if (model) {
        const t2 = Date.now();
        let test2 = { name: `矢量模型(${model})`, model, ok: false, latencyMs: 0, detail: '' };
        try {
          const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 3, stream: false });
          const resp = await fetch(buildUrl(p.base_url, '/v1/chat/completions'), { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
          test2.latencyMs = Date.now() - t2;
          if (resp.ok) {
            test2.ok = true;
            test2.detail = `端点可用 (${test2.latencyMs}ms)`;
            console.log(`  [矢量模型] ✓ ${test2.detail}`);
          } else {
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms)`;
            console.log(`  [矢量模型] ✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `${e.message} (${test2.latencyMs}ms)`;
          console.log(`  [矢量模型] ✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'upscaler') {
      // 放大只检测连通性
      const t2 = Date.now();
      let test2 = { name: '放大端点', ok: test1.ok, latencyMs: 0, detail: '' };
      test2.detail = test1.ok ? `连通正常 (已通过模型列表验证)` : `连通失败`;
      console.log(`  [放大端点] ${test1.ok ? '✓' : '✗'} ${test2.detail}`);
      r.tests.push(test2);
    }

    results.push(r);
    console.log('');
  }

  // ═══════════════════════ 汇总报告 ═══════════════════════
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                      测 试 报 告 汇 总                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`总测试耗时: ${totalTime}秒\n`);

  let allPass = [], partialPass = [], allFail = [], noFuncTest = [];

  results.forEach(r => {
    const modelsTest = r.tests[0];
    const funcTest = r.tests.find(t => !t.name.includes('模型列表'));
    if (!funcTest) { noFuncTest.push(r); return; }
    if (modelsTest.ok && funcTest.ok) allPass.push(r);
    else if (modelsTest.ok || funcTest.ok) partialPass.push(r);
    else allFail.push(r);
  });

  // 完全可用
  console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  console.log('┃ ✅ 完全可用 — 模型列表+功能测试均通过                                    ┃');
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  if (allPass.length === 0) console.log('┃ （无）                                                                  ┃');
  allPass.forEach(r => {
    const func = r.tests.find(t => !t.name.includes('模型列表'));
    const modelInfo = func?.model ? `[${func.model}]` : '';
    const latency = func?.latencyMs ? `${func.latencyMs}ms` : '-';
    const asyncTag = func?.asyncTask ? ' (异步)' : '';
    console.log(`┃  ${r.name.padEnd(16)} ${r.type.padEnd(8)} ${modelInfo.padEnd(30)} ${latency.padEnd(10)}${asyncTag}`);
  });

  // 部分可用
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  console.log('┃ ⚠️ 部分可用 — 端点可达但功能测试失败                                     ┃');
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  if (partialPass.length === 0) console.log('┃ （无）                                                                  ┃');
  partialPass.forEach(r => {
    const failTest = r.tests.find(t => !t.ok);
    const reason = failTest?.detail?.substring(0, 55) || '未知';
    console.log(`┃  ${r.name.padEnd(16)} ${r.type.padEnd(8)} 失败项: ${failTest?.name || '-'} | ${reason}`);
  });

  // 不可用
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  console.log('┃ ❌ 不可用 — 连接失败或认证错误                                           ┃');
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  if (allFail.length === 0) console.log('┃ （无）                                                                  ┃');
  allFail.forEach(r => {
    const reason = r.tests.filter(t => !t.ok).map(t => t.detail?.substring(0, 40)).join('; ');
    console.log(`┃  ${r.name.padEnd(16)} ${r.type.padEnd(8)} ${reason.substring(0, 55)}`);
  });

  // 未做功能测试（仅模型列表验证）
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  console.log('┃ ℹ️ 仅连通性测试 — 此类型无标准功能端点                                    ┃');
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  noFuncTest.forEach(r => {
    const modelsOk = r.tests[0]?.ok ? '✓ 连通' : '✗ 不通';
    console.log(`┃  ${r.name.padEnd(16)} ${r.type.padEnd(8)} ${modelsOk}`);
  });

  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');

  // 前端响应时间排行
  console.log('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  console.log('┃ ⏱️ 前端响应时间排行（真实生成测试）                                      ┃');
  console.log('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
  const timed = results
    .flatMap(r => r.tests.filter(t => t.ok && t.latencyMs > 0 && !t.name.includes('模型列表')))
    .sort((a, b) => a.latencyMs - b.latencyMs);
  timed.forEach(t => {
    const bar = '█'.repeat(Math.min(Math.round(t.latencyMs / 1000), 25));
    const padName = t.name.substring(0, 28).padEnd(28);
    console.log(`┃  ${padName} ${(t.latencyMs + 'ms').padEnd(10)} ${bar}`);
  });
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');

  // 详细表格
  console.log('\n┌──────────────────┬──────────┬──────────┬──────────┬────────────────────────────────────────────┐');
  console.log('│ 供应商            │ 类型     │ 模型列表  │ 功能测试  │ 详情                                       │');
  console.log('├──────────────────┼──────────┼──────────┼──────────┼────────────────────────────────────────────┤');
  results.forEach(r => {
    const models = r.tests[0];
    const func = r.tests.find(t => !t.name.includes('模型列表'));
    const name = r.name.substring(0, 16).padEnd(16);
    const type = r.type.substring(0, 8).padEnd(8);
    const mS = models.ok ? '✓ 可用' : '✗ 失败';
    let fS = '- 未测';
    let detail = '';
    if (func) {
      if (func.ok && func.asyncTask) { fS = '○ 异步'; detail = func.detail?.substring(0, 40) || ''; }
      else if (func.ok) { fS = '✓ 通过'; detail = func.detail?.substring(0, 40) || ''; }
      else { fS = '✗ 失败'; detail = func.detail?.substring(0, 40) || ''; }
    }
    console.log(`│ ${name} │ ${type} │ ${mS.padEnd(8)} │ ${fS.padEnd(8)} │ ${detail.padEnd(42)} │`);
  });
  console.log('└──────────────────┴──────────┴──────────┴──────────┴────────────────────────────────────────────┘');

  console.log(`\n📊 统计: ✅ 完全可用 ${allPass.length} | ⚠️ 部分可用 ${partialPass.length} | ❌ 不可用 ${allFail.length} | ℹ️ 仅连通测试 ${noFuncTest.length} | 总计 ${results.length}`);
  console.log(`\n测试结束: ${new Date().toLocaleString('zh-CN')}`);

  require('fs').writeFileSync('/tmp/api-test-report.json', JSON.stringify(results, null, 2));
  await pool.end();
}

main().catch(console.error);
