import { dbGetSystemSetting } from '@/lib/db-storage';

export interface QrPaymentConfig {
  wechatQrUrl: string;
  alipayQrUrl: string;
  wechatPayLink: string;
  alipayPayLink: string;
  wechatEnabled: boolean;
  alipayEnabled: boolean;
  confirmMode: 'manual';
  note?: string;
}

export interface PaymentStatus {
  canRecharge: boolean;
  methods: Array<'wechat' | 'alipay'>;
  qrUrls: { wechat: string; alipay: string };
  payLinks: { wechat: string; alipay: string };
  note: string;
  status: { wechat: boolean; alipay: boolean };
}

export const PAYMENT_CONFIG_KEY = 'payment_config';
const DEFAULT_PAYMENT_NOTE = '付款时请备注您的用户名，方便管理员确认';

function isProductionRuntime(): boolean {
  return process.env.COZE_PROJECT_ENV?.trim().toUpperCase() === 'PROD'
    || process.env.NODE_ENV === 'production';
}

export function getProductionPaymentConfigurationIssues(): string[] {
  if (!isProductionRuntime()) return [];

  const secret = process.env.PAYMENT_TOKEN_SECRET?.trim();
  return secret && secret.length >= 32 ? [] : ['Missing PAYMENT_TOKEN_SECRET'];
}

function defaultPaymentConfig(): QrPaymentConfig {
  return {
    wechatQrUrl: '',
    alipayQrUrl: '',
    wechatPayLink: '',
    alipayPayLink: '',
    wechatEnabled: false,
    alipayEnabled: false,
    confirmMode: 'manual',
    note: DEFAULT_PAYMENT_NOTE,
  };
}

export async function loadPaymentConfig(): Promise<QrPaymentConfig> {
  const defaults = defaultPaymentConfig();
  try {
    const value = await dbGetSystemSetting(PAYMENT_CONFIG_KEY);
    if (!value) return defaults;

    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') return defaults;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export async function getPaymentStatus(): Promise<PaymentStatus> {
  const config = await loadPaymentConfig();
  const wechatReady = config.wechatEnabled && Boolean(config.wechatQrUrl || config.wechatPayLink);
  const alipayReady = config.alipayEnabled && Boolean(config.alipayQrUrl || config.alipayPayLink);
  const methods: Array<'wechat' | 'alipay'> = [];

  if (wechatReady) methods.push('wechat');
  if (alipayReady) methods.push('alipay');

  return {
    canRecharge: methods.length > 0,
    methods,
    qrUrls: {
      wechat: wechatReady ? config.wechatQrUrl : '',
      alipay: alipayReady ? config.alipayQrUrl : '',
    },
    payLinks: {
      wechat: wechatReady ? config.wechatPayLink : '',
      alipay: alipayReady ? config.alipayPayLink : '',
    },
    note: config.note || DEFAULT_PAYMENT_NOTE,
    status: { wechat: wechatReady, alipay: alipayReady },
  };
}
