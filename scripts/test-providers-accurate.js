#!/usr/bin/env node
/**
 * 无界AI — API供应商全面真实测试 (通过应用API)
 * 
 * 通过 /api/generate 和 /api/chat 接口测试，走应用的完整兼容层：
 * - 模型别名规范化 (gpt-image-2-4k → gpt-image-2)
 * - Gemini图像模型 → /chat/completions 路径
 * - FHL → Responses API 路径
 * - APImart → 异步提交+轮询
 * - 尺寸自动修复
 * - 智能重试
 * 
 * 这样测试结果完全反映用户真实体验
 */

const BASE = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;

// ─── 数据库查询 ───
async function getProviders() {
  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.PGDATABASE_URL || process.env.DATABASE_URL,
    ssl: process.env.PGDATABASE_URL ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  const res = await client.query(
    "SELECT id, name, display_name, base_url, model_type, selected_models, advanced_params FROM wujie_api_providers WHERE is_enabled != false ORDER BY model_type, name"
  );
  await client.end();
  return res.rows;
}

// ─── 工具函数 ───
function parseModels(selectedModels) {
  if (!selectedModels) return [];
  if (Array.isArray(selectedModels)) return selectedModels;
  if (typeof selectedModels === 'string') {
    try { return JSON.parse(selectedModels); } catch { return [selectedModels]; }
  }
  return [];
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toFixed(0)}s`;
}

function extractTextFromSSE(sseText) {
  // 从SSE流中提取文本内容
  let fullText = '';
  for (const line of sseText.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) fullText += delta.content;
        // 也检查非流式格式
        if (!delta && json.choices?.[0]?.message?.content) {
          fullText = json.choices[0].message.content;
        }
      } catch {}
    }
  }
  return fullText;
}

// ─── 测试: 图像生成 (通过 /api/generate + /api/poll-task) ───
async function testImageGeneration(providerId, modelName, providerName) {
  const startTime = Date.now();
  const result = {
    providerId,
    providerName,
    model: modelName,
    success: false,
    submitTimeMs: 0,
    totalTimeMs: 0,
    thirdPartyTimeMs: 0,
    imageUrl: null,
    error: null,
    protocol: 'unknown',
  };

  try {
    // 1. 提交生成任务
    const submitStart = Date.now();
    const submitRes = await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'A cute cartoon cat sitting on a windowsill, simple illustration, bright colors',
        aspectRatio: '1:1',
        quality: '1K',
        model: modelName,
        providerId: providerId,
        outputCount: 1,
      }),
      signal: AbortSignal.timeout(60000), // 提交60秒超时
    });
    const submitData = await submitRes.json();
    result.submitTimeMs = Date.now() - submitStart;

    if (!submitData.success) {
      result.error = submitData.error || `HTTP ${submitRes.status}`;
      result.totalTimeMs = Date.now() - startTime;
      return result;
    }

    // 2a. 直接返回了图片（同步模式）
    if (submitData.directImageUrls?.length > 0) {
      result.success = true;
      result.imageUrl = submitData.directImageUrls[0];
      result.protocol = 'sync';
      result.thirdPartyTimeMs = result.submitTimeMs;
      result.totalTimeMs = Date.now() - startTime;
      return result;
    }

    // 2b. 异步任务，需要轮询
    const taskIds = submitData.taskIds || [];
    if (taskIds.length === 0) {
      result.error = '提交成功但无taskId和直接图片';
      result.totalTimeMs = Date.now() - startTime;
      return result;
    }

    result.protocol = 'async';
    const taskId = taskIds[0];
    const pollModel = submitData.model || modelName;
    const pollProviderId = submitData.providerId || providerId;

    // 3. 轮询任务直到完成（最多5分钟）
    const maxPollAttempts = 100;
    let pollAttempt = 0;

    while (pollAttempt < maxPollAttempts) {
      pollAttempt++;
      // 前几次快速轮询，后面5秒一次
      const pollInterval = pollAttempt <= 5 ? 2000 : 5000;
      await new Promise(r => setTimeout(r, pollInterval));

      const pollRes = await fetch(`${BASE}/api/poll-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: taskId,
          model: pollModel,
          providerId: pollProviderId,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const pollData = await pollRes.json();

      if (pollData.status === 'completed' && pollData.imageUrl) {
        result.success = true;
        result.imageUrl = pollData.imageUrl;
        result.thirdPartyTimeMs = Date.now() - submitStart; // 从提交到获得结果 = 第三方生成时间
        result.totalTimeMs = Date.now() - startTime;
        return result;
      }

      if (pollData.status === 'failed') {
        result.error = pollData.error || '异步任务失败';
        result.totalTimeMs = Date.now() - startTime;
        return result;
      }

      // 还在处理中，继续轮询
    }

    result.error = `轮询超时（${maxPollAttempts}次）`;
    result.totalTimeMs = Date.now() - startTime;
    return result;

  } catch (err) {
    result.error = err.message || String(err);
    result.totalTimeMs = Date.now() - startTime;
    return result;
  }
}

