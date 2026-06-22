import { NextRequest, NextResponse } from 'next/server';
import { dbGetSystemSetting, dbSetSystemSetting } from '@/lib/db-storage';
import { getSessionUser } from '@/lib/server-auth';
import { uploadImageToS3, isS3Available } from '@/lib/s3-storage';
import { getServerDataRoot } from '@/lib/server-data-root';
import path from 'path';
import fs from 'fs';

/** 个人收款码支付配置 */
interface QrPaymentConfig {
  wechatQrUrl: string;      // 微信收款码图片URL
  alipayQrUrl: string;      // 支付宝收款码图片URL
  wechatEnabled: boolean;   // 是否启用微信收款
  alipayEnabled: boolean;   // 是否启用支付宝收款
  confirmMode: 'manual';    // 确认模式：仅手动（管理员确认到账）
  note?: string;            // 给用户的付款备注提示（如"请备注您的用户名"）
}

const CONFIG_KEY = 'payment_config';

function getDefaultConfig(): QrPaymentConfig {
  return {
    wechatQrUrl: '',
    alipayQrUrl: '',
    wechatEnabled: false,
    alipayEnabled: false,
    confirmMode: 'manual',
    note: '付款时请备注您的用户名，方便管理员确认',
  };
}

async function loadConfig(): Promise<QrPaymentConfig> {
  const defaultCfg = getDefaultConfig();
  try {
    const dbVal = await dbGetSystemSetting(CONFIG_KEY);
    if (dbVal) {
      const dbCfg = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
      return { ...defaultCfg, ...dbCfg };
    }
  } catch { /* ignore */ }
  return defaultCfg;
}

/** GET：获取支付配置（管理员） */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ success: false, error: '需要管理员权限' }, { status: 403 });

  const cfg = await loadConfig();
  const canAcceptPayments = (cfg.wechatEnabled && !!cfg.wechatQrUrl) || (cfg.alipayEnabled && !!cfg.alipayQrUrl);

  return NextResponse.json({
    success: true,
    config: cfg,
    status: {
      canAcceptPayments,
      wechatReady: cfg.wechatEnabled && !!cfg.wechatQrUrl,
      alipayReady: cfg.alipayEnabled && !!cfg.alipayQrUrl,
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
    const currentCfg = await loadConfig();

    // 更新收款码配置
    if (body.wechatQrUrl !== undefined) currentCfg.wechatQrUrl = body.wechatQrUrl;
    if (body.alipayQrUrl !== undefined) currentCfg.alipayQrUrl = body.alipayQrUrl;
    if (body.wechatEnabled !== undefined) currentCfg.wechatEnabled = !!body.wechatEnabled;
    if (body.alipayEnabled !== undefined) currentCfg.alipayEnabled = !!body.alipayEnabled;
    if (body.confirmMode !== undefined) currentCfg.confirmMode = body.confirmMode;
    if (body.note !== undefined) currentCfg.note = body.note;

    // 自动启用：有收款码URL就自动启用，清空URL就自动禁用
    if (body.wechatQrUrl !== undefined) currentCfg.wechatEnabled = !!body.wechatQrUrl;
    if (body.alipayQrUrl !== undefined) currentCfg.alipayEnabled = !!body.alipayQrUrl;

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

    await dbSetSystemSetting(CONFIG_KEY, JSON.stringify(currentCfg));

    const canAcceptPayments = (currentCfg.wechatEnabled && !!currentCfg.wechatQrUrl) || (currentCfg.alipayEnabled && !!currentCfg.alipayQrUrl);

    return NextResponse.json({
      success: true,
      config: currentCfg,
      status: {
        canAcceptPayments,
        wechatReady: currentCfg.wechatEnabled && !!currentCfg.wechatQrUrl,
        alipayReady: currentCfg.alipayEnabled && !!currentCfg.alipayQrUrl,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: '保存失败: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 });
  }
}
