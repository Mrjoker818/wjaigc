/**
 * 直接调用API服务层测试所有供应商
 */
async function runTests() {
  console.log('=== API供应商真实测试报告 ===\n');
  console.log('开始时间:', new Date().toLocaleString('zh-CN'), '\n');
  
  // 动态导入ES模块
  const { getApiProviders } = await import('../src/lib/server-api-config.ts');
  const { resolveCompatProfile } = await import('../src/lib/api-compatibility.ts');
  
  const providers = await getApiProviders();
  const enabledProviders = providers.filter(p => p.isEnabled !== false);
  
  console.log(`已配置供应商总数: ${providers.length}`);
  console.log(`已启用供应商总数: ${enabledProviders.length}\n`);
  
  const results = [];
  
  for (const provider of enabledProviders) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`【${provider.displayName || provider.name}】(${provider.modelType})`);
    console.log(`端点: ${provider.baseUrl}`);
    console.log(`已选模型: ${(provider.selectedModels || []).join(', ') || '未选择'}\n`);
    
    const pResult = {
      name: provider.displayName || provider.name,
      type: provider.modelType,
      baseUrl: provider.baseUrl,
      models: provider.selectedModels || [],
      tests: []
    };
    
    const apiKey = provider.apiKey;
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    
    const compat = resolveCompatProfile(provider);
    
    // 1. 模型列表测试
    process.stdout.write('  [1] 获取模型列表... ');
    const modelsStart = Date.now();
    let modelsOk = false;
    let modelsDetail = '';
    let modelsLatency = 0;
    let discoveredModels = [];
    try {
      const modelsUrl = new URL('/v1/models', provider.baseUrl).toString();
      const resp = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15000),
      });
      modelsLatency = Date.now() - modelsStart;
      if (resp.ok) {
        const data = await resp.json();
        discoveredModels = (data.data || []).map(m => m.id || m.name);
        modelsOk = discoveredModels.length > 0;
        modelsDetail = `发现 ${discoveredModels.length} 个模型 (${modelsLatency}ms)`;
        console.log(`✓ ${modelsDetail}`);
      } else {
        const text = await resp.text().catch(() => '');
        modelsDetail = `HTTP ${resp.status} (${modelsLatency}ms) ${text.substring(0, 100)}`;
        console.log(`✗ ${modelsDetail}`);
      }
    } catch (e) {
      modelsLatency = Date.now() - modelsStart;
      modelsDetail = `${e.message} (${modelsLatency}ms)`;
      console.log(`✗ ${modelsDetail}`);
    }
    pResult.tests.push({ name: '模型列表', status: modelsOk ? 'pass' : 'fail', latencyMs: modelsLatency, detail: modelsDetail });
    
    // 根据类型做不同测试
    if (provider.modelType === 'image' || provider.modelType === 'imageEdit') {
      // 2. 图片生成测试 - 极简prompt
      const testModel = (provider.selectedModels && provider.selectedModels[0]) || discoveredModels.find(m => m.includes('image') || m.includes('dall') || m.includes('flux') || m.includes('gpt-image')) || discoveredModels[0];
      if (testModel) {
        process.stdout.write(`  [2] 测试图片生成 (模型: ${testModel})... `);
        const genStart = Date.now();
        let genOk = false;
        let genDetail = '';
        let genLatency = 0;
        try {
          let body;
          let endpoint = '/v1/images/generations';
          
          // 尝试不同格式
          if (compat.imageGenFormat === 'json' || provider.baseUrl.includes('apimart')) {
            body = JSON.stringify({
              model: testModel,
              prompt: 'a simple red apple on white background',
              n: 1,
              size: '1024x1024',
            });
          } else {
            body = JSON.stringify({
              model: testModel,
              prompt: 'a simple red apple on white background',
              n: 1,
              size: '1024x1024',
            });
          }
          
          // 设置60秒超时
          const genResp = await fetch(new URL(endpoint, provider.baseUrl).toString(), {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(60000),
          });
          genLatency = Date.now() - genStart;
          
          if (genResp.ok) {
            const genData = await genResp.json();
            const hasImage = genData.data && genData.data[0] && (genData.data[0].url || genData.data[0].b64_json);
            if (hasImage) {
              genOk = true;
              genDetail = `生成成功，总耗时 ${(genLatency/1000).toFixed(1)}秒 (前端反馈: ${genLatency}ms)`;
              console.log(`✓ ${genDetail}`);
            } else if (genData.data && genData.data[0] && genData.data[0].task_id) {
              // 异步任务模式
              genOk = true;
              genDetail = `任务提交成功 (task_id: ${genData.data[0].task_id})，前端响应 ${genLatency}ms`;
              console.log(`○ ${genDetail}`);
            } else {
              genDetail = `响应格式异常: ${JSON.stringify(genData).substring(0, 200)} (${genLatency}ms)`;
              console.log(`? ${genDetail}`);
            }
          } else {
            const errText = await genResp.text().catch(() => '');
            genDetail = `HTTP ${genResp.status} (${genLatency}ms): ${errText.substring(0, 200)}`;
            console.log(`✗ ${genDetail}`);
          }
        } catch (e) {
          genLatency = Date.now() - genStart;
          genDetail = `${e.message} (${genLatency}ms)`;
          console.log(`✗ ${genDetail}`);
        }
        pResult.tests.push({ name: '图片生成', model: testModel, status: genOk ? 'pass' : 'fail', latencyMs: genLatency, detail: genDetail });
      }
    } else if (provider.modelType === 'chat' || provider.modelType === 'llm') {
      // 2. 聊天对话测试
      const testModel = (provider.selectedModels && provider.selectedModels[0]) || discoveredModels.find(m => m.includes('gemini') || m.includes('gpt') || m.includes('claude')) || discoveredModels[0];
      if (testModel) {
        process.stdout.write(`  [2] 测试对话生成 (模型: ${testModel})... `);
        const chatStart = Date.now();
        let chatOk = false;
        let chatDetail = '';
        let chatLatency = 0;
        try {
          const body = JSON.stringify({
            model: testModel,
            messages: [{ role: 'user', content: 'Say hello in one word' }],
            max_tokens: 10,
          });
          
          const chatResp = await fetch(new URL('/v1/chat/completions', provider.baseUrl).toString(), {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(30000),
          });
          chatLatency = Date.now() - chatStart;
          
          if (chatResp.ok) {
            const chatData = await chatResp.json();
            const content = chatData.choices && chatData.choices[0] && chatData.choices[0].message && chatData.choices[0].message.content;
            if (content) {
              chatOk = true;
              chatDetail = `响应成功: "${content}"，总耗时 ${(chatLatency/1000).toFixed(1)}秒`;
              console.log(`✓ ${chatDetail}`);
            } else {
              chatDetail = `响应格式异常: ${JSON.stringify(chatData).substring(0, 200)} (${chatLatency}ms)`;
              console.log(`? ${chatDetail}`);
            }
          } else {
            const errText = await chatResp.text().catch(() => '');
            chatDetail = `HTTP ${chatResp.status} (${chatLatency}ms): ${errText.substring(0, 200)}`;
            console.log(`✗ ${chatDetail}`);
          }
        } catch (e) {
          chatLatency = Date.now() - chatStart;
          chatDetail = `${e.message} (${chatLatency}ms)`;
          console.log(`✗ ${chatDetail}`);
        }
        pResult.tests.push({ name: '对话生成', model: testModel, status: chatOk ? 'pass' : 'fail', latencyMs: chatLatency, detail: chatDetail });
      }
    } else if (provider.modelType === 'video') {
      // 视频模型只测连接
      process.stdout.write(`  [2] 视频生成端点检测... `);
      const vStart = Date.now();
      try {
        const vResp = await fetch(new URL('/v1/video/generations', provider.baseUrl).toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: (provider.selectedModels||[])[0] || '', prompt: 'test' }),
          signal: AbortSignal.timeout(10000),
        });
        const vLatency = Date.now() - vStart;
        const detail = vResp.status === 404 ? '端点不存在（可能使用其他路径）' : `HTTP ${vResp.status} (${vLatency}ms)`;
        console.log(`○ ${detail}`);
        pResult.tests.push({ name: '视频端点', status: vResp.status < 500 ? 'pass' : 'fail', latencyMs: vLatency, detail });
      } catch (e) {
        const vLatency = Date.now() - vStart;
        console.log(`✗ ${e.message} (${vLatency}ms)`);
        pResult.tests.push({ name: '视频端点', status: 'fail', latencyMs: vLatency, detail: e.message });
      }
    }
    
    results.push(pResult);
    console.log('');
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n【测试总结】\n`);
  
  const allPass = results.filter(r => r.tests.every(t => t.status === 'pass'));
  const someFail = results.filter(r => r.tests.some(t => t.status === 'fail'));
  
  console.log(`✅ 完全可用: ${allPass.length}/${results.length}`);
  allPass.forEach(r => console.log(`   - ${r.name} (${r.type})`));
  console.log(`\n❌ 存在问题: ${someFail.length}/${results.length}`);
  someFail.forEach(r => {
    const failed = r.tests.filter(t => t.status === 'fail');
    console.log(`   - ${r.name}: ${failed.map(f => f.name).join(', ')}`);
  });
  
  console.log(`\n测试结束时间: ${new Date().toLocaleString('zh-CN')}`);
  
  // 保存JSON结果
  require('fs').writeFileSync('/tmp/api-test-full-result.json', JSON.stringify(results, null, 2));
  console.log('\n详细结果已保存到 /tmp/api-test-full-result.json');
}

runTests().catch(console.error);
