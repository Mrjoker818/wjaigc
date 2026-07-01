/**
 * 直接从数据库读取API配置，测试所有供应商
 */
const { Pool } = require('pg');
const crypto = require('crypto');

// 解密函数
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
  } catch (e) {
    return encryptedKey;
  }
}

async function main() {
  const dbUrl = process.env.PGDATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('数据库URL未配置');
    return;
  }
  
  const secret = process.env.WUJIE_AUTH_SECRET || 'wujie-cms-secret-key-change-in-production';
  const pool = new Pool({ connectionString: dbUrl });
  
  console.log('=== API供应商真实测试报告 ===\n');
  console.log('开始时间:', new Date().toLocaleString('zh-CN'), '\n');
  
  const { rows } = await pool.query('SELECT id, name, display_name, base_url, api_key, model_type, selected_models FROM wujie_api_providers WHERE is_enabled != false ORDER BY model_type, name');
  
  console.log(`已配置并启用的供应商总数: ${rows.length}\n`);
  
  const results = [];
  
  for (const p of rows) {
    const displayName = p.display_name || p.name;
    const apiKey = decryptApiKey(p.api_key, secret);
    const selectedModels = Array.isArray(p.selected_models) ? p.selected_models : (typeof p.selected_models === 'string' ? JSON.parse(p.selected_models) : []);
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`【${displayName}】 (类型: ${p.model_type})`);
    console.log(`端点: ${p.base_url}`);
    console.log(`已选模型: ${selectedModels.join(', ') || '未选择'}\n`);
    
    const pResult = { name: displayName, type: p.model_type, baseUrl: p.base_url, selectedModels, tests: [] };
    
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    
    // 1. 获取模型列表
    process.stdout.write('  [1] 获取模型列表 (/v1/models)... ');
    const t1 = Date.now();
    let modelsResult = { name: '模型列表', ok: false, latencyMs: 0, detail: '' };
    let discoveredModels = [];
    try {
      // 同时尝试带/v1和不带/v1的路径
      let resp = await fetch(p.base_url.replace(/\/+$/, '') + '/v1/models', {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (resp.status === 404) {
        resp = await fetch(p.base_url.replace(/\/+$/, '') + '/models', {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(15000),
        });
      }
      modelsResult.latencyMs = Date.now() - t1;
      if (resp.ok) {
        const data = await resp.json();
        discoveredModels = (data.data || data.models || []).map(m => m.id || m.name);
        modelsResult.ok = discoveredModels.length > 0;
        modelsResult.detail = `成功发现 ${discoveredModels.length} 个模型，响应 ${modelsResult.latencyMs}ms`;
        console.log(`✓ ${modelsResult.detail}`);
        if (discoveredModels.slice(0, 5).length > 0) {
          console.log(`      示例模型: ${discoveredModels.slice(0, 5).join(', ')}${discoveredModels.length > 5 ? '...' : ''}`);
        }
      } else {
        const text = (await resp.text().catch(() => '')).substring(0, 150);
        modelsResult.detail = `HTTP ${resp.status} (${modelsResult.latencyMs}ms): ${text}`;
        console.log(`✗ ${modelsResult.detail}`);
      }
    } catch (e) {
      modelsResult.latencyMs = Date.now() - t1;
      modelsResult.detail = `错误: ${e.message} (${modelsResult.latencyMs}ms)`;
      console.log(`✗ ${modelsResult.detail}`);
    }
    pResult.tests.push(modelsResult);
    
    // 2. 根据类型做功能测试
    if (p.model_type === 'image' || p.model_type === 'imageEdit') {
      const testModel = selectedModels[0] || discoveredModels.find(m => /image|dall|flux|gpt-image|seedream|sd|midjourney|ideogram/i.test(m)) || discoveredModels[0];
      if (testModel && apiKey) {
        process.stdout.write(`  [2] 测试图片生成 [模型: ${testModel}]... `);
        const t2 = Date.now();
        let genResult = { name: '图片生成', model: testModel, ok: false, latencyMs: 0, detail: '', generationTimeMs: 0 };
        
        try {
          // 尝试标准格式
          const body = JSON.stringify({
            model: testModel,
            prompt: 'a simple red apple on white background, minimalist',
            n: 1,
            size: '1024x1024',
          });
          
          // 尝试不同端点
          let endpoints = ['/v1/images/generations', '/images/generations'];
          let genResp = null;
          for (const ep of endpoints) {
            try {
              genResp = await fetch(p.base_url.replace(/\/+$/, '') + ep, {
                method: 'POST',
                headers,
                body,
                signal: AbortSignal.timeout(90000), // 90秒超时给图片生成
              });
              if (genResp.status !== 404) break;
            } catch {}
          }
          
          genResult.latencyMs = Date.now() - t2; // 首包响应时间（前端反馈时间）
          
          if (genResp && genResp.ok) {
            const genData = await genResp.json();
            const hasUrl = genData.data && genData.data[0] && genData.data[0].url;
            const hasB64 = genData.data && genData.data[0] && genData.data[0].b64_json;
            const hasTaskId = genData.data && genData.data[0] && (genData.data[0].task_id || genData.data[0].id);
            
            if (hasUrl || hasB64) {
              genResult.ok = true;
              genResult.generationTimeMs = genResult.latencyMs;
              genResult.detail = `✅ 生成成功！前端反馈: ${genResult.latencyMs}ms，总生成耗时: ${(genResult.generationTimeMs/1000).toFixed(1)}秒`;
              console.log(`✓ ${genResult.detail}`);
            } else if (hasTaskId) {
              genResult.ok = true;
              genResult.detail = `○ 异步任务提交成功 (ID: ${genData.data[0].task_id || genData.data[0].id})，前端响应 ${genResult.latencyMs}ms`;
              console.log(`○ ${genResult.detail}`);
            } else {
              genResult.detail = `响应格式异常 (${genResult.latencyMs}ms): ${JSON.stringify(genData).substring(0, 200)}`;
              console.log(`? ${genResult.detail}`);
            }
          } else if (genResp) {
            const errText = (await genResp.text().catch(() => '')).substring(0, 200);
            genResult.detail = `HTTP ${genResp.status} (${genResult.latencyMs}ms): ${errText}`;
            console.log(`✗ ${genResult.detail}`);
          } else {
            genResult.detail = `所有端点连接失败 (${genResult.latencyMs}ms)`;
            console.log(`✗ ${genResult.detail}`);
          }
        } catch (e) {
          genResult.latencyMs = Date.now() - t2;
          genResult.detail = `错误: ${e.message} (${genResult.latencyMs}ms)`;
          console.log(`✗ ${genResult.detail}`);
        }
        pResult.tests.push(genResult);
      }
    } else if (p.model_type === 'chat' || p.model_type === 'llm') {
      const testModel = selectedModels[0] || discoveredModels.find(m => /gpt|gemini|claude|glm|qwen|deepseek/i.test(m)) || discoveredModels[0];
      if (testModel && apiKey) {
        process.stdout.write(`  [2] 测试对话生成 [模型: ${testModel}]... `);
        const t2 = Date.now();
        let chatResult = { name: '对话生成', model: testModel, ok: false, latencyMs: 0, detail: '' };
        
        try {
          const body = JSON.stringify({
            model: testModel,
            messages: [{ role: 'user', content: 'Reply with just the word: OK' }],
            max_tokens: 5,
          });
          
          const chatResp = await fetch(p.base_url.replace(/\/+$/, '') + '/v1/chat/completions', {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(30000),
          });
          chatResult.latencyMs = Date.now() - t2;
          
          if (chatResp.ok) {
            const data = await chatResp.json();
            const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (content) {
              chatResult.ok = true;
              chatResult.detail = `✅ 响应成功: "${content.trim()}"，总耗时 ${(chatResult.latencyMs/1000).toFixed(1)}秒`;
              console.log(`✓ ${chatResult.detail}`);
            } else {
              chatResult.detail = `响应格式异常 (${chatResult.latencyMs}ms): ${JSON.stringify(data).substring(0, 200)}`;
              console.log(`? ${chatResult.detail}`);
            }
          } else {
            const errText = (await chatResp.text().catch(() => '')).substring(0, 200);
            chatResult.detail = `HTTP ${chatResp.status} (${chatResult.latencyMs}ms): ${errText}`;
            console.log(`✗ ${chatResult.detail}`);
          }
        } catch (e) {
          chatResult.latencyMs = Date.now() - t2;
          chatResult.detail = `错误: ${e.message} (${chatResult.latencyMs}ms)`;
          console.log(`✗ ${chatResult.detail}`);
        }
        pResult.tests.push(chatResult);
      }
    }
    
    results.push(pResult);
    console.log('');
  }
  
  // 汇总报告
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n================= 【测试报告汇总】 =================\n`);
  
  let passCount = 0;
  let failCount = 0;
  let asyncCount = 0;
  
  console.log('| 供应商名称 | 类型 | 模型列表 | 功能测试 | 前端响应时间 | 备注 |');
  console.log('|-----------|------|---------|---------|------------|------|');
  
  results.forEach(r => {
    const modelsTest = r.tests[0];
    const funcTest = r.tests[1];
    const modelsStatus = modelsTest.ok ? '✓ 通过' : '✗ 失败';
    let funcStatus = '- 未测';
    let latency = '-';
    let note = '';
    
    if (funcTest) {
      if (funcTest.ok && funcTest.detail && funcTest.detail.startsWith('✅')) {
        funcStatus = '✓ 通过';
        passCount++;
      } else if (funcTest.ok && funcTest.detail && funcTest.detail.startsWith('○')) {
        funcStatus = '○ 异步任务';
        asyncCount++;
      } else {
        funcStatus = '✗ 失败';
        failCount++;
      }
      latency = funcTest.latencyMs ? `${funcTest.latencyMs}ms` : '-';
      note = funcTest.detail.substring(0, 50);
    } else {
      if (modelsTest.ok) passCount++; else failCount++;
    }
    
    console.log(`| ${r.name.substring(0, 15)} | ${r.type} | ${modelsStatus} | ${funcStatus} | ${latency} | ${note} |`);
  });
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n统计结果:`);
  console.log(`  完全可用供应商: ${passCount}/${results.length}`);
  console.log(`  异步任务模式供应商: ${asyncCount}`);
  console.log(`  不可用供应商: ${failCount}/${results.length}`);
  
  console.log(`\n测试结束时间: ${new Date().toLocaleString('zh-CN')}`);
  
  require('fs').writeFileSync('/tmp/api-final-test-result.json', JSON.stringify(results, null, 2));
  await pool.end();
}

main().catch(console.error);