// ─── 测试: 聊天 (通过 /api/chat) ───
async function testChat(providerId, modelName, providerName) {
  const startTime = Date.now();
  const result = {
    providerId,
    providerName,
    model: modelName,
    success: false,
    responseTimeMs: 0,
    responseText: null,
    error: null,
    protocol: 'chat',
  };

  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        providerId: providerId,
        messages: [{ role: 'user', content: 'Say exactly: TEST_OK' }],
        stream: false,
        enableTools: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const contentType = res.headers.get('content-type') || '';
    result.responseTimeMs = Date.now() - startTime;

    if (contentType.includes('text/event-stream')) {
      // SSE流式响应
      const sseText = await res.text();
      const text = extractTextFromSSE(sseText);
      if (text) {
        result.success = true;
        result.responseText = text.slice(0, 200);
        result.protocol = 'sse';
      } else {
        result.error = 'SSE流解析无内容';
      }
    } else {
      // JSON响应
      const data = await res.json();
      if (data.choices?.[0]?.message?.content) {
        result.success = true;
        result.responseText = data.choices[0].message.content.slice(0, 200);
        result.protocol = 'json';
      } else if (data.error) {
        result.error = typeof data.error === 'string' ? data.error : JSON.stringify(data.error).slice(0, 200);
      } else {
        result.error = `响应格式异常: ${JSON.stringify(data).slice(0, 200)}`;
      }
    }

    result.totalTimeMs = Date.now() - startTime;
    return result;

  } catch (err) {
    result.error = err.message || String(err);
    result.responseTimeMs = Date.now() - startTime;
    return result;
  }
}

