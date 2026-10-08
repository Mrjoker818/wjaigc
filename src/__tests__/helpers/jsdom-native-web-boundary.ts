import { webcrypto } from 'node:crypto';

// jsdom FileReader returns a browser-realm ArrayBuffer. Node 20's native
// WebCrypto requires a Node-realm buffer; preserve every byte and the real hash.
const digest = (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  return webcrypto.subtle.digest(algorithm, Buffer.from(bytes));
};

const subtle = new Proxy(webcrypto.subtle, {
  get(target, key): unknown {
    if (key === 'digest') return digest;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

// All other cryptographic methods still execute on the native implementation.
export const jsdomCrypto = new Proxy(webcrypto, {
  get(target, key): unknown {
    if (key === 'subtle') return subtle;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

// Native Response provides status, headers and one-shot body consumption. Its
// blob is materialized in jsdom's realm so browser FileReader/JSZip can read it.
export function browserBinaryResponse(bytes: Uint8Array<ArrayBuffer>, init?: ResponseInit): Response {
  const response = new Response(bytes, init);
  response.blob = async (): Promise<Blob> => new Blob([new Uint8Array(await response.arrayBuffer())], {
    type: response.headers.get('content-type') ?? '',
  });
  return response;
}
