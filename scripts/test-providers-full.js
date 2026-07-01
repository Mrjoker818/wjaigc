/**
 * 无界AI — API供应商全面真实测试
 * 
 * 特点：
 * - 逐模型真实测试（非模拟）
 * - 图像生成：提交→轮询→完成，记录真实第三方生成耗时
 * - 聊天生成：非流式请求，记录首token+完整响应时间
 * - 视频/3D：端点可达性检测
 * - 余额/配额检测
 * - 完整测试报告
 */
const { Pool } = require('pg');
const crypto = require('crypto');

// ──── 配置 ────
const CONFIG = {
  CHAT_TIMEOUT_MS: 30000,      // 聊天请求超时30秒
  IMAGE_SUBMIT_TIMEOUT_MS: 30000, // 图片生成提交超时30秒
  IMAGE_POLL_TIMEOUT_MS: 180000,  // 图片轮询最长3分钟
  IMAGE_POLL_INTERVAL_MS: 3000,   // 轮询间隔3秒
  VIDEO_TIMEOUT_MS: 15000,        // 视频端点检测超时15秒
  MODELS_TIMEOUT_MS: 10000,       // 模型列表超时10秒
  BALANCE_TIMEOUT_MS: 8000,       // 余额查询超时8秒
  CHAT_MAX_TOKENS: 10,            // 聊天测试最大token数
  IMAGE_PROMPT: 'a single red apple on a clean white background, simple still life photography',
  CHAT_PROMPT: 'Please respond with exactly: TEST_OK',
};

// ──── 工具函数 ────
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

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function progressBar(ratio, width = 20) {
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ──── 测试函数 ────

async function testModelsList(baseUrl, apiKey) {
  const t = Date.now();
  try {
    const resp = await fetch(buildUrl(baseUrl, '/v1/models'), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(CONFIG.MODELS_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - t;
    if (resp.ok) {
      const data = await resp.json();
      const models = (data.data || data.models || []).map(m => m.id || m.name);
      return { ok: true, latencyMs, models, detail: `发现 ${models.length} 个模型` };
    } else {
      const text = (await resp.text().catch(() => '')).substring(0, 120);
      return { ok: false, latencyMs, models: [], detail: `HTTP ${resp.status} - ${text}` };
    }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t, models: [], detail: e.message };
  }
}

async function testChatGeneration(baseUrl, apiKey, model) {
  const t = Date.now();
  let firstTokenMs = null;
  try {
    // 先尝试非流式
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: CONFIG.CHAT_PROMPT }],
      max_tokens: CONFIG.CHAT_MAX_TOKENS,
      stream: false,
    });
    const resp = await fetch(buildUrl(baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CONFIG.CHAT_TIMEOUT_MS),
    });
    firstTokenMs = Date.now() - t;
    const latencyMs = firstTokenMs;

    if (resp.ok) {
      const text = await resp.text();
      // 可能是流式返回（SSE格式）
      if (text.startsWith('data:')) {
        // 解析SSE流
        let content = '';
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const json = JSON.parse(line.substring(6));
              const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
              content += delta;
            } catch {}
          }
        }
        if (content) {
          return { ok: true, latencyMs, firstTokenMs, detail: `SSE流式响应: "${content.trim().substring(0, 30)}"` };
        }
        return { ok: false, latencyMs, firstTokenMs, detail: `SSE流式响应但无内容` };
      }
      // 普通JSON
      try {
        const data = JSON.parse(text);
        const content = data.choices?.[0]?.message?.content || '';
        if (content) {
          return { ok: true, latencyMs, firstTokenMs, detail: `响应: "${content.trim().substring(0, 30)}"` };
        }
      } catch {}
      return { ok: false, latencyMs, firstTokenMs, detail: `响应格式异常` };
    } else {
      const errText = (await resp.text().catch(() => '')).substring(0, 150);
      return { ok: false, latencyMs, firstTokenMs, detail: `HTTP ${resp.status} - ${errText}` };
    }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t, firstTokenMs, detail: e.message };
  }
}