// ─── 测试: 模型列表连通性 ───
async function testModelsEndpoint(providerId, providerName) {
  const startTime = Date.now();
  try {
    const res = await fetch(`${BASE}/api/models?type=all&providerId=${providerId}`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return {
      success: !!data.models || !!data.data,
      modelCount: data.models?.length || data.data?.length || 0,
      timeMs: Date.now() - startTime,
    };
  } catch (err) {
    return { success: false, modelCount: 0, timeMs: Date.now() - startTime, error: err.message };
  }
}

// ─── 主测试流程 ───
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          无界AI — API供应商全面真实测试报告 (通过应用API)                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🕐 测试开始: ${new Date().toLocaleString('zh-CN')}`);
  console.log('📋 测试方式: 通过应用 /api/generate 和 /api/chat 接口（完整兼容层）');
  console.log('⏱️ 图片生成轮询超时: 5分钟 | 聊天超时: 60秒');
  console.log('');

  const providers = await getProviders();
  console.log(`已启用供应商: ${providers.length} 家\n`);

  const allResults = [];
  const overallStart = Date.now();

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const models = parseModels(p.selected_models);
    const type = p.model_type;
    const displayName = p.display_name || p.name;

    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
    console.log(`【${i + 1}/${providers.length}】 ${displayName}  类型: ${type}`);
    console.log(`  端点: ${p.base_url}`);
    console.log(`  已选模型: ${models.join(', ') || '(无)'}`);
    console.log('');

    if (models.length === 0) {
      console.log('  ⚠️ 无已选模型，跳过\n');
      allResults.push({ providerId: p.id, name: displayName, type, models: [], skipped: true });
      continue;
    }

    // ─── 1. 连通性检测 ───
    console.log('  ▸ [1] 连通性检测...');
    const connTest = await testModelsEndpoint(p.id, displayName);
    if (connTest.success) {
      console.log(`    ✓ API可达，模型列表 ${connTest.modelCount} 个 (${formatMs(connTest.timeMs)})`);
    } else {
      console.log(`    ✗ API不可达 (${formatMs(connTest.timeMs)}): ${connTest.error || '未知错误'}`);
    }
    console.log('');

    const providerResults = [];

    // ─── 2. 按类型测试每个模型 ───
    if (type === 'image') {
      for (let m = 0; m < models.length; m++) {
        const model = models[m];
        console.log(`  ▸ [2.${m + 1}] 图像生成测试: ${model}`);
        const testResult = await testImageGeneration(p.id, model, displayName);
        providerResults.push(testResult);

        if (testResult.success) {
          console.log(`    ✓ 生成成功 (${testResult.protocol}模式)`);
          console.log(`      提交耗时: ${formatMs(testResult.submitTimeMs)} | 第三方生成: ${formatMs(testResult.thirdPartyTimeMs)} | 总耗时: ${formatMs(testResult.totalTimeMs)}`);
          console.log(`      图片URL: ${testResult.imageUrl?.slice(0, 80)}...`);
        } else {
          console.log(`    ✗ 生成失败: ${testResult.error?.slice(0, 120)}`);
          console.log(`      耗时: ${formatMs(testResult.totalTimeMs)}`);
        }
        console.log('');
      }
    } else if (type === 'chat' || type === 'vlm') {
      for (let m = 0; m < models.length; m++) {
        const model = models[m];
        console.log(`  ▸ [2.${m + 1}] 聊天测试: ${model}`);
        const testResult = await testChat(p.id, model, displayName);
        providerResults.push(testResult);

        if (testResult.success) {
          console.log(`    ✓ 响应成功 (${testResult.protocol}模式)`);
          console.log(`      响应耗时: ${formatMs(testResult.responseTimeMs)}`);
          console.log(`      响应内容: "${testResult.responseText?.slice(0, 80)}"`);
        } else {
          console.log(`    ✗ 响应失败: ${testResult.error?.slice(0, 120)}`);
          console.log(`      耗时: ${formatMs(testResult.responseTimeMs)}`);
        }
        console.log('');
      }
    } else if (type === '3d' || type === 'video' || type === 'vectorize' || type === 'upscaler') {
      // 3D/视频/矢量/放大：仅做连通性检测，不真实生成（太耗时且消耗额度）
      for (let m = 0; m < models.length; m++) {
        const model = models[m];
        console.log(`  ▸ [2.${m + 1}] 连通性测试: ${model}`);
        // 通过 /api/models 接口验证模型是否在列表中
        try {
          const modelTypeMap = { '3d': '3d', 'video': 'video', 'vectorize': 'vectorize', 'upscaler': 'image' };
          const res = await fetch(`${BASE}/api/models?type=${modelTypeMap[type] || 'all'}&providerId=${p.id}`, {
            signal: AbortSignal.timeout(10000),
          });
          const data = await res.json();
          const modelList = data.models || data.data || [];
          const found = modelList.some(item => {
            const id = item.id || item.model || item.name || '';
            return id === model || id.includes(model);
          });
          if (found) {
            console.log(`    ✓ 模型在列表中存在`);
            providerResults.push({ providerId: p.id, providerName: displayName, model, success: true, protocol: 'connectivity' });
          } else {
            console.log(`    ○ 模型不在列表中（可能需要API端点支持）`);
            providerResults.push({ providerId: p.id, providerName: displayName, model, success: false, error: '模型不在列表中', protocol: 'connectivity' });
          }
        } catch (err) {
          console.log(`    ✗ 检测失败: ${err.message}`);
          providerResults.push({ providerId: p.id, providerName: displayName, model, success: false, error: err.message, protocol: 'connectivity' });
        }
        console.log('');
      }
    }

    allResults.push({ providerId: p.id, name: displayName, type, models: providerResults, connTest });
  }

  // ─── 汇总报告 ───
  const totalDuration = (Date.now() - overallStart) / 1000;
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              测 试 报 告 汇 总                                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🕐 测试结束: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`⏱️ 总耗时: ${formatDuration(totalDuration)}`);
  console.log('');

  // ─── 图像生成汇总 ───
  const imageResults = allResults.flatMap(r => r.models?.filter(m => m.protocol === 'sync' || m.protocol === 'async') || []);
  const imageSuccess = imageResults.filter(r => r.success);
  const imageFailed = imageResults.filter(r => !r.success);

  console.log('═════════════════════════════════════════════════════');
  console.log('📊 图像生成测试汇总');
  console.log('═════════════════════════════════════════════════════');
  console.log(`测试模型: ${imageResults.length} 个 | 成功: ${imageSuccess.length} | 失败: ${imageFailed.length}`);
  console.log('');

  if (imageSuccess.length > 0) {
    console.log('  ✅ 成功模型:');
    for (const r of imageSuccess) {
      console.log(`     ${r.providerName} / ${r.model}`);
      console.log(`       协议: ${r.protocol} | 提交: ${formatMs(r.submitTimeMs)} | 第三方生成: ${formatMs(r.thirdPartyTimeMs)} | 总耗时: ${formatMs(r.totalTimeMs)}`);
    }
    console.log('');
    // 平均耗时
    const avgThirdParty = imageSuccess.reduce((sum, r) => sum + r.thirdPartyTimeMs, 0) / imageSuccess.length;
    const avgTotal = imageSuccess.reduce((sum, r) => sum + r.totalTimeMs, 0) / imageSuccess.length;
    console.log(`  📈 平均第三方生成耗时: ${formatMs(avgThirdParty)}`);
    console.log(`  📈 平均总耗时(含前端): ${formatMs(avgTotal)}`);
    console.log('');
  }

  if (imageFailed.length > 0) {
    console.log('  ❌ 失败模型:');
    for (const r of imageFailed) {
      console.log(`     ${r.providerName} / ${r.model}`);
      console.log(`       原因: ${r.error?.slice(0, 150)}`);
      console.log(`       耗时: ${formatMs(r.totalTimeMs)}`);
    }
    console.log('');
  }

  // ─── 聊天模型汇总 ───
  const chatResults = allResults.flatMap(r => r.models?.filter(m => m.protocol === 'chat' || m.protocol === 'sse' || m.protocol === 'json') || []);
  const chatSuccess = chatResults.filter(r => r.success);
  const chatFailed = chatResults.filter(r => !r.success);

  console.log('═════════════════════════════════════════════════════');
  console.log('📊 聊天模型测试汇总');
  console.log('═════════════════════════════════════════════════════');
  console.log(`测试模型: ${chatResults.length} 个 | 成功: ${chatSuccess.length} | 失败: ${chatFailed.length}`);
  console.log('');

  if (chatSuccess.length > 0) {
    console.log('  ✅ 成功模型:');
    for (const r of chatSuccess) {
      console.log(`     ${r.providerName} / ${r.model}`);
      console.log(`       协议: ${r.protocol} | 响应耗时: ${formatMs(r.responseTimeMs)}`);
      console.log(`       响应: "${r.responseText?.slice(0, 80)}"`);
    }
    const avgChat = chatSuccess.reduce((sum, r) => sum + r.responseTimeMs, 0) / chatSuccess.length;
    console.log(`  📈 平均响应耗时: ${formatMs(avgChat)}`);
    console.log('');
  }

  if (chatFailed.length > 0) {
    console.log('  ❌ 失败模型:');
    for (const r of chatFailed) {
      console.log(`     ${r.providerName} / ${r.model}`);
      console.log(`       原因: ${r.error?.slice(0, 150)}`);
    }
    console.log('');
  }

  // ─── 3D/视频/矢量/放大汇总 ───
  const otherResults = allResults.flatMap(r => r.models?.filter(m => m.protocol === 'connectivity') || []);
  const otherSuccess = otherResults.filter(r => r.success);
  const otherFailed = otherResults.filter(r => !r.success);

  if (otherResults.length > 0) {
    console.log('═════════════════════════════════════════════════════');
    console.log('📊 3D/视频/矢量/放大 连通性汇总');
    console.log('═════════════════════════════════════════════════════');
    console.log(`检测模型: ${otherResults.length} 个 | 可达: ${otherSuccess.length} | 不可达: ${otherFailed.length}`);
    console.log('');
    for (const r of otherResults) {
      const icon = r.success ? '✓' : '✗';
      console.log(`  ${icon} ${r.providerName} / ${r.model} ${r.error ? '- ' + r.error?.slice(0, 80) : ''}`);
    }
    console.log('');
  }

  // ─── 供应商可用性评级 ───
  console.log('═════════════════════════════════════════════════════');
  console.log('📊 供应商可用性评级');
  console.log('═════════════════════════════════════════════════════');
  console.log('');

  for (const r of allResults) {
    if (r.skipped) continue;
    const models = r.models || [];
    const success = models.filter(m => m.success).length;
    const total = models.length;
    const pct = total > 0 ? Math.round(success / total * 100) : 0;

    let rating = '❌';
    if (pct === 100 && total > 0) rating = '✅';
    else if (pct >= 50) rating = '⚠️';
    else if (pct > 0) rating = '⚠️';

    const typeLabel = { image: '图像', chat: '聊天', '3d': '3D', video: '视频', vectorize: '矢量', upscaler: '放大', vlm: 'VLM' }[r.type] || r.type;
    console.log(`  ${rating} ${r.name} [${typeLabel}] — ${success}/${total} 通过 (${pct}%)`);
  }

  console.log('');

  // ─── 保存JSON报告 ───
  const reportData = {
    testTime: new Date().toISOString(),
    totalDurationSeconds: totalDuration,
    providers: allResults,
    summary: {
      totalProviders: providers.length,
      totalModels: imageResults.length + chatResults.length + otherResults.length,
      imageSuccess: imageSuccess.length,
      imageFailed: imageFailed.length,
      chatSuccess: chatSuccess.length,
      chatFailed: chatFailed.length,
      otherSuccess: otherSuccess.length,
      otherFailed: otherFailed.length,
    },
  };

  const fs = require('fs');
  fs.writeFileSync('/tmp/api-test-accurate-report.json', JSON.stringify(reportData, null, 2));
  console.log('📄 完整JSON报告已保存: /tmp/api-test-accurate-report.json');
  console.log('');
}

main().catch(err => {
  console.error('测试脚本执行失败:', err);
  process.exit(1);
});
