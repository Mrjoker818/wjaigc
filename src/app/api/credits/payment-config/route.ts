import { NextRequest, NextResponse } from 'next/server';
import { dbGetSystemSetting, dbSetSystemSetting } from '@/lib/db-storage';
import { getSessionUser } from '@/lib/server-auth';

/** 支付配置结构 */
interface PaymentConfig {
  alipay: {
    enabled: boolean;
    appId: string;
    privateKey: string;   // RSA2 私钥（仅存储，不返回给前端）
    publicKey: string;    // 支付宝公钥
    notifyUrl: string;    // 异步通知地址
    sandbox: boolean;     // 是否沙箱模式
  };
  wechat: {
    enabled: boolean;
    mchId: string;        // 商户号
    appId: string;        // 应用ID
    apiKey: string;       // APIv3 密钥（仅存储，不返回给前端）
    serialNo: string;     // 证书序列号
    notifyUrl: string;    // 异步通知地址
  };
}

const CONFIG_KEY = 'payment_config';

function getDefaultConfig(): PaymentConfig {
  return {
    alipay: {
      enabled: false,
      appId: process.env.ALIPAY_APP_ID || '',
      privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
      publicKey: process.env.ALIPAY_PUBLIC_KEY || '',
      notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
      sandbox: process.env.ALIPAY_SANDBOX === 'true',
    },
    wechat: {
      enabled: false,
      mchId: process.env.WECHAT_MCH_ID || '',
      appId: process.env.WECHAT_APP_ID || '',
      apiKey: process.env.WECHAT_API_KEY || '',
      serialNo: process.env.WECHAT_SERIAL_NO || '',
      notifyUrl: process.env.WECHAT_NOTIFY_URL || '',
    },
  };
}

/** 合并：DB 配置 > 环境变量 > 默认 */
async function loadConfig(): Promise<PaymentConfig> {
  const defaultCfg = getDefaultConfig();
  try {
    const dbVal = await dbGetSystemSetting(CONFIG_KEY);
    if (dbVal) {
      const dbCfg = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
      // DB 中有值则覆盖，否则用环境变量
      return {
        alipay: { ...defaultCfg.alipay, ...dbCfg.alipay },
        wechat: { ...defaultCfg.wechat, ...dbCfg.wechat },
      };
    }
  } catch { /* ignore */ }
  return defaultCfg;
}

/** 脱敏：不返回私钥/密钥给前端 */
function sanitizeConfig(cfg: PaymentConfig) {
  return {
    alipay: {
      enabled: cfg.alipay.enabled,
      appId: cfg.alipay.appId ? `${cfg.alipay.appId.slice(0, 4)}****` : '',
      hasPrivateKey: !!cfg.alipay.privateKey,
      publicKey: cfg.alipay.publicKey ? `${cfg.alipay.publicKey.slice(0, 8)}****` : '',
      hasPublicKey: !!cfg.alipay.publicKey,
      notifyUrl: cfg.alipay.notifyUrl,
      sandbox: cfg.alipay.sandbox,
    },
    wechat: {
      enabled: cfg.wechat.enabled,
      mchId: cfg.wechat.mchId ? `${cfg.wechat.mchId.slice(0, 4)}****` : '',
      appId: cfg.wechat.appId ? `${cfg.wechat.appId.slice(0, 4)}****` : '',
      hasApiKey: !!cfg.wechat.apiKey,
      serialNo: cfg.wechat.serialNo,
      notifyUrl: cfg.wechat.notifyUrl,
    },
  };
}

/** GET：获取支付配置（管理员可见完整配置） + 配置状态 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ success: false, error: '需要管理员权限' }, { status: 403 });

  const cfg = await loadConfig();
  const fullyConfigured = {
    alipay: cfg.alipay.enabled && !!cfg.alipay.appId && !!cfg.alipay.privateKey && !!cfg.alipay.publicKey && !!cfg.alipay.notifyUrl,
    wechat: cfg.wechat.enabled && !!cfg.wechat.mchId && !!cfg.wechat.appId && !!cfg.wechat.apiKey && !!cfg.wechat.notifyUrl,
  };

  return NextResponse.json({
    success: true,
    config: {
      alipay: {
        appId: cfg.alipay.appId,
        privateKey: cfg.alipay.privateKey,
        publicKey: cfg.alipay.publicKey,
        notifyUrl: cfg.alipay.notifyUrl,
        sandbox: cfg.alipay.sandbox,
      },
      wechat: {
        mchId: cfg.wechat.mchId,
        appId: cfg.wechat.appId,
        apiKey: cfg.wechat.apiKey,
        notifyUrl: cfg.wechat.notifyUrl,
      },
    },
    status: {
      anyEnabled: cfg.alipay.enabled || cfg.wechat.enabled,
      fullyConfigured,
      canAcceptPayments: fullyConfigured.alipay || fullyConfigured.wechat,
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

    // 合并：前端只传需要更新的字段，密钥类如果传空字符串则保留原值
    if (body.alipay) {
      const a = body.alipay;
      currentCfg.alipay.appId = a.appId ?? currentCfg.alipay.appId;
      if (a.privateKey) currentCfg.alipay.privateKey = a.privateKey;
      if (a.publicKey) currentCfg.alipay.publicKey = a.publicKey;
      currentCfg.alipay.notifyUrl = a.notifyUrl ?? currentCfg.alipay.notifyUrl;
      currentCfg.alipay.sandbox = a.sandbox ?? currentCfg.alipay.sandbox;
      // Auto-enable when all required fields are present
      currentCfg.alipay.enabled = !!(currentCfg.alipay.appId && currentCfg.alipay.privateKey && currentCfg.alipay.publicKey && currentCfg.alipay.notifyUrl);
    }
    if (body.wechat) {
      const w = body.wechat;
      currentCfg.wechat.mchId = w.mchId ?? currentCfg.wechat.mchId;
      currentCfg.wechat.appId = w.appId ?? currentCfg.wechat.appId;
      if (w.apiKey) currentCfg.wechat.apiKey = w.apiKey;
      currentCfg.wechat.notifyUrl = w.notifyUrl ?? currentCfg.wechat.notifyUrl;
      // Auto-enable when all required fields are present
      currentCfg.wechat.enabled = !!(currentCfg.wechat.mchId && currentCfg.wechat.appId && currentCfg.wechat.apiKey && currentCfg.wechat.notifyUrl);
    }

    await dbSetSystemSetting(CONFIG_KEY, JSON.stringify(currentCfg));

    return NextResponse.json({
      success: true,
      config: sanitizeConfig(currentCfg),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: '保存失败: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 });
  }
}