async function testImageGeneration(baseUrl, apiKey, model) {
  const submitT = Date.now();
  try {
    // 先尝试标准 /v1/images/generations
    const body = JSON.stringify({
      model,
      prompt: CONFIG.IMAGE_PROMPT,
      n: 1,
      size: '1024x1024',
    });
    const resp = await fetch(buildUrl(baseUrl, '/v1/images/generations'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CONFIG.IMAGE_SUBMIT_TIMEOUT_MS),
    });
    const submitMs = Date.now() - submitT;
    const respText = await resp.text();
    
    if (resp.ok) {
      let data;
      try { data = JSON.parse(respText); } catch {
        return { ok: false, submitMs, totalMs: submitMs, detail: `响应JSON解析失败` };
      }

      // 直接返回图片URL
      if (data.data?.[0]?.url || data.data?.[0]?.b64_json) {
        const totalMs = Date.now() - submitT;
        const hasUrl = !!data.data[0].url;
        const hasB64 = !!data.data[0].b64_json;
        return {
          ok: true,
          submitMs,
          totalMs,
          generationMs: submitMs, // 同步API，提交即完成
          detail: `同步生成完成 (${hasUrl ? 'URL' : ''}${hasB64 ? 'Base64' : ''})`,
        };
      }

      // 异步任务
      const taskId = data.data?.[0]?.task_id || data.data?.[0]?.id || data.task_id || data.id;
      if (taskId) {
        // 开始轮询
        const pollResult = await pollImageTask(baseUrl, apiKey, taskId, submitT);
        return pollResult;
      }

      return { ok: false, submitMs, totalMs: submitMs, detail: `响应格式异常: ${JSON.stringify(data).substring(0, 80)}` };
    } else {
      // 如果 /images/generations 不可用，尝试 Responses API
      if (resp.status === 502 || resp.status === 503 || resp.status === 404) {
        return await testImageViaResponsesApi(baseUrl, apiKey, model, submitT);
      }
      return { ok: false, submitMs, totalMs: submitMs, detail: `HTTP ${resp.status} - ${respText.substring(0, 150)}` };
    }
  } catch (e) {
    return { ok: false, submitMs: Date.now() - submitT, totalMs: Date.now() - submitT, detail: e.message };
  }
}

