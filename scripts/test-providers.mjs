/**
 * 供应商端到端真实调用测试
 * 从数据库读取 API Key，直接调用供应商 API，验证图像/视频能否产出成品。
 * 不输出任何 API Key 原文（仅显示前4+末4位掩码）。
 *
 * 关键：base_url 已含 /v1（如 https://api.apib.ai/v1），需先剥尾部 /v1 再接 /v1/xxx，
 * 否则 /v1/v1/xxx → HTTP 404
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const DB_URL = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: DB_URL,
  ssl: DB_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  max: 3,
});

// 与 video-api.ts ensureBaseUrl 保持一致：剥尾 /v1，再由调用侧完整拼 /v1/xxx
function ensureBase(url) {
  let clean = (url || '').replace(/\/+$/, '');
  if (clean.endsWith('/v1')) clean = clean.slice(0, -3);
  return clean;
}

function maskKey(k) {
  if (!k || k.length < 8) return '***';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

async function getProviders() {
  const { rows } = await pool.query(
    `SELECT id, name, base_url, api_key, model_type, selected_models
     FROM wujie_api_providers
     WHERE is_enabled = true
     ORDER BY model_type, name`
  );
  return rows;
}

async function fetchJson(url, options, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(tid);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, status: 0, json: null, error: String(e).slice(0, 150) };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractImageUrl(d) {
  // APImart: {code:200, data:{result:{images:[{url}]}}}
  const result = d?.data?.result || d?.result;
  if (result?.images) {
    const img = Array.isArray(result.images) ? result.images[0] : null;
    if (img?.url) return Array.isArray(img.url) ? img.url[0] : img.url;
  }
  // Standard OpenAI sync: {data:[{url}]}
  if (d?.data?.[0]?.url) return d.data[0].url;
  if (d?.data?.url) return d.data.url;
  if (d?.url) return d.url;
  return null;
}

// ──────────────────────────────────────────
// 图像测试：提交 → 轮询，最多 120 秒
// ──────────────────────────────────────────
async function testImageProvider(p) {
  const models = Array.isArray(p.selected_models)
    ? p.selected_models
    : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models || '[]') : []);
  if (!models.length) return [{ status: 'skip', reason: 'no models' }];

  const base = ensureBase(p.base_url);
  const hdr = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.api_key}` };

  const results = [];
  // 测前3个模型，避免超时
  for (const model of models.slice(0, 3)) {
    process.stdout.write(`\n    model=${model} ... `);
    const r = await testOneImageModel(base, hdr, model);
    results.push({ model, ...r });
    if (r.status === 'success') break;  // 一个成功就代表供应商连通
  }
  return results;
}

async function testOneImageModel(base, hdr, model) {
  // 根据模型名选择合适的参数
  const modelL = model.toLowerCase();
  const isGeminiOrSeedream = modelL.includes('gemini') || modelL.includes('seedream') || modelL.includes('seedance');
  const isGptImage = modelL.includes('gpt-image') || modelL.includes('gpt_image');
  const isFlux = modelL.includes('flux') || modelL.includes('midjourney') || modelL.includes('sdxl');

  // 尺寸格式按模型类型选择
  let sizeParam;
  if (isGptImage) {
    sizeParam = { size: '1024x1024' };  // FHL/OpenAI gpt-image 系要求 WIDTHxHEIGHT
  } else if (isGeminiOrSeedream) {
    sizeParam = { size: '1:1', resolution: '1K' };
  } else {
    sizeParam = { size: '1024x1024' };  // 通用
  }

  const body = { model, prompt: 'A simple red apple on a white background', n: 1, ...sizeParam };
  const submitUrl = `${base}/v1/images/generations`;

  const submit = await fetchJson(submitUrl, { method: 'POST', headers: hdr, body: JSON.stringify(body) }, 30000);

  if (submit.status === 0) return { status: 'network_error', error: submit.error };
  if (!submit.ok && submit.status !== 200) {
    // 尝试 1:1 ratio format 如果 WxH 失败
    if (submit.json?.error?.message?.includes('size') && !sizeParam.size.includes(':')) {
      const body2 = { model, prompt: 'A simple red apple on a white background', n: 1, size: '1:1', resolution: '1K' };
      const retry = await fetchJson(submitUrl, { method: 'POST', headers: hdr, body: JSON.stringify(body2) }, 25000);
      if (!retry.ok) return { status: 'submit_fail', httpStatus: submit.status, error: submit.json?.error?.message };
      return await pollImageTask(base, hdr, retry);
    }
    return { status: 'submit_fail', httpStatus: submit.status, error: submit.json?.error?.message || JSON.stringify(submit.json).slice(0, 150) };
  }

  return await pollImageTask(base, hdr, submit);
}

async function pollImageTask(base, hdr, submit) {
  const d = submit.json;

  // 同步直接返回 URL
  if (d?.data?.[0]?.url) return { status: 'success', url: d.data[0].url, mode: 'sync' };
  if (d?.data?.[0]?.b64_json) return { status: 'success', url: 'data:image/png;base64,...(b64)', mode: 'sync_b64' };

  // 异步任务
  const taskId = d?.data?.[0]?.task_id || d?.data?.[0]?.id || d?.task_id || d?.id;
  if (!taskId) return { status: 'no_task_id', raw: JSON.stringify(d).slice(0, 200) };

  // 轮询：APImart/PearAPI 图像用 /v1/tasks/{id}；其他用 /v1/images/generations/{id}
  const pollUrls = [
    `${base}/v1/tasks/${taskId}`,
    `${base}/v1/images/generations/${taskId}`,
  ];

  let elapsed = 0;
  while (elapsed < 120000) {
    await sleep(5000);
    elapsed += 5000;

    for (const pollUrl of pollUrls) {
      const poll = await fetchJson(pollUrl, { method: 'GET', headers: hdr }, 12000);
      if (!poll.ok && poll.status >= 400) continue;
      const pd = poll.json;
      const pStatus = (pd?.data?.status || pd?.data?.[0]?.status || pd?.status || '').toLowerCase();
      if (['completed', 'succeeded', 'success'].includes(pStatus)) {
        const url = extractImageUrl(pd);
        if (url) return { status: 'success', url, elapsed, mode: 'async' };
        return { status: 'success_no_url', elapsed, raw: JSON.stringify(pd).slice(0, 200) };
      }
      if (['failed', 'error', 'cancelled'].includes(pStatus)) {
        const err = pd?.data?.error || pd?.error;
        return { status: 'task_failed', elapsed, error: JSON.stringify(err).slice(0, 150) };
      }
      process.stdout.write(`[${elapsed / 1000}s:${pStatus || '?'}]`);
      break;
    }
  }
  return { status: 'timeout', taskId: taskId.slice(0, 25), elapsed };
}

// ──────────────────────────────────────────
// 视频测试：提交 + 首次轮询确认 task 注册成功
// ──────────────────────────────────────────
async function testVideoProvider(p) {
  const models = Array.isArray(p.selected_models)
    ? p.selected_models
    : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models || '[]') : []);
  if (!models.length) return [{ status: 'skip', reason: 'no models' }];

  const base = ensureBase(p.base_url);
  const hdr = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.api_key}` };
  const baseL = base.toLowerCase();
  const isApimart = baseL.includes('apib.ai');
  const isPear = baseL.includes('pearapi.ai');

  const results = [];
  for (const model of models) {
    process.stdout.write(`\n    model=${model} ... `);
    const r = await testOneVideoModel(base, hdr, model, isApimart, isPear);
    results.push({ model, ...r });
    if (r.status === 'submitted_ok') break;
  }
  return results;
}

async function testOneVideoModel(base, hdr, model, isApimart, isPear) {
  let submitUrl, body;

  if (isApimart) {
    submitUrl = `${base}/v1/videos/generations`;
    body = {
      model, prompt: 'A cat walking in a garden, photorealistic',
      n: 1, size: '16:9', duration: 5, resolution: '720p', generation_type: 'frame',
    };
  } else if (isPear) {
    submitUrl = `${base}/v1/videos/generations`;
    body = {
      model, prompt: 'A cat walking in a garden, photorealistic',
      n: 1, size: '16:9', aspect_ratio: '16:9', duration: 5,
      response_format: 'url', task_type: 'async',
    };
  } else {
    submitUrl = `${base}/v1/images/generations`;
    body = { model, prompt: 'A cat walking in a garden', n: 1, size: '16:9' };
  }

  const submit = await fetchJson(submitUrl, { method: 'POST', headers: hdr, body: JSON.stringify(body) }, 30000);

  if (submit.status === 0) return { status: 'network_error', error: submit.error };
  if (!submit.ok && submit.status !== 200) {
    return {
      status: 'submit_fail', httpStatus: submit.status,
      error: (submit.json?.error?.message || JSON.stringify(submit.json)).slice(0, 200),
    };
  }

  const d = submit.json;
  // Extract task_id
  const taskId =
    d?.data?.[0]?.task_id ||   // APImart: {code:200, data:[{task_id}]}
    d?.data?.[0]?.id ||
    d?.data?.task_id ||
    d?.task_id ||
    d?.id;

  // Sync response
  if (!taskId) {
    if (d?.data?.[0]?.url || d?.url) return { status: 'success_sync', url: d?.data?.[0]?.url || d?.url };
    return { status: 'no_task_id', raw: JSON.stringify(d).slice(0, 300) };
  }

  // 首次轮询
  await sleep(3000);
  const pollUrl = (isApimart || isPear)
    ? `${base}/v1/tasks/${taskId}`
    : `${base}/v1/tasks/${taskId}`;
  const poll = await fetchJson(pollUrl, { method: 'GET', headers: hdr }, 12000);
  const pd = poll.json;
  const pStatus = (pd?.data?.status || pd?.status || '').toLowerCase();
  const pProgress = pd?.data?.progress ?? pd?.progress ?? null;

  return {
    status: 'submitted_ok',
    taskId: String(taskId).slice(0, 35),
    pollStatus: pStatus || (poll.status >= 400 ? `HTTP${poll.status}` : 'no-status'),
    progress: pProgress,
    pollHttpOk: poll.ok,
  };
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────
(async () => {
  console.log('\n===== 无界 AI 供应商真实连通性测试 =====\n');
  if (!DB_URL) { console.error('PGDATABASE_URL/DATABASE_URL 未设置'); process.exit(1); }

  const providers = await getProviders();
  console.log(`共找到 ${providers.length} 个启用供应商\n`);

  const imageProviders = providers.filter(p => p.model_type === 'image');
  const videoProviders  = providers.filter(p => p.model_type === 'video');

  // ──── 图像 ────
  console.log(`▶ 图像供应商 (${imageProviders.length} 个):\n`);
  for (const p of imageProviders) {
    const base = ensureBase(p.base_url);
    const models = Array.isArray(p.selected_models) ? p.selected_models
      : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models || '[]') : []);
    console.log(`  ┌ [${p.name}]  base=${base}  key=${maskKey(p.api_key)}  models=${JSON.stringify(models).slice(0, 80)}`);
    try {
      const rs = await testImageProvider(p);
      for (const r of rs) {
        if (r.status === 'success') {
          console.log(`  │   ✅ model=${r.model}  mode=${r.mode}${r.elapsed ? '  time=' + r.elapsed / 1000 + 's' : ''}`);
          console.log(`  │      url=${String(r.url).slice(0, 110)}...`);
        } else if (r.status === 'skip') {
          console.log(`  │   ⏭  ${r.reason}`);
        } else if (r.status === 'submit_fail') {
          console.log(`  │   ❌ model=${r.model}  HTTP ${r.httpStatus}  error: ${r.error}`);
        } else if (r.status === 'network_error') {
          console.log(`  │   🔌 model=${r.model}  网络异常: ${r.error}`);
        } else if (r.status === 'no_task_id') {
          console.log(`  │   ⚠  model=${r.model}  提交成功但无 task_id  resp=${r.raw}`);
        } else if (r.status === 'task_failed') {
          console.log(`  │   ❌ model=${r.model}  任务失败: ${r.error}`);
        } else if (r.status === 'timeout') {
          console.log(`  │   ⏱  model=${r.model}  超时 taskId=${r.taskId}`);
        } else if (r.status === 'success_no_url') {
          console.log(`  │   ⚠  model=${r.model}  状态completed但无URL  raw=${r.raw}`);
        } else {
          console.log(`  │   ?  model=${r.model}  ${JSON.stringify(r).slice(0, 200)}`);
        }
      }
    } catch (e) {
      console.log(`  │   💥 异常: ${e.message}`);
    }
    console.log(`  └─\n`);
  }

  // ──── 视频 ────
  console.log(`\n▶ 视频供应商 (${videoProviders.length} 个):\n`);
  for (const p of videoProviders) {
    const base = ensureBase(p.base_url);
    const models = Array.isArray(p.selected_models) ? p.selected_models
      : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models || '[]') : []);
    console.log(`  ┌ [${p.name}]  base=${base}  key=${maskKey(p.api_key)}  models=${JSON.stringify(models).slice(0, 80)}`);
    try {
      const rs = await testVideoProvider(p);
      for (const r of rs) {
        if (r.status === 'submitted_ok') {
          const mark = r.pollHttpOk ? '✅' : '⚠ ';
          console.log(`  │   ✅ model=${r.model}  提交成功  taskId=${r.taskId}`);
          console.log(`  │      首次轮询: ${mark}  status=${r.pollStatus}  progress=${r.progress ?? 'n/a'}`);
        } else if (r.status === 'success_sync') {
          console.log(`  │   ✅ model=${r.model}  同步完成  url=${String(r.url).slice(0, 80)}`);
        } else if (r.status === 'submit_fail') {
          console.log(`  │   ❌ model=${r.model}  HTTP ${r.httpStatus}  error: ${r.error}`);
        } else if (r.status === 'network_error') {
          console.log(`  │   🔌 model=${r.model}  网络异常: ${r.error}`);
        } else if (r.status === 'no_task_id') {
          console.log(`  │   ⚠  model=${r.model}  提交成功但无 task_id  resp=${r.raw}`);
        } else if (r.status === 'skip') {
          console.log(`  │   ⏭  ${r.reason}`);
        } else {
          console.log(`  │   ?  model=${r.model}  ${JSON.stringify(r).slice(0, 200)}`);
        }
      }
    } catch (e) {
      console.log(`  │   💥 异常: ${e.message}`);
    }
    console.log(`  └─\n`);
  }

  await pool.end();
  console.log('\n===== 测试完毕 =====\n');
})();
