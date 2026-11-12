import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';

export const documentBrowserCrypto = {
  getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
  randomUUID: webcrypto.randomUUID.bind(webcrypto),
  subtle: {
    digest(algorithm: AlgorithmIdentifier, input: BufferSource): Promise<ArrayBuffer> {
      // Copy jsdom bytes into Node's realm and preserve the bounds of typed-array views.
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
      return webcrypto.subtle.digest(algorithm, Buffer.from(bytes));
    },
  },
};
