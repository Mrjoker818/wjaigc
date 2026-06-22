/**
 * 扫码跳转 API
 * 用户扫描临时二维码后，验证 token 有效性，显示真实收款码页面
 * 
 * GET /api/credits/pay-redirect?token=xxx
 * → token 有效：显示真实收款码页面（含倒计时）
 * → token 过期：显示二维码已过期提示
 * 
 * v2: 使用 HMAC 签名令牌验证，不依赖内存存储
 * v3: 服务端预获取收款码图片，嵌入 base64 到 HTML，消除客户端对 serve-upload 的依赖
 *     解决重新部署后本地文件丢失导致图片加载失败的问题
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '../payment-qr/route';
import { getServerDataRoot } from '@/lib/server-data-root';
import { downloadImageFromS3, resolveS3Key, deriveS3Key } from '@/lib/s3-storage';
import path from 'path';
import fs from 'fs';

/** 从服务端获取收款码图片并转为 base64 data URL */
async function fetchQrImageAsBase64(imagePath: string): Promise<string | null> {
  // imagePath 可能是 /api/serve-upload/uploads/xxx.png 格式
  // 提取实际文件路径部分
  const relativePath = imagePath.replace(/^\/api\/serve-upload\//, '');
  
  // 1. 尝试从本地文件系统读取
  const dataRoot = getServerDataRoot();
  const possibleDirs = [
    path.join(dataRoot, 'uploads'),
    dataRoot,
  ];
  
  for (const dir of possibleDirs) {
    const fullPath = path.join(dir, relativePath);
    if (fs.existsSync(fullPath)) {
      try {
        const buffer = await fs.promises.readFile(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp'
          : ext === '.svg' ? 'image/svg+xml'
          : 'image/png';
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
      } catch { /* continue */ }
    }
  }
  
  // 1.5 回退: 检查 Next.js public/uploads 目录
  const publicPath = path.join(process.cwd(), 'public', 'uploads', path.basename(relativePath));
  if (fs.existsSync(publicPath)) {
    try {
      const buffer = await fs.promises.readFile(publicPath);
      const ext = path.extname(publicPath).toLowerCase();
      const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.webp' ? 'image/webp'
        : ext === '.svg' ? 'image/svg+xml'
        : 'image/png';
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch { /* continue */ }
  }
  
  // 2. 尝试从 S3 下载
  try {
    const s3Buffer = await downloadImageFromS3(relativePath);
    if (s3Buffer) {
      const ext = path.extname(relativePath).toLowerCase();
      const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.webp' ? 'image/webp'
        : ext === '.svg' ? 'image/svg+xml'
        : 'image/png';
      return `data:${mimeType};base64,${Buffer.from(s3Buffer).toString('base64')}`;
    }
  } catch { /* continue */ }
  
  // 3. 尝试 S3 presigned URL 获取
  try {
    const s3Key = deriveS3Key(relativePath);
    const resolvedKey = await resolveS3Key(s3Key);
    if (resolvedKey) {
      const { getS3PresignedUrl } = await import('@/lib/s3-storage');
      const presignedUrl = await getS3PresignedUrl(resolvedKey);
      if (presignedUrl) {
        const res = await fetch(presignedUrl, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          const contentType = res.headers.get('content-type') || 'image/png';
          return `data:${contentType};base64,${buffer.toString('base64')}`;
        }
      }
    }
  } catch { /* continue */ }
  
  // 4. 如果是完整 URL（http/https），尝试直接下载
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    try {
      const res = await fetch(imagePath, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || 'image/png';
        return `data:${contentType};base64,${buffer.toString('base64')}`;
      }
    } catch { /* continue */ }
  }
  
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return new NextResponse(getExpiredHtml('缺少支付令牌'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // 使用 HMAC 签名验证（无状态，服务器重启不丢失）
  const tokenData = verifyToken(decodeURIComponent(token));

  if (!tokenData) {
    return new NextResponse(getExpiredHtml('二维码已失效，请重新获取'), {
      status: 410,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (tokenData.expiresAt < Date.now()) {
    return new NextResponse(getExpiredHtml('二维码已过期（超过60秒），请重新获取'), {
      status: 410,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const { realQrUrl, method, expiresAt } = tokenData;
  const methodName = method === 'wechat' ? '微信' : '支付宝';
  const methodColor = method === 'wechat' ? '#07C160' : '#1677FF';

  // 服务端预获取收款码图片，嵌入 base64 到 HTML
  // 这确保即使本地文件丢失、S3 暂时不可用，只要服务端能获取到图片数据，页面就能正常显示
  let imgSrc: string;
  let useServerFallback = false;
  
  const base64Data = await fetchQrImageAsBase64(realQrUrl);
  if (base64Data) {
    imgSrc = base64Data;
  } else {
    // 所有服务端获取方式都失败，回退到客户端 URL 加载
    let domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
    domain = domain.replace(/^https?:\/\//, '');
    imgSrc = realQrUrl.startsWith('http') ? realQrUrl : `https://${domain}${realQrUrl}`;
    useServerFallback = true;
    console.warn(`[pay-redirect] 服务端无法获取收款码图片，回退到客户端URL: ${imgSrc}`);
  }

  const fallbackScript = useServerFallback ? `
    <script>
      // 客户端 URL 加载失败时的重试逻辑
      var img = document.querySelector('.qr-container img');
      if (img) {
        img.onerror = function() {
          this.style.display = 'none';
          var placeholder = document.createElement('div');
          placeholder.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#999;font-size:13px;';
          placeholder.textContent = '收款码加载失败，请刷新页面重试';
          this.parentNode.appendChild(placeholder);
        };
      }
    </script>` : '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${methodName}收款码</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; 
      min-height: 100vh;
      display: flex; 
      flex-direction: column;
      align-items: center; 
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      text-align: center;
      max-width: 320px;
      width: 100%;
    }
    .method-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      border-radius: 20px;
      background: ${methodColor}15;
      color: ${methodColor};
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 { font-size: 18px; color: #1a1a1a; margin-bottom: 20px; }
    .qr-wrapper {
      position: relative;
      width: 220px;
      margin: 0 auto 16px;
    }
    .qr-container {
      width: 220px;
      height: 220px;
      border: 2px solid ${methodColor}20;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: white;
    }
    .qr-container img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .countdown {
      position: absolute;
      bottom: -12px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 11px;
      color: #ff6b6b;
      background: white;
      padding: 2px 10px;
      border-radius: 10px;
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    .tip { font-size: 13px; color: #666; margin-top: 20px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="method-badge">
      ${method === 'wechat' ? '&#x1F4AC;' : '&#x1F535;'} ${methodName}支付
    </div>
    <h1>请使用${methodName}扫码支付</h1>
    <div class="qr-wrapper">
      <div class="qr-container">
        <img src="${imgSrc}" alt="${methodName}收款码" />
      </div>
      <div class="countdown" id="countdown"></div>
    </div>
    <p class="tip">请长按识别或扫描上方收款码完成支付</p>
  </div>
  <script>
    var expiresAt = ${expiresAt};
    var el = document.getElementById('countdown');
    function update() {
      var remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (remaining > 0) {
        el.textContent = '\u6B64\u9875\u9762\u5C06\u5728 ' + remaining + ' \u79D2\u540E\u5931\u6548';
        setTimeout(update, 1000);
      } else {
        el.textContent = '\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u83B7\u53D6';
        el.style.color = '#ff0000';
        document.querySelector('.qr-container').style.opacity = '0.3';
      }
    }
    update();
  </script>
  ${fallbackScript}
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function getExpiredHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>二维码已过期</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: white; border-radius: 16px; padding: 40px 32px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; max-width: 320px;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 18px; color: #1a1a1a; margin-bottom: 8px; }
    p { font-size: 14px; color: #999; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x23F0;</div>
    <h1>二维码已失效</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
