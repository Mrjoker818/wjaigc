export interface BIUploadInput {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
  slot: number;
  front: Uint8Array;
  side: Uint8Array;
}

export interface BIUploadReceipt {
  slot: number;
  role: 'front' | 'side';
  name: string;
  bytes: number;
}

export async function validateBIUpload(input: BIUploadInput): Promise<BIUploadReceipt> {
  if (input.method !== 'POST') throw Error('BI_UPLOAD_METHOD');
  const url = new URL(input.url);
  if (url.origin !== 'https://canvas-shell-mobile.invalid' || url.pathname !== '/api/save-image'
    || url.search || url.hash || url.username || url.password) throw Error('BI_UPLOAD_URL');
  const headers = Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (['authorization', 'cookie', 'x-api-key', 'api-key', 'idempotency-key'].some(key => key in headers)) {
    throw Error('BI_UPLOAD_CREDENTIALS');
  }
  if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot > 1) throw Error('BI_UPLOAD_COUNT');
  if (!input.body || input.body.byteLength > 4096) throw Error('BI_UPLOAD_BODY_LIMIT');
  if (!/^multipart\/form-data;\s*boundary=/i.test(headers['content-type'] ?? '')) throw Error('BI_UPLOAD_MULTIPART');
  let form: FormData;
  try {
    form = await new Response(Uint8Array.from(input.body).buffer, { headers: { 'content-type': headers['content-type'] } }).formData();
  } catch {
    throw Error('BI_UPLOAD_MULTIPART');
  }
  const fields = [...form.entries()];
  if (fields.length !== 1 || fields[0][0] !== 'file' || typeof fields[0][1] === 'string') throw Error('BI_UPLOAD_FIELD');
  const file = fields[0][1];
  if (file.type !== 'image/png') throw Error('BI_UPLOAD_MIME');
  const role = input.slot === 0 ? 'front' : 'side';
  if (file.name !== `bi-${role}.png`) throw Error('BI_UPLOAD_NAME');
  const bytes = new Uint8Array(await file.arrayBuffer()), expected = role === 'front' ? input.front : input.side;
  if (bytes.byteLength !== expected.byteLength || !bytes.every((value, index) => value === expected[index])) throw Error('BI_UPLOAD_BYTES');
  return { slot: input.slot, role, name: file.name, bytes: bytes.byteLength };
}

export interface BIActivityInput extends Pick<BIUploadInput, 'url' | 'method' | 'headers' | 'body' | 'slot'> {
  statuses: readonly number[];
}
export interface BIActivityReceipt { slot: number; status: number; durationMs: number }
export async function validateBIActivity(input: BIActivityInput): Promise<BIActivityReceipt> {
  if (input.method !== 'POST') throw Error('BI_ACTIVITY_METHOD');
  const url = new URL(input.url);
  if (url.origin !== 'https://canvas-shell-mobile.invalid' || url.pathname !== '/api/activity'
    || url.search || url.hash || url.username || url.password) throw Error('BI_ACTIVITY_URL');
  const headers = Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (['authorization', 'cookie', 'x-api-key', 'api-key', 'idempotency-key'].some(key => key in headers)) throw Error('BI_ACTIVITY_CREDENTIALS');
  if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot > 1 || input.slot >= input.statuses.length) throw Error('BI_ACTIVITY_COUNT');
  if (!input.body || input.body.byteLength > 512) throw Error('BI_ACTIVITY_BODY_LIMIT');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(input.body)); } catch { throw Error('BI_ACTIVITY_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('BI_ACTIVITY_FIELDS');
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['action','durationMs','method','path','status'])
    || headers['content-type'] !== 'application/json' || record.action !== 'post_api_request'
    || record.method !== 'POST' || record.path !== '/api/save-image') throw Error('BI_ACTIVITY_FIELDS');
  const status = record.status, durationMs = record.durationMs;
  if (typeof status !== 'number' || status !== input.statuses[input.slot] || ![200,500].includes(status)) throw Error('BI_ACTIVITY_STATUS');
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > 25000) throw Error('BI_ACTIVITY_DURATION');
  return { slot: input.slot, status, durationMs };
}
