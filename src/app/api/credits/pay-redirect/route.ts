/**
 * 扫码跳转 API
 * 用户扫描临时二维码后，验证 token 有效性，显示真实收款码页面
 * 
 * GET /api/credits/pay-redirect?token=xxx
 * → token 有效：显示真实收款码页面（含倒计时）
 * → token 过期：显示二维码已过期提示
 */

import { NextRequest, NextResponse } from 'next/server';

type TokenData = { realQrUrl: string; method: string; expiresAt: number };

const g = globalThis as Record<string, unknown>;

function getTokenStore(): Map<string, TokenData> {
  return (g.__paymentTokenStore || new Map<string, TokenData>()) as Map<string, TokenData>;
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

  const store = getTokenStore();
  const tokenData = store.get(token);

  if (!tokenData) {
    return new NextResponse(getExpiredHtml('二维码已失效，请重新获取'), {
      status: 410,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (tokenData.expiresAt < Date.now()) {
    store.delete(token);
    return new NextResponse(getExpiredHtml('二维码已过期（超过60秒），请重新获取'), {
      status: 410,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const { realQrUrl, method, expiresAt } = tokenData;
  const methodName = method === 'wechat' ? '微信' : '支付宝';
  const methodColor = method === 'wechat' ? '#07C160' : '#1677FF';
  let domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
  domain = domain.replace(/^https?:\/\//, '');
  const fullQrUrl = realQrUrl.startsWith('http') ? realQrUrl : `https://${domain}${realQrUrl}`;

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
    .qr-container {
      width: 220px;
      height: 220px;
      margin: 0 auto 16px;
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
    .tip { font-size: 13px; color: #666; margin-top: 12px; line-height: 1.6; }
    .countdown { font-size: 12px; color: #ff6b6b; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="method-badge">
      ${method === 'wechat' ? '&#x1F4AC;' : '&#x1F535;'} ${methodName}支付
    </div>
    <h1>请使用${methodName}扫码支付</h1>
    <div class="qr-container">
      <img src="${fullQrUrl}" alt="${methodName}收款码" />
    </div>
    <p class="tip">请长按识别或扫描上方收款码完成支付</p>
    <p class="countdown" id="countdown"></p>
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