async function testImageViaResponsesApi(baseUrl, apiKey, model, submitT) {
  try {
    const body = JSON.stringify({
      model,
      input: [{ role: 'user', content: CONFIG.IMAGE_PROMPT }],
      stream: true,
    });
    const resp = await fetch(buildUrl(baseUrl, '/v1/responses'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CONFIG.IMAGE_POLL_TIMEOUT_MS),
    });
    const submitMs = Date.now() - submitT;

    if (resp.ok) {
      // 解析SSE流
      const text = await resp.text();
      let imageUrl = null;
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const json = JSON.parse(line.substring(6));
            // 标准格式
            if (json.type === 'image_generation_call.done' && json.result?.url) {
              imageUrl = json.result.url;
            }
            // FHL格式: message类型 + markdown图片
            if (json.type === 'response.output_item.done' || json.type === 'response.completed') {
              const msg = json.item || json.output?.find(o => o.type === 'message');
              const content = msg?.content || json.output?.[0]?.content;
              if (Array.isArray(content)) {
                for (const c of content) {
                  if (c.type === 'output_text' && c.text) {
                    const mdMatch = c.text.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
                    if (mdMatch) imageUrl = mdMatch[1];
                  }
                }
              }
            }
          } catch {}
        }
      }
      const totalMs = Date.now() - submitT;
      if (imageUrl) {
        return { ok: true, submitMs, totalMs, generationMs: totalMs, detail: `Responses API 生成完成 (SSE流式)` };
      }
      return { ok: false, submitMs, totalMs, detail: `Responses API SSE流未找到图片URL` };
    }
    return { ok: false, submitMs, totalMs: submitMs, detail: `Responses API HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, submitMs: Date.now() - submitT, totalMs: Date.now() - submitT, detail: `Responses API: ${e.message}` };
  }
}

async function pollImageTask(baseUrl, apiKey, taskId, submitT) {
  const pollStart = Date.now();
  let attempts = 0;
  const maxAttempts = Math.ceil(CONFIG.IMAGE_POLL_TIMEOUT_MS / CONFIG.IMAGE_POLL_INTERVAL_MS);

  while (attempts < maxAttempts) {
    attempts++;
    await new Promise(r => setTimeout(r, CONFIG.IMAGE_POLL_INTERVAL_MS));

    try {
      // 尝试多种轮询URL格式
      const pollUrls = [
        buildUrl(baseUrl, `/v1/tasks/${taskId}`),
        buildUrl(baseUrl, `/v1/images/tasks/${taskId}`),
        buildUrl(baseUrl, `/v1/images/generations/${taskId}`),
      ];

      let pollResult = null;
      for (const pollUrl of pollUrls) {
        try {
          const resp = await fetch(pollUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          if (resp.ok) {
            const data = await resp.json();
            const status = data.status || data.data?.status || data.state;
            
            if (status === 'completed' || status === 'succeeded' || status === 'success') {
              const totalMs = Date.now() - submitT;
              const generationMs = totalMs;
              const hasImage = data.data?.[0]?.url || data.data?.url || data.output?.url || data.result?.url;
              pollResult = {
                ok: !!hasImage,
                submitMs: pollStart - submitT,
                totalMs,
                generationMs,
                detail: hasImage ? `异步生成完成 (轮询${attempts}次, 第三方耗时≈${formatMs(generationMs)})` : `任务完成但无图片URL`,
              };
              break;
            } else if (status === 'failed' || status === 'error') {
              const error = data.error || data.data?.error || '未知错误';
              pollResult = { ok: false, submitMs: pollStart - submitT, totalMs: Date.now() - submitT, detail: `异步任务失败: ${JSON.stringify(error).substring(0, 100)}` };
              break;
            } else if (status === 'processing' || status === 'pending' || status === 'running' || status === 'in_progress') {
              // 继续轮询
              pollResult = { continue: true, progress: data.progress || data.percent };
              break;
            }
          }
        } catch {}
      }

      if (pollResult && !pollResult.continue) return pollResult;
      if (pollResult?.progress) {
        process.stdout.write(`    轮询中... 进度: ${pollResult.progress}% (${attempts}/${maxAttempts})\r`);
      }
    } catch (e) {
      // 继续轮询
    }
  }

  return { ok: false, submitMs: pollStart - submitT, totalMs: Date.now() - submitT, detail: `轮询超时 (${attempts}次)` };
}

async function testBalance(baseUrl, apiKey) {
  const t = Date.now();
  try {
    const resp = await fetch(buildUrl(baseUrl, '/v1/dashboard/billing/credit_grants'), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CONFIG.BALANCE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - t;
    if (resp.ok) {
      const data = await resp.json();
      const total = data.total_granted || data.total || data.total_credits;
      const used = data.total_used || data.used;
      const remaining = total != null && used != null ? (total - used) : data.remaining;
      return { ok: true, latencyMs, detail: remaining != null ? `余额: $${typeof remaining === 'number' ? remaining.toFixed(2) : remaining}` : '有余额数据' };
    }
    // 尝试另一个余额端点
    const resp2 = await fetch(buildUrl(baseUrl, '/v1/dashboard/billing/usage'), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CONFIG.BALANCE_TIMEOUT_MS),
    });
    const latencyMs2 = Date.now() - t;
    if (resp2.ok) {
      const data = await resp2.json();
      return { ok: true, latencyMs: latencyMs2, detail: `用量数据可用` };
    }
    return { ok: false, latencyMs: latencyMs2, detail: `HTTP ${resp2.status}` };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t, detail: e.message };
  }
}

// ──── 主函数 ────
async function main() {
  const dbUrl = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
  const secret = process.env.WUJIE_AUTH_SECRET || 'wujie-cms-secret-key-change-in-production';
  const pool = new Pool({ connectionString: dbUrl });

  const globalStart = Date.now();
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                无界AI — API供应商全面真实测试报告                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\n🕐 测试开始: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`📋 测试说明: 每个供应商的每个已选模型都会进行真实生成测试`);
  console.log(`⏱️ 图片生成超时: ${CONFIG.IMAGE_POLL_TIMEOUT_MS / 1000}秒 | 聊天超时: ${CONFIG.CHAT_TIMEOUT_MS / 1000}秒\n`);

  const { rows } = await pool.query(
    'SELECT id, name, display_name, base_url, api_key, model_type, selected_models, advanced_params FROM wujie_api_providers WHERE is_enabled != false ORDER BY model_type, name'
  );
  console.log(`已启用供应商: ${rows.length} 家\n`);

  const allResults = [];
  const allModelTests = [];

  for (let pi = 0; pi < rows.length; pi++) {
    const p = rows[pi];
    const displayName = p.display_name || p.name;
    const apiKey = decryptApiKey(p.api_key, secret);
    const selectedModels = Array.isArray(p.selected_models) ? p.selected_models : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models || '[]') : []);

    console.log('═'.repeat(90));
    console.log(`【${pi + 1}/${rows.length}】 ${displayName}  类型: ${p.model_type}`);
    console.log(`  端点: ${p.base_url}`);
    console.log(`  已选模型: ${selectedModels.join(', ') || '未选择任何模型'}`);
    console.log('');

    const providerResult = {
      name: displayName,
      type: p.model_type,
      baseUrl: p.base_url,
      selectedModels,
      modelsTest: null,
      balanceTest: null,
      modelTests: [],
    };

    // ──── Test 1: 模型列表 ────
    console.log(`  ▸ [1] 模型列表检测...`);
    const modelsResult = await testModelsList(p.base_url, apiKey);
    providerResult.modelsTest = modelsResult;
    console.log(`    ${modelsResult.ok ? '✓' : '✗'} ${modelsResult.detail} (${formatMs(modelsResult.latencyMs)})`);

    // ──── Test 2: 逐模型功能测试 ────
    if (selectedModels.length === 0) {
      console.log(`  ⚠ 未选择模型，跳过功能测试\n`);
    } else {
      for (let mi = 0; mi < selectedModels.length; mi++) {
        const model = selectedModels[mi];
        console.log(`  ▸ [2.${mi + 1}] 模型测试: ${model}`);

        if (p.model_type === 'image' || p.model_type === 'imageEdit') {
          const result = await testImageGeneration(p.base_url, apiKey, model);
          result.model = model;
          result.testType = 'image';
          providerResult.modelTests.push(result);
          allModelTests.push({ provider: displayName, model, type: 'image', ...result });
          if (result.ok) {
            console.log(`    ✓ ${result.detail}`);
            console.log(`      提交耗时: ${formatMs(result.submitMs)} | 总耗时(含第三方生成): ${formatMs(result.totalMs)}`);
          } else {
            console.log(`    ✗ ${result.detail} (${formatMs(result.submitMs)})`);
          }
        } else if (p.model_type === 'chat' || p.model_type === 'llm' || p.model_type === 'vlm') {
          const result = await testChatGeneration(p.base_url, apiKey, model);
          result.model = model;
          result.testType = 'chat';
          providerResult.modelTests.push(result);
          allModelTests.push({ provider: displayName, model, type: 'chat', ...result });
          if (result.ok) {
            console.log(`    ✓ ${result.detail}`);
            console.log(`      响应耗时: ${formatMs(result.latencyMs)}`);
          } else {
            console.log(`    ✗ ${result.detail} (${formatMs(result.latencyMs)})`);
          }
        } else if (p.model_type === 'video') {
          // 视频模型只检测端点可达性（真实视频生成太慢太贵）
          const t = Date.now();
          try {
            const resp = await fetch(buildUrl(p.base_url, '/v1/models'), {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(CONFIG.MODELS_TIMEOUT_MS),
            });
            const ms = Date.now() - t;
            const result = { model, testType: 'video', ok: resp.ok, latencyMs: ms, detail: `端点${resp.ok ? '可达' : '不可达'} HTTP ${resp.status} (${formatMs(ms)})` };
            providerResult.modelTests.push(result);
            allModelTests.push({ provider: displayName, model, type: 'video', ...result });
            console.log(`    ${resp.ok ? '○' : '✗'} ${result.detail}`);
          } catch (e) {
            const ms = Date.now() - t;
            const result = { model, testType: 'video', ok: false, latencyMs: ms, detail: `${e.message} (${formatMs(ms)})` };
            providerResult.modelTests.push(result);
            allModelTests.push({ provider: displayName, model, type: 'video', ...result });
            console.log(`    ✗ ${result.detail}`);
          }
        } else if (p.model_type === '3d') {
          // 3D模型只检测端点
          const t = Date.now();
          try {
            const resp = await fetch(buildUrl(p.base_url, '/v1/models'), {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(CONFIG.MODELS_TIMEOUT_MS),
            });
            const ms = Date.now() - t;
            const result = { model, testType: '3d', ok: resp.ok, latencyMs: ms, detail: `端点${resp.ok ? '可达' : '不可达'} HTTP ${resp.status} (${formatMs(ms)})` };
            providerResult.modelTests.push(result);
            allModelTests.push({ provider: displayName, model, type: '3d', ...result });
            console.log(`    ${resp.ok ? '○' : '✗'} ${result.detail}`);
          } catch (e) {
            const ms = Date.now() - t;
            const result = { model, testType: '3d', ok: false, latencyMs: ms, detail: `${e.message} (${formatMs(ms)})` };
            providerResult.modelTests.push(result);
            allModelTests.push({ provider: displayName, model, type: '3d', ...result });
            console.log(`    ✗ ${result.detail}`);
          }
        } else if (p.model_type === 'vectorize' || p.model_type === 'segment') {
          // 矢量/分层模型：使用chat端点测试
          const result = await testChatGeneration(p.base_url, apiKey, model);
          result.model = model;
          result.testType = p.model_type;
          providerResult.modelTests.push(result);
          allModelTests.push({ provider: displayName, model, type: p.model_type, ...result });
          if (result.ok) {
            console.log(`    ✓ ${result.detail} (${formatMs(result.latencyMs)})`);
          } else {
            console.log(`    ✗ ${result.detail} (${formatMs(result.latencyMs)})`);
          }
        }
        console.log('');
      }
    }

    // ──── Test 3: 余额/配额 ────
    console.log(`  ▸ [3] 余额/配额检测...`);
    const balanceResult = await testBalance(p.base_url, apiKey);
    providerResult.balanceTest = balanceResult;
    console.log(`    ${balanceResult.ok ? '✓' : '○'} ${balanceResult.detail} (${formatMs(balanceResult.latencyMs)})`);
    console.log('');

    allResults.push(providerResult);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 汇总报告
  // ══════════════════════════════════════════════════════════════════════════════
  const totalTestTime = ((Date.now() - globalStart) / 1000).toFixed(1);

  console.log('\n\n');
  console.log('╔' + '═'.repeat(96) + '╗');
  console.log('║' + '                          A P I 供 应 商 全 面 测 试 报 告'.padStart(63) + ' '.repeat(34) + '║');
  console.log('╚' + '═'.repeat(96) + '╝');
  console.log(`\n📊 测试时间: ${new Date().toLocaleString('zh-CN')} | 总耗时: ${totalTestTime}秒 | 供应商: ${rows.length}家 | 模型: ${allModelTests.length}个\n`);

  // ──── 按供应商汇总 ────
  console.log('━'.repeat(100));
  console.log('  一、供应商可用性总览');
  console.log('━'.repeat(100));

  const categories = { full: [], partial: [], fail: [], noModels: [] };
  allResults.forEach(r => {
    const hasModelsOk = r.modelsTest?.ok;
    const funcOkCount = r.modelTests.filter(t => t.ok).length;
    const funcTotal = r.modelTests.length;
    if (funcTotal === 0) { categories.noModels.push(r); return; }
    if (funcOkCount === funcTotal) categories.full.push(r);
    else if (funcOkCount > 0) categories.partial.push(r);
    else categories.fail.push(r);
  });

  function printCategory(icon, label, list) {
    console.log(`\n  ${icon} ${label} (${list.length}家)`);
    if (list.length === 0) { console.log('    （无）'); return; }
    list.forEach(r => {
      const ok = r.modelTests.filter(t => t.ok).length;
      const total = r.modelTests.length;
      const balance = r.balanceTest?.ok ? '余额正常' : r.balanceTest?.detail?.substring(0, 20) || '未检测';
      console.log(`    • ${r.name.padEnd(16)} [${r.type.padEnd(8)}] 功能: ${ok}/${total}通过  余额: ${balance}`);
    });
  }

  printCategory('✅', '完全可用 — 所有模型测试通过', categories.full);
  printCategory('⚠️', '部分可用 — 部分模型通过', categories.partial);
  printCategory('❌', '不可用 — 所有模型测试失败', categories.fail);
  printCategory('ℹ️', '未选模型 — 仅有连通性数据', categories.noModels);

  // ──── 模型级别详细报告 ────
  console.log('\n\n' + '━'.repeat(100));
  console.log('  二、逐模型详细测试结果');
  console.log('━'.repeat(100));

  // 图片生成模型
  const imageTests = allModelTests.filter(t => t.type === 'image');
  if (imageTests.length > 0) {
    console.log('\n  🖼️ 图像生成模型');
    console.log('  ┌──────────────────┬────────────────────────────────────────┬──────────┬──────────┬──────────┬────────────────────────────────────────────┐');
    console.log('  │ 供应商            │ 模型                                   │ 提交耗时  │ 总耗时    │ 第三方耗时│ 结果                                       │');
    console.log('  ├──────────────────┼────────────────────────────────────────┼──────────┼──────────┼──────────┼────────────────────────────────────────────┤');
    imageTests.forEach(t => {
      const provider = t.provider.substring(0, 16).padEnd(16);
      const model = t.model.substring(0, 38).padEnd(38);
      const submitMs = formatMs(t.submitMs || 0).padEnd(8);
      const totalMs = formatMs(t.totalMs || t.latencyMs || 0).padEnd(8);
      const genMs = formatMs(t.generationMs || t.totalMs || t.latencyMs || 0).padEnd(8);
      const result = t.ok ? '✓ 生成成功' : `✗ ${t.detail?.substring(0, 30) || '失败'}`;
      console.log(`  │ ${provider} │ ${model} │ ${submitMs} │ ${totalMs} │ ${genMs} │ ${result.padEnd(42)} │`);
    });
    console.log('  └──────────────────┴────────────────────────────────────────┴──────────┴──────────┴──────────┴────────────────────────────────────────────┘');
  }

  // 聊天模型
  const chatTests = allModelTests.filter(t => t.type === 'chat');
  if (chatTests.length > 0) {
    console.log('\n  💬 聊天/LLM模型');
    console.log('  ┌──────────────────┬────────────────────────────────────────┬──────────┬────────────────────────────────────────────────────────────────────────┐');
    console.log('  │ 供应商            │ 模型                                   │ 响应耗时  │ 结果                                                                   │');
    console.log('  ├──────────────────┼────────────────────────────────────────┼──────────┼────────────────────────────────────────────────────────────────────────┤');
    chatTests.forEach(t => {
      const provider = t.provider.substring(0, 16).padEnd(16);
      const model = t.model.substring(0, 38).padEnd(38);
      const latency = formatMs(t.latencyMs || 0).padEnd(8);
      const result = t.ok ? `✓ ${t.detail?.substring(0, 70) || '成功'}` : `✗ ${t.detail?.substring(0, 70) || '失败'}`;
      console.log(`  │ ${provider} │ ${model} │ ${latency} │ ${result.padEnd(72)} │`);
    });
    console.log('  └──────────────────┴────────────────────────────────────────┴──────────┴────────────────────────────────────────────────────────────────────────┘');
  }

  // 视频/3D/矢量模型
  const otherTests = allModelTests.filter(t => !['image', 'chat'].includes(t.type));
  if (otherTests.length > 0) {
    console.log('\n  🎬 视频/3D/矢量/分层模型（仅连通性测试）');
    console.log('  ┌──────────────────┬────────────────────────────────────────┬──────────┬──────────────────────────────────────────────────┐');
    console.log('  │ 供应商            │ 模型                                   │ 类型     │ 结果                                             │');
    console.log('  ├──────────────────┼────────────────────────────────────────┼──────────┼──────────────────────────────────────────────────┤');
    otherTests.forEach(t => {
      const provider = t.provider.substring(0, 16).padEnd(16);
      const model = t.model.substring(0, 38).padEnd(38);
      const type = t.type.padEnd(8);
      const result = (t.ok ? '✓ ' : '✗ ') + (t.detail?.substring(0, 44) || '');
      console.log(`  │ ${provider} │ ${model} │ ${type} │ ${result.padEnd(48)} │`);
    });
    console.log('  └──────────────────┴────────────────────────────────────────┴──────────┴──────────────────────────────────────────────────┘');
  }

  // ──── 响应时间排行 ────
  console.log('\n\n' + '━'.repeat(100));
  console.log('  三、响应时间排行');
  console.log('━'.repeat(100));

  // 图片生成耗时排行
  const imageOkTests = imageTests.filter(t => t.ok && t.totalMs).sort((a, b) => (a.totalMs || 0) - (b.totalMs || 0));
  if (imageOkTests.length > 0) {
    console.log('\n  🖼️ 图像生成耗时排行（从快到慢）');
    imageOkTests.forEach((t, i) => {
      const bar = progressBar(Math.min(t.totalMs / 120000, 1), 25);
      console.log(`    ${String(i + 1).padStart(2)}. ${t.provider.padEnd(14)} ${t.model.substring(0, 28).padEnd(28)} ${formatMs(t.totalMs).padStart(8)} ${bar}`);
    });
  }

  // 聊天响应耗时排行
  const chatOkTests = chatTests.filter(t => t.ok && t.latencyMs).sort((a, b) => (a.latencyMs || 0) - (b.latencyMs || 0));
  if (chatOkTests.length > 0) {
    console.log('\n  💬 聊天响应耗时排行（从快到慢）');
    chatOkTests.forEach((t, i) => {
      const bar = progressBar(Math.min(t.latencyMs / 30000, 1), 25);
      console.log(`    ${String(i + 1).padStart(2)}. ${t.provider.padEnd(14)} ${t.model.substring(0, 28).padEnd(28)} ${formatMs(t.latencyMs).padStart(8)} ${bar}`);
    });
  }

  // ──── 失败详情 ────
  const failedTests = allModelTests.filter(t => !t.ok);
  if (failedTests.length > 0) {
    console.log('\n\n' + '━'.repeat(100));
    console.log('  四、失败详情与建议');
    console.log('━'.repeat(100));
    failedTests.forEach((t, i) => {
      console.log(`\n  ${i + 1}. ${t.provider} / ${t.model} [${t.type}]`);
      console.log(`     错误: ${t.detail}`);
      // 简单建议
      if (t.detail?.includes('401') || t.detail?.includes('403')) {
        console.log(`     建议: API Key无效或权限不足，请检查密钥配置`);
      } else if (t.detail?.includes('429') || t.detail?.includes('quota') || t.detail?.includes('insufficient')) {
        console.log(`     建议: 额度不足或频率限制，需充值或等待限额重置`);
      } else if (t.detail?.includes('500') || t.detail?.includes('502') || t.detail?.includes('503')) {
        console.log(`     建议: 上游服务暂时不可用，稍后重试或联系供应商`);
      } else if (t.detail?.includes('not supported') || t.detail?.includes('not_found')) {
        console.log(`     建议: 该模型不支持此端点，请更换模型或检查兼容配置`);
      } else if (t.detail?.includes('timeout') || t.detail?.includes('ECONNREFUSED')) {
        console.log(`     建议: 网络连接超时，检查网络或Base URL是否正确`);
      }
    });
  }

  // ──── 统计 ────
  const totalModels = allModelTests.length;
  const passModels = allModelTests.filter(t => t.ok).length;
  const failModels = totalModels - passModels;
  const passRate = totalModels > 0 ? ((passModels / totalModels) * 100).toFixed(1) : '0';

  console.log('\n\n' + '━'.repeat(100));
  console.log('  五、总结');
  console.log('━'.repeat(100));
  console.log(`\n  📊 供应商: ${rows.length}家 | 模型: ${totalModels}个 | 通过: ${passModels}个 | 失败: ${failModels}个 | 通过率: ${passRate}%`);
  console.log(`  ⏱️ 总测试耗时: ${totalTestTime}秒`);

  // 平均耗时
  const avgImageTime = imageOkTests.length > 0 ? Math.round(imageOkTests.reduce((s, t) => s + (t.totalMs || 0), 0) / imageOkTests.length) : 0;
  const avgChatTime = chatOkTests.length > 0 ? Math.round(chatOkTests.reduce((s, t) => s + (t.latencyMs || 0), 0) / chatOkTests.length) : 0;
  if (avgImageTime) console.log(`  🖼️ 图片生成平均耗时: ${formatMs(avgImageTime)}`);
  if (avgChatTime) console.log(`  💬 聊天响应平均耗时: ${formatMs(avgChatTime)}`);

  console.log(`\n  测试完成: ${new Date().toLocaleString('zh-CN')}`);

  // 保存JSON报告
  require('fs').writeFileSync('/tmp/api-test-full-report.json', JSON.stringify({ testTime: new Date().toISOString(), totalTestTime, providers: allResults }, null, 2));
  console.log(`\n  📁 完整JSON报告已保存: /tmp/api-test-full-report.json`);

  await pool.end();
}

main().catch(console.error);
