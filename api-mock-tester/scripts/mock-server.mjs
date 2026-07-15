/**
 * Mock API Server — 模拟外部 AI 服务接口
 * 支持: OpenAI / Gemini / Video APIs / IOPaint / PearAPI / 3D API
 * 
 * 用法: node mock-server.mjs [--port 3456]
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

// ============ 最小 PNG 生成 (1×1 白色 = 67 bytes, 16×16 彩色测试图) ============
function createMinimalPNG(width = 16, height = 16) {
  // 创建一个简单的 PNG 文件
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);
  
  // IDAT chunk - raw image data
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter: none
    for (let x = 0; x < width; x++) {
      // 生成彩色测试图案
      const r = (x * 16) % 256;
      const g = (y * 16) % 256;
      const b = ((x + y) * 8) % 256;
      rawData.push(r, g, b);
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idat = makeChunk('IDAT', compressed);
  
  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 预生成测试图片
const TEST_PNG = createMinimalPNG(64, 64);
const TEST_PNG_BASE64 = TEST_PNG.toString('base64');
const TEST_PNG_DATA_URL = `data:image/png;base64,${TEST_PNG_BASE64}`;

// ============ Mock 响应定义 ============

const MOCK_RESPONSES = {
  // ---------- OpenAI Compatible ----------
  'GET /v1/models': {
    object: 'list',
    data: [
      { id: 'mock-model-001', object: 'model', owned_by: 'mock', type: 'image' },
      { id: 'mock-chat-model-001', object: 'model', owned_by: 'mock', type: 'chat' },
      { id: 'dall-e-3', object: 'model', owned_by: 'mock', type: 'image' },
      { id: 'gpt-image-2', object: 'model', owned_by: 'mock', type: 'image' },
      { id: 'gpt-4o', object: 'model', owned_by: 'mock', type: 'chat' },
    ]
  },
  
  'POST /v1/images/generations': (body) => {
    const n = body.n || 1;
    const images = [];
    for (let i = 0; i < n; i++) {
      if (body.response_format === 'b64_json') {
        images.push({ b64_json: TEST_PNG_BASE64, revised_prompt: `Mock generated image ${i+1}` });
      } else if (body.response_format === 'url') {
        images.push({ url: `http://localhost:${serverPort}/mock-image.png`, revised_prompt: `Mock generated image ${i+1}` });
      } else {
        images.push({ url: `http://localhost:${serverPort}/mock-image.png`, revised_prompt: `Mock generated image ${i+1}` });
      }
    }
    return {
      created: Math.floor(Date.now() / 1000),
      data: images,
    };
  },

  'POST /v1/images/edits': () => {
    return {
      created: Math.floor(Date.now() / 1000),
      data: [{
        url: `http://localhost:${serverPort}/mock-image.png`,
        revised_prompt: 'Mock edited image'
      }]
    };
  },

  'POST /v1/chat/completions': (body) => {
    const isStream = body.stream === true;
    if (isStream) {
      // 返回 SSE 流格式标记，但这里返回 JSON，由 handler 处理流式
      return {
        id: `chatcmpl-${randomUUID().slice(0, 8)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'gpt-4o',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'This is a mock AI response for testing purposes.' },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      };
    }
    return {
      id: `chatcmpl-${randomUUID().slice(0, 8)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'gpt-4o',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'This is a mock AI response for testing purposes.' },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    };
  },

  // ---------- Gemini ----------
  'POST /v1beta/models/:generateContent': () => {
    return {
      candidates: [{
        content: {
          parts: [{ text: 'Mock Gemini response for testing.' }],
          role: 'model'
        },
        finishReason: 'STOP',
        index: 0
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 }
    };
  },

  // ---------- Video APIs ----------
  // Dashscope (Kling)
  'POST /v1/services/aigc/video-generation/generation': () => {
    return {
      output: { task_id: `mock-video-${randomUUID().slice(0, 8)}`, task_status: 'PENDING' },
      request_id: randomUUID().slice(0, 8)
    };
  },
  'GET /v1/tasks/:taskId': () => {
    return {
      output: {
        task_status: 'SUCCEEDED',
        video_url: `http://localhost:${serverPort}/mock-video.mp4`
      },
      request_id: randomUUID().slice(0, 8)
    };
  },

  // Volcengine (Seedance/Doubao)
  'POST /api/v3/contents/generations/tasks/submit': () => {
    return { id: `mock-video-${randomUUID().slice(0, 8)}`, status: 'queued' };
  },
  'GET /api/v3/contents/generations/tasks/:taskId': () => {
    return { id: 'mock-video-task', status: 'succeeded', content: { video_url: `http://localhost:${serverPort}/mock-video.mp4` } };
  },

  // Minimax (Hailuo)
  'POST /v1/video_generation': () => {
    return { task_id: `mock-video-${randomUUID().slice(0, 8)}`, status: 'pending' };
  },
  'GET /v1/query/video_generation_task': () => {
    return { status: 'succeeded', file: { download_url: `http://localhost:${serverPort}/mock-video.mp4` } };
  },

  // Fal
  'POST /v1/fal/queue/submit': () => {
    return { request_id: `mock-${randomUUID().slice(0, 8)}`, status: 'IN_QUEUE' };
  },
  'GET /v1/fal/queue/:requestId/status': () => {
    return { status: 'COMPLETED' };
  },
  'GET /v1/fal/queue/:requestId/result': () => {
    return { video: { url: `http://localhost:${serverPort}/mock-video.mp4` } };
  },

  // Vidu
  'POST /v1/video/generate': () => {
    return { data: { task_id: `mock-video-${randomUUID().slice(0, 8)}` } };
  },
  'GET /v1/video/status': () => {
    return { data: { status: 'success', video_url: `http://localhost:${serverPort}/mock-video.mp4` } };
  },

  // ---------- IOPaint ----------
  'POST /api/paint': () => {
    return { image: TEST_PNG_BASE64 };
  },

  // ---------- PearAPI ----------
  'POST /api/photo-enhancer': () => {
    return {
      output_url: `http://localhost:${serverPort}/mock-image.png`,
      status: 'success'
    };
  },

  // ---------- 3D API ----------
  'POST /v1/3d/generate': () => {
    return { task_id: `mock-3d-${randomUUID().slice(0, 8)}`, status: 'pending' };
  },
  'GET /v1/3d/status': () => {
    return { status: 'completed', model_url: `http://localhost:${serverPort}/mock-model.glb` };
  },

  // ---------- RemoveBG ----------
  'POST /api/removebg': () => {
    return { data: TEST_PNG_BASE64 };
  },
};

// ============ Mock 静态文件服务 ============

// 最小 MP4 视频 (黑帧, 1秒)
const MOCK_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D,
  0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6F, 0x6D, 0x69, 0x73, 0x6F, 0x32,
  0x6D, 0x70, 0x34, 0x31, 0x00, 0x00, 0x00, 0x00
]);

// ============ HTTP 服务器 ============

let serverPort = 3456;
const requestLog = [];

function matchRoute(method, url, patterns) {
  for (const [pattern, handler] of Object.entries(patterns)) {
    const [pMethod, pPath] = pattern.split(' ', 2);
    if (pMethod !== method) continue;
    
    // 简单路径匹配: 支持前缀匹配和 :param 通配
    const pParts = pPath.split('/');
    const uParts = url.split('?')[0].split('/');
    if (pParts.length !== uParts.length) continue;
    
    let match = true;
    for (let i = 0; i < pParts.length; i++) {
      if (pParts[i].startsWith(':')) continue; // 通配段
      if (pParts[i] !== uParts[i]) { match = false; break; }
    }
    if (match) return handler;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  const url = req.url || '/';
  const method = req.method || 'GET';
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  
  // 静态 Mock 文件
  if (url === '/mock-image.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': TEST_PNG.length });
    res.end(TEST_PNG);
    logRequest(method, url, 200, Date.now() - startTime);
    return;
  }
  if (url === '/mock-video.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.end(MOCK_MP4_HEADER);
    logRequest(method, url, 200, Date.now() - startTime);
    return;
  }
  if (url === '/mock-model.glb') {
    // 返回最小的 GLB 文件头
    const glbHeader = Buffer.alloc(12);
    glbHeader.write('glTF', 0, 4, 'ascii'); // magic
    glbHeader.writeUInt32LE(2, 4); // version
    glbHeader.writeUInt32LE(12, 8); // length
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
    res.end(glbHeader);
    logRequest(method, url, 200, Date.now() - startTime);
    return;
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), requests: requestLog.length }));
    return;
  }
  
  // 读取请求体
  let body = null;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  
  // 匹配 Mock 响应
  const handler = matchRoute(method, url, MOCK_RESPONSES);
  if (handler) {
    const result = typeof handler === 'function' ? handler(body) : handler;
    
    // SSE 流式响应
    if (url.includes('/chat/completions') && body?.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      // 发送几个 data chunk
      const chunks = [
        { choices: [{ delta: { content: 'Mock ' }, index: 0 }] },
        { choices: [{ delta: { content: 'AI ' }, index: 0 }] },
        { choices: [{ delta: { content: 'response.' }, index: 0, finish_reason: 'stop' }] },
      ];
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ ...result, ...chunk })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    logRequest(method, url, 200, Date.now() - startTime);
    return;
  }
  
  // 未匹配的路径 - 返回通用成功响应
  console.log(`[MOCK] ⚠ Unmatched: ${method} ${url}`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ mock: true, message: 'Unmatched mock endpoint', path: url, method }));
  logRequest(method, url, 200, Date.now() - startTime);
});

function logRequest(method, url, status, duration) {
  requestLog.push({ method, url, status, duration, time: new Date().toISOString() });
}

// 解析命令行参数
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
if (portArg !== -1 && args[portArg + 1]) {
  serverPort = parseInt(args[portArg + 1], 10);
}

server.listen(serverPort, () => {
  console.log(`\n🧪 Mock API Server started on port ${serverPort}`);
  console.log(`   Health: http://localhost:${serverPort}/health`);
  console.log(`   Test image: http://localhost:${serverPort}/mock-image.png`);
  console.log(`   Test video: http://localhost:${serverPort}/mock-video.mp4`);
  console.log(`\n   Supported endpoints:`);
  Object.keys(MOCK_RESPONSES).forEach(k => console.log(`   ${k}`));
  console.log(`\n   Any unmatched endpoint returns a generic 200 response.\n`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n🛑 Mock server shutting down...');
  server.close(() => process.exit(0));
});

// 导出供测试使用
export { serverPort, TEST_PNG, TEST_PNG_BASE64, TEST_PNG_DATA_URL, requestLog };
