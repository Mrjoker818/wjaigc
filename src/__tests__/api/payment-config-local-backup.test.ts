import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionUser, loadPaymentConfig, dbSetSystemSetting, getServerDataRoot,
  uploadImageToS3, isS3Available, decodeQrFromUrl } = vi.hoisted(() => ({
    getSessionUser: vi.fn(),
    loadPaymentConfig: vi.fn(),
    dbSetSystemSetting: vi.fn(),
    getServerDataRoot: vi.fn(),
    uploadImageToS3: vi.fn(),
    isS3Available: vi.fn(),
    decodeQrFromUrl: vi.fn(),
  }));

vi.mock('@/lib/server-auth', () => ({ getSessionUser }));
vi.mock('@/lib/payment-config', () => ({ loadPaymentConfig, PAYMENT_CONFIG_KEY: 'payment_config' }));
vi.mock('@/lib/db-storage', () => ({ dbSetSystemSetting }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot }));
vi.mock('@/lib/s3-storage', () => ({ uploadImageToS3, isS3Available }));
vi.mock('@/lib/qr-decode', () => ({ decodeQrFromUrl, isPaymentLink: (): boolean => false }));

import { POST } from '@/app/api/credits/payment-config/route';

const temporaryRoots: string[] = [];

beforeEach(() => {
  getSessionUser.mockResolvedValue({ id: 'admin', role: 'admin' });
  loadPaymentConfig.mockResolvedValue({
    wechatQrUrl: '', alipayQrUrl: '', wechatPayLink: '', alipayPayLink: '',
    wechatEnabled: false, alipayEnabled: false, confirmMode: 'manual', note: '',
  });
  dbSetSystemSetting.mockResolvedValue(true);
  uploadImageToS3.mockResolvedValue('s3-qr-key');
  isS3Available.mockReturnValue(true);
  decodeQrFromUrl.mockResolvedValue(null);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function submitQrUrl(qrUrl: string): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/credits/payment-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wechatQrUrl: qrUrl }),
  }));
}

describe('payment configuration local QR backup', () => {
  it('backs up a real image under the managed uploads directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-payment-backup-'));
    temporaryRoots.push(root);
    const dataRoot = path.join(root, 'data');
    await mkdir(path.join(dataRoot, 'uploads'), { recursive: true });
    await writeFile(path.join(dataRoot, 'uploads', 'qr.png'), Buffer.from([1, 2, 3]));
    getServerDataRoot.mockReturnValue(dataRoot);

    const response = await submitQrUrl('/api/serve-upload/qr.png');
    expect(response.status).toBe(200);
    expect(uploadImageToS3).toHaveBeenCalledOnce();
    expect(uploadImageToS3).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), 'qr.png', 'image/png');
    expect(dbSetSystemSetting).toHaveBeenCalledOnce();
  });

  it('never backs up a sibling file reached through a parent segment', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-payment-backup-'));
    temporaryRoots.push(root);
    const dataRoot = path.join(root, 'data');
    const sibling = path.join(root, 'data-other');
    await mkdir(dataRoot);
    await mkdir(sibling);
    await writeFile(path.join(sibling, 'secret.png'), Buffer.from([9, 9, 9]));
    getServerDataRoot.mockReturnValue(dataRoot);

    const response = await submitQrUrl('/api/serve-upload/../data-other/secret.png');
    expect(response.status).toBe(200);
    expect(uploadImageToS3).not.toHaveBeenCalled();
  });

  it('preserves legacy nested public uploads when backing up a QR image', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wujie-payment-backup-'));
    temporaryRoots.push(root);
    const dataRoot = path.join(root, 'data');
    await mkdir(dataRoot);
    await mkdir(path.join(root, 'public', 'uploads', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'public', 'uploads', 'nested', 'qr.png'), Buffer.from([5, 6, 7]));
    getServerDataRoot.mockReturnValue(dataRoot);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const response = await submitQrUrl('/api/serve-upload/nested/qr.png');
    expect(response.status).toBe(200);
    expect(uploadImageToS3).toHaveBeenCalledWith(Buffer.from([5, 6, 7]), 'qr.png', 'image/png');
  });
});
