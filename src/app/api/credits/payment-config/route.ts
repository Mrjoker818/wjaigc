import { NextRequest, NextResponse } from 'next/server';
import { dbSetSystemSetting } from '@/lib/db-storage';
import { getSessionUser } from '@/lib/server-auth';
import { loadPaymentConfig, PAYMENT_CONFIG_KEY, type QrPaymentConfig } from '@/lib/payment-config';
import { uploadImageToS3, isS3Available } from '@/lib/s3-storage';
import { getServerDataRoot } from '@/lib/server-data-root';
import { decodeQrFromUrl, isPaymentLink } from '@/lib/qr-decode';
import path from 'path';
import fs from 'fs';

/** GET：获取支付配置（管理员） */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ success: false, error: '需要管理员权限' }, { status: 403 });

  const cfg = await loadPaymentConfig();
  const canAcceptPayments = (cfg.wechatEnabled && (!!cfg.wechatQrUrl || !!cfg.wechatPayLink)) || (cfg.alipayEnabled && (!!cfg.alipayQrUrl || !!cfg.alipayPayLink));

  return NextResponse.json({
    success: true,
    config: cfg,
    status: {
      canAcceptPayments,
      wechatReady: cfg.wechatEnabled && (!!cfg.wechatQrUrl || !!cfg.wechatPayLink),
      alipayReady: cfg.alipayEnabled && (!!cfg.alipayQrUrl || !!cfg.alipayPayLink),
    },
  });
}

/** POST：保存支付配置 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ success: false, error: '需要管理员权限' }, { status: 403 });

  try {
    const body = await request.json();
    const currentCfg: QrPaymentConfig = await loadPaymentConfig();

    // 更新收款码配置
    if (body.wechatQrUrl !== undefined) currentCfg.wechatQrUrl = body.wechatQrUrl;
    if (body.alipayQrUrl !== undefined) currentCfg.alipayQrUrl = body.alipayQrUrl;
    if (body.wechatEnabled !== undefined) currentCfg.wechatEnabled = !!body.wechatEnabled;
    if (body.alipayEnabled !== undefined) currentCfg.alipayEnabled = !!body.alipayEnabled;
    if (body.confirmMode !== undefined) currentCfg.confirmMode = body.confirmMode;
    if (body.note !== undefined) currentCfg.note = body.note;

    // 保存 payLink 字段
    if (body.wechatPayLink !== undefined) currentCfg.wechatPayLink = body.wechatPayLink;
    if (body.alipayPayLink !== undefined) currentCfg.alipayPayLink = body.alipayPayLink;

    // 自动启用：有收款码URL或支付链接就自动启用
    if (body.wechatQrUrl !== undefined) currentCfg.wechatEnabled = !!(body.wechatQrUrl || currentCfg.wechatPayLink);
    if (body.alipayQrUrl !== undefined) currentCfg.alipayEnabled = !!(body.alipayQrUrl || currentCfg.alipayPayLink);
    if (body.wechatPayLink !== undefined) currentCfg.wechatEnabled = !!(currentCfg.wechatQrUrl || body.wechatPayLink);
    if (body.alipayPayLink !== undefined) currentCfg.alipayEnabled = !!(currentCfg.alipayQrUrl || body.alipayPayLink);

    // 自动从收款码图片解码支付链接（微信 wxp:// / 支付宝 https://qr.alipay.com/）
    const tryDecodeQr = async (qrUrl: string, method: 'wechat' | 'alipay') => {
      if (!qrUrl) return;
      try {
        const decoded = await decodeQrFromUrl(qrUrl);
        if (decoded && isPaymentLink(decoded)) {
          if (method === 'wechat') currentCfg.wechatPayLink = decoded;
          else currentCfg.alipayPayLink = decoded;
          console.log(`[payment-config] Auto-decoded ${method} pay link: ${decoded.substring(0, 30)}...`);
        }
      } catch (err) {
        console.warn(`[payment-config] Failed to decode ${method} QR:`, err instanceof Error ? err.message : err);
      }
    };

    // 当收款码URL变更时自动解码
    if (body.wechatQrUrl !== undefined && body.wechatQrUrl) await tryDecodeQr(body.wechatQrUrl, 'wechat');
    if (body.alipayQrUrl !== undefined && body.alipayQrUrl) await tryDecodeQr(body.alipayQrUrl, 'alipay');

    // 主动将收款码图片备份到 S3（防止重新部署后本地文件丢失）
    const urlsToBackup = [currentCfg.wechatQrUrl, currentCfg.alipayQrUrl].filter(u => u && u.startsWith('/api/serve-upload/'));
    if (urlsToBackup.length > 0 && isS3Available()) {
      const dataRoot = getServerDataRoot();
      for (const url of urlsToBackup) {
        const relativePath = url.replace(/^\/api\/serve-upload\//, '');
        const possibleDirs = [
          path.join(dataRoot, 'uploads'),
          dataRoot,
          path.join(process.cwd(), 'public', 'uploads'),
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
              const s3Key = await uploadImageToS3(buffer, path.basename(relativePath), mimeType);
              if (s3Key) console.log(`[payment-config] S3 backup: ${relativePath} → ${s3Key}`);
            } catch (err) {
              console.warn(`[payment-config] S3 backup failed for ${relativePath}:`, err instanceof Error ? err.message : err);
            }
            break; // 找到文件就不继续搜索其他目录
          }
        }
      }
    }

    await dbSetSystemSetting(PAYMENT_CONFIG_KEY, JSON.stringify(currentCfg));

    const canAcceptPayments = (currentCfg.wechatEnabled && !!(currentCfg.wechatQrUrl || currentCfg.wechatPayLink)) || (currentCfg.alipayEnabled && !!(currentCfg.alipayQrUrl || currentCfg.alipayPayLink));

    return NextResponse.json({
      success: true,
      config: currentCfg,
      status: {
        canAcceptPayments,
        wechatReady: currentCfg.wechatEnabled && !!(currentCfg.wechatQrUrl || currentCfg.wechatPayLink),
        alipayReady: currentCfg.alipayEnabled && !!(currentCfg.alipayQrUrl || currentCfg.alipayPayLink),
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: '保存失败: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 });
  }
}
