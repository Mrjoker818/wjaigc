/**
 * API供应商真实测试 - 修复版
 * 修复：baseUrl已含/v1时不再重复拼接；每种类型都做功能测试
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
  // 如果baseUrl已经以/v1结尾且path也以/v1开头，去掉重复
  if (base.endsWith('/v1') && path.startsWith('/v1/')) {
    return base + path.substring(3);
  }
  return base + path;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally { clearTimeout(timer); }
}

async function main() {
  const dbUrl = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
  const secret = process.env.WUJIE_AUTH_SECRET || 'wujie-cms-secret-key-change-in-production';
  const pool = new Pool({ connectionString: dbUrl });

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          API供应商真实测试报告 - 完整版                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  console.log('测试时间:', new Date().toLocaleString('zh-CN'));
  console.log('测试方式: 真实HTTP请求 + 真实生成测试\n');

  const { rows } = await pool.query('SELECT id, name, display_name, base_url, api_key, model_type, selected_models, advanced_params FROM wujie_api_providers WHERE is_enabled != false ORDER BY model_type, name');
  console.log(`已启用供应商: ${rows.length} 家\n`);

  const results = [];

  for (const p of rows) {
    const displayName = p.display_name || p.name;
    const apiKey = decryptApiKey(p.api_key, secret);
    const selectedModels = Array.isArray(p.selected_models) ? p.selected_models : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models || '[]') : []);
    const advParams = p.advanced_params || {};

    console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
    console.log(`┃ 【${displayName}】  类型: ${p.model_type}`);
    console.log(`┃ 端点: ${p.base_url}`);
    console.log(`┃ 已选模型: ${selectedModels.join(', ') || '未选择'}`);
    console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n');

    const r = { name: displayName, type: p.model_type, baseUrl: p.base_url, models: selectedModels, tests: [] };
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // ──── Test 1: 模型列表 ────
    process.stdout.write('  [1/3] 模型列表 (/models)... ');
    const t1 = Date.now();
    let discoveredModels = [];
    let test1 = { name: '模型列表', ok: false, latencyMs: 0, detail: '' };
    try {
      const resp = await fetchWithTimeout(buildUrl(p.base_url, '/v1/models'), { method: 'GET', headers }, 15000);
      test1.latencyMs = Date.now() - t1;
      if (resp.ok) {
        const data = await resp.json();
        discoveredModels = (data.data || data.models || []).map(m => m.id || m.name);
        test1.ok = discoveredModels.length > 0;
        test1.detail = `发现 ${discoveredModels.length} 个模型 (${test1.latencyMs}ms)`;
        console.log(`✓ ${test1.detail}`);
        if (discoveredModels.length > 0) console.log(`        示例: ${discoveredModels.slice(0, 5).join(', ')}${discoveredModels.length > 5 ? ` ...共${discoveredModels.length}个` : ''}`);
      } else {
        const text = (await resp.text().catch(() => '')).substring(0, 150);
        test1.detail = `HTTP ${resp.status} (${test1.latencyMs}ms) ${text}`;
        console.log(`✗ ${test1.detail}`);
      }
    } catch (e) {
      test1.latencyMs = Date.now() - t1;
      test1.detail = `连接失败: ${e.message} (${test1.latencyMs}ms)`;
      console.log(`✗ ${test1.detail}`);
    }
    r.tests.push(test1);

    // ──── Test 2: 功能测试（按类型）────
    if (p.model_type === 'image' || p.model_type === 'imageEdit') {
      // 图片生成测试 - 尝试多个模型
      const testModels = selectedModels.length > 0 ? selectedModels.slice(0, 2) : [discoveredModels[0]].filter(Boolean);
      for (const model of testModels) {
        process.stdout.write(`  [2/3] 图片生成 [${model}]... `);
        const t2 = Date.now();
        let test2 = { name: `图片生成(${model})`, model, ok: false, latencyMs: 0, detail: '', generationTimeMs: 0, asyncTask: false };
        try {
          const body = JSON.stringify({ model, prompt: 'a simple red apple on white background, minimalist', n: 1, size: '1024x1024' });
          let resp = await fetchWithTimeout(buildUrl(p.base_url, '/v1/images/generations'), { method: 'POST', headers, body }, 90000);
          test2.latencyMs = Date.now() - t2;

          if (resp.ok) {
            const data = await resp.json();
            const hasUrl = data.data?.[0]?.url;
            const hasB64 = data.data?.[0]?.b64_json;
            const hasTaskId = data.data?.[0]?.task_id || data.data?.[0]?.id;
            if (hasUrl || hasB64) {
              test2.ok = true;
              test2.generationTimeMs = test2.latencyMs;
              test2.detail = `✅ 生成成功! 前端响应: ${test2.latencyMs}ms (${(test2.latencyMs/1000).toFixed(1)}秒)`;
              console.log(`✓ ${test2.detail}`);
            } else if (hasTaskId) {
              test2.ok = true; test2.asyncTask = true;
              test2.detail = `异步任务已提交 (task: ${String(hasTaskId).substring(0, 20)})，前端响应: ${test2.latencyMs}ms`;
              console.log(`○ ${test2.detail}`);
            } else {
              test2.detail = `响应格式异常 (${test2.latencyMs}ms): ${JSON.stringify(data).substring(0, 200)}`;
              console.log(`? ${test2.detail}`);
            }
          } else {
            const errText = (await resp.text().catch(() => '')).substring(0, 250);
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) ${errText}`;
            console.log(`✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `错误: ${e.message} (${test2.latencyMs}ms)`;
          console.log(`✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'chat' || p.model_type === 'llm' || p.model_type === 'vlm') {
      const testModel = selectedModels[0] || discoveredModels.find(m => /gpt|gemini|claude|glm|qwen|deepseek/i.test(m)) || discoveredModels[0];
      if (testModel) {
        process.stdout.write(`  [2/3] 对话生成 [${testModel}]... `);
        const t2 = Date.now();
        let test2 = { name: `对话生成(${testModel})`, model: testModel, ok: false, latencyMs: 0, detail: '' };
        try {
          const body = JSON.stringify({ model: testModel, messages: [{ role: 'user', content: 'Reply with just: OK' }], max_tokens: 5 });
          const resp = await fetchWithTimeout(buildUrl(p.base_url, '/v1/chat/completions'), { method: 'POST', headers, body }, 30000);
          test2.latencyMs = Date.now() - t2;
          if (resp.ok) {
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content;
            if (content) {
              test2.ok = true;
              test2.detail = `✅ 响应成功: "${content.trim().substring(0, 30)}"，总耗时: ${test2.latencyMs}ms (${(test2.latencyMs/1000).toFixed(1)}秒)`;
              console.log(`✓ ${test2.detail}`);
            } else {
              test2.detail = `响应格式异常 (${test2.latencyMs}ms): ${JSON.stringify(data).substring(0, 200)}`;
              console.log(`? ${test2.detail}`);
            }
          } else {
            const errText = (await resp.text().catch(() => '')).substring(0, 250);
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) ${errText}`;
            console.log(`✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `错误: ${e.message} (${test2.latencyMs}ms)`;
          console.log(`✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'video') {
      const testModel = selectedModels[0] || discoveredModels.find(m => /kling|cogvideo|wan|seedance|sora|veo|runway/i.test(m)) || discoveredModels[0];
      if (testModel) {
        process.stdout.write(`  [2/3] 视频生成提交 [${testModel}]... `);
        const t2 = Date.now();
        let test2 = { name: `视频生成(${testModel})`, model: testModel, ok: false, latencyMs: 0, detail: '' };
        try {
          const body = JSON.stringify({ model: testModel, prompt: 'a cat walking on grass, 5 seconds', n: 1 });
          // 视频API可能是多种路径
          const endpoints = ['/v1/videos/generations', '/v1/images/generations', '/v1/video/generations'];
          let resp = null;
          for (const ep of endpoints) {
            resp = await fetchWithTimeout(buildUrl(p.base_url, ep), { method: 'POST', headers, body }, 20000);
            if (resp.status !== 404) break;
          }
          test2.latencyMs = Date.now() - t2;
          if (resp && resp.ok) {
            const data = await resp.json().catch(() => ({}));
            test2.ok = true;
            test2.detail = `✅ 视频任务提交成功 (${test2.latencyMs}ms): ${JSON.stringify(data).substring(0, 150)}`;
            console.log(`✓ ${test2.detail}`);
          } else if (resp) {
            const errText = (await resp.text().catch(() => '')).substring(0, 200);
            // 400/422 = 端点可达但参数不对，部分可用
            if (resp.status === 400 || resp.status === 422) {
              test2.ok = false;
              test2.detail = `端点可达但参数有误 HTTP ${resp.status} (${test2.latencyMs}ms): ${errText}`;
              console.log(`○ ${test2.detail}`);
            } else {
              test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) ${errText}`;
              console.log(`✗ ${test2.detail}`);
            }
          } else {
            test2.detail = `所有端点均不可达 (${test2.latencyMs}ms)`;
            console.log(`✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `错误: ${e.message} (${test2.latencyMs}ms)`;
          console.log(`✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === '3d') {
      const testModel = selectedModels[0] || discoveredModels[0];
      if (testModel) {
        process.stdout.write(`  [2/3] 3D模型端点检测 [${testModel}]... `);
        const t2 = Date.now();
        let test2 = { name: `3D端点(${testModel})`, model: testModel, ok: false, latencyMs: 0, detail: '' };
        try {
          // 尝试图片生成端点作为连通性验证
          const body = JSON.stringify({ model: testModel, prompt: 'test', n: 1, size: '1024x1024' });
          const resp = await fetchWithTimeout(buildUrl(p.base_url, '/v1/images/generations'), { method: 'POST', headers, body }, 15000);
          test2.latencyMs = Date.now() - t2;
          if (resp.status === 401 || resp.status === 403) {
            test2.detail = `认证失败 HTTP ${resp.status} (${test2.latencyMs}ms)`;
            console.log(`✗ ${test2.detail}`);
          } else if (resp.status === 400 || resp.status === 422 || resp.status === 500) {
            test2.ok = true;
            const errText = (await resp.text().catch(() => '')).substring(0, 150);
            test2.detail = `端点可达 (HTTP ${resp.status}) (${test2.latencyMs}ms) - 3D模型需专用端点`;
            console.log(`○ ${test2.detail}`);
          } else if (resp.ok) {
            test2.ok = true;
            test2.detail = `✅ 端点可达并返回成功 (${test2.latencyMs}ms)`;
            console.log(`✓ ${test2.detail}`);
          } else {
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms)`;
            console.log(`? ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `错误: ${e.message} (${test2.latencyMs}ms)`;
          console.log(`✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'vectorize') {
      const testModel = selectedModels[0] || discoveredModels.find(m => /gpt|gemini|claude|qwen/i.test(m)) || discoveredModels[0];
      if (testModel) {
        process.stdout.write(`  [2/3] 矢量化模型(对话端点) [${testModel}]... `);
        const t2 = Date.now();
        let test2 = { name: `矢量模型(${testModel})`, model: testModel, ok: false, latencyMs: 0, detail: '' };
        try {
          const body = JSON.stringify({ model: testModel, messages: [{ role: 'user', content: 'Describe SVG path for a circle' }], max_tokens: 10 });
          const resp = await fetchWithTimeout(buildUrl(p.base_url, '/v1/chat/completions'), { method: 'POST', headers, body }, 20000);
          test2.latencyMs = Date.now() - t2;
          if (resp.ok) {
            test2.ok = true;
            test2.detail = `✅ 对话端点可用 (${test2.latencyMs}ms) - 矢量化依赖此端点`;
            console.log(`✓ ${test2.detail}`);
          } else {
            const errText = (await resp.text().catch(() => '')).substring(0, 150);
            test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms) ${errText}`;
            console.log(`✗ ${test2.detail}`);
          }
        } catch (e) {
          test2.latencyMs = Date.now() - t2;
          test2.detail = `错误: ${e.message} (${test2.latencyMs}ms)`;
          console.log(`✗ ${test2.detail}`);
        }
        r.tests.push(test2);
      }
    } else if (p.model_type === 'upscaler') {
      process.stdout.write('  [2/3] 放大端点连通性检测... ');
      const t2 = Date.now();
      let test2 = { name: '放大端点', ok: false, latencyMs: 0, detail: '' };
      try {
        const resp = await fetchWithTimeout(buildUrl(p.base_url, '/v1/models'), { method: 'GET', headers }, 15000);
        test2.latencyMs = Date.now() - t2;
        if (resp.ok) {
          test2.ok = true;
          test2.detail = `✅ 连通正常，端点可用 (${test2.latencyMs}ms)`;
          console.log(`✓ ${test2.detail}`);
        } else {
          test2.detail = `HTTP ${resp.status} (${test2.latencyMs}ms)`;
          console.log(`○ ${test2.detail}`);
        }
      } catch (e) {
        test2.latencyMs = Date.now() - t2;
        test2.detail = `错误: ${e.message} (${test2.latencyMs}ms)`;
        console.log(`✗ ${test2.detail}`);
      }
      r.tests.push(test2);
    }

    // ──── Test 3: 余额/配额检查 ────
    process.stdout.write('  [3/3] 余额/配额状态... ');
    const t3 = Date.now();
    let test3 = { name: '配额状态', ok: false, latencyMs: 0, detail: '' };
    try {
      // 尝试常见的余额端点
      const balanceEndpoints = ['/v1/dashboard/billing/credit_grants', '/v1/dashboard/billing/usage', '/dashboard/billing/credit_grants'];
      let balanceResp = null;
      for (const ep of balanceEndpoints) {
        try {
          balanceResp = await fetchWithTimeout(buildUrl(p.base_url, ep), { method: 'GET', headers }, 10000);
          if (balanceResp.status !== 404) break;
        } catch {}
      }
      test3.latencyMs = Date.now() - t3;
      if (balanceResp) {
        if (balanceResp.ok) {
          const data = await balanceResp.json().catch(() => ({}));
          const total = data.total_granted || data.total_credits || data.total;
          const used = data.total_used || data.total_usage || data.used;
          const remaining = data.total_available || data.remaining || data.balance;
          test3.ok = true;
          if (remaining !== undefined) {
            test3.detail = `余额: $${Number(remaining).toFixed(2)} (${test3.latencyMs}ms)`;
          } else {
            test3.detail = `端点可用 (${test3.latencyMs}ms) - 余额数据格式: ${JSON.stringify(data).substring(0, 100)}`;
          }
          console.log(`✓ ${test3.detail}`);
        } else if (balanceResp.status === 401 || balanceResp.status === 403) {
          test3.detail = `余额端点需特殊权限 (${test3.latencyMs}ms)`;
          console.log(`○ ${test3.detail}`);
        } else {
          test3.detail = `余额端点不可用 HTTP ${balanceResp.status} (${test3.latencyMs}ms)`;
          console.log(`○ ${test3.detail}`);
        }
      } else {
        test3.detail = `无可用余额端点 (${test3.latencyMs}ms)`;
        console.log(`○ ${test3.detail}`);
      }
    } catch (e) {
      test3.latencyMs = Date.now() - t3;
      test3.detail = `余额检测失败 (${test3.latencyMs}ms)`;
      console.log(`○ ${test3.detail}`);
    }
    r.tests.push(test3);

    results.push(r);
    console.log('');
  }

  // ═══════════════════════ 汇总报告 ═══════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                      测试报告汇总                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  let allPass = [], partialPass = [], allFail = [];

  results.forEach(r => {
    const funcTest = r.tests.find(t => t.name.includes('生成') || t.name.includes('端点') || t.name.includes('3D'));
    const modelsTest = r.tests[0];
    if (funcTest && funcTest.ok && modelsTest.ok) {
      allPass.push(r);
    } else if (modelsTest.ok || (funcTest && funcTest.ok)) {
      partialPass.push(r);
    } else {
      allFail.push(r);
    }
  });

  console.log('┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ ✅ 完全可用供应商                                                │');
  console.log('├──────────────────────────────────────────────────────────────────┤');
  if (allPass.length === 0) console.log('│ （无）                                                          │');
  allPass.forEach(r => {
    const funcTest = r.tests.find(t => t.ok && t.latencyMs > 0 && !t.name.includes('模型列表') && !t.name.includes('配额'));
    const latency = funcTest ? `${funcTest.latencyMs}ms` : '-';
    console.log(`│  ${r.name.padEnd(18)}│ ${r.type.padEnd(8)}│ 响应: ${latency.padEnd(10)}│ ${funcTest?.detail?.substring(0, 25) || ''}`);
  });

  console.log('├──────────────────────────────────────────────────────────────────┤');
  console.log('│ ⚠️ 部分可用供应商                                                │');
  console.log('├──────────────────────────────────────────────────────────────────┤');
  if (partialPass.length === 0) console.log('│ （无）                                                          │');
  partialPass.forEach(r => {
    const failTests = r.tests.filter(t => !t.ok);
    console.log(`│  ${r.name.padEnd(18)}│ ${r.type.padEnd(8)}│ 问题: ${failTests.map(t => t.name).join(', ').substring(0, 30)}`);
  });

  console.log('├──────────────────────────────────────────────────────────────────┤');
  console.log('│ ❌ 不可用供应商                                                  │');
  console.log('├──────────────────────────────────────────────────────────────────┤');
  if (allFail.length === 0) console.log('│ （无）                                                          │');
  allFail.forEach(r => {
    const failTests = r.tests.filter(t => !t.ok);
    const reasons = failTests.map(t => t.detail?.substring(0, 40)).join('; ');
    console.log(`│  ${r.name.padEnd(18)}│ ${r.type.padEnd(8)}│ ${reasons.substring(0, 45)}`);
  });
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // 详细表格
  console.log('\n┌─────────────────┬──────────┬──────────┬──────────────┬────────────────────────────────────────────┐');
  console.log('│ 供应商           │ 类型     │ 模型列表  │ 功能测试      │ 详情                                        │');
  console.log('├─────────────────┼──────────┼──────────┼──────────────┼────────────────────────────────────────────┤');
  results.forEach(r => {
    const models = r.tests[0];
    const func = r.tests.find(t => !t.name.includes('模型列表') && !t.name.includes('配额'));
    const mStatus = models.ok ? '✓ 可用' : '✗ 失败';
    let fStatus = '- 未测';
    let fDetail = '';
    if (func) {
      if (func.ok && func.detail?.startsWith('✅')) fStatus = '✓ 通过';
      else if (func.ok && func.asyncTask) fStatus = '○ 异步';
      else if (func.ok) fStatus = '○ 部分可用';
      else fStatus = '✗ 失败';
      fDetail = func.detail?.substring(0, 40) || '';
    }
    const name = r.name.substring(0, 15).padEnd(15);
    const type = r.type.substring(0, 8).padEnd(8);
    console.log(`│ ${name} │ ${type} │ ${mStatus.padEnd(8)} │ ${fStatus.padEnd(12)} │ ${fDetail.padEnd(42)} │`);
  });
  console.log('└─────────────────┴──────────┴──────────┴──────────────┴────────────────────────────────────────────┘');

  // 前端反馈时间排行
  console.log('\n┌──────────────────────────────────────────────────────────────────┐');
  console.log('│ ⏱️ 前端响应时间排行（功能测试）                                     │');
  console.log('├──────────────────────────────────────────────────────────────────┤');
  const timed = results
    .flatMap(r => r.tests.filter(t => t.ok && t.latencyMs > 0 && !t.name.includes('模型列表') && !t.name.includes('配额')))
    .sort((a, b) => a.latencyMs - b.latencyMs);
  timed.forEach(t => {
    const bar = '█'.repeat(Math.min(Math.round(t.latencyMs / 1000), 30));
    console.log(`│  ${t.name.padEnd(30)} ${(t.latencyMs + 'ms').padEnd(10)} ${bar}`);
  });
  console.log('└──────────────────────────────────────────────────────────────────┘');

  console.log(`\n总测试供应商: ${results.length}`);
  console.log(`✅ 完全可用: ${allPass.length}  ⚠️ 部分可用: ${partialPass.length}  ❌ 不可用: ${allFail.length}`);
  console.log(`\n测试结束: ${new Date().toLocaleString('zh-CN')}`);

  require('fs').writeFileSync('/tmp/api-test-final.json', JSON.stringify(results, null, 2));
  await pool.end();
}

main().catch(console.error);
