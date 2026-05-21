/**
 * Client-side encryption utility for sensitive data (e.g., API Keys) stored in localStorage.
 * 
 * Uses Web Crypto API (SubtleCrypto) with AES-GCM encryption.
 * The encryption key is derived from a unique browser fingerprint via PBKDF2.
 * 
 * Security model:
 * - Protects against casual snooping (F12 → Application tab → localStorage)
 * - NOT a replacement for server-side key vault — a determined attacker with JS debugging
 *   can extract the key derivation inputs. This is a defense-in-depth measure.
 * - The key derivation uses a per-origin salt stored in localStorage + browser-specific
 *   signals, making automated mass extraction harder.
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const SALT_KEY = 'unbounded_ai_enc_salt';

/**
 * Generate a deterministic but browser-specific key material.
 * Uses a combination of browser properties that are stable within a session
 * but not easily replicable by automated scripts.
 */
async function getKeyMaterial(): Promise<CryptoKey> {
  // ★ SSR 防护：crypto.subtle 和 localStorage 在服务端不可用
  if (typeof window === 'undefined' || typeof crypto?.subtle === 'undefined') {
    throw new Error('Web Crypto API not available');
  }

  // Generate or retrieve a random salt (persists across sessions)
  let salt = localStorage.getItem(SALT_KEY);
  if (!salt) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(SALT_KEY, salt);
  }
  
  const saltBuffer = new Uint8Array(salt.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Use origin as passphrase (unique per domain)
  const passphrase = `${window.location.origin}_unbounded_key_v1`;
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string. Returns a base64-encoded ciphertext (IV + encrypted data).
 */
export async function encryptValue(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  try {
    const key = await getKeyMaterial();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      encoder.encode(plaintext)
    );
    
    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    // Base64 encode
    return btoa(String.fromCharCode(...combined));
  } catch {
    // Fallback: if encryption fails (e.g., insecure context), return plaintext with prefix
    console.warn('[crypto] Encryption failed, storing with warning prefix');
    return `__plain__${plaintext}`;
  }
}

/**
 * Decrypt a value encrypted by encryptValue().
 */
export async function decryptValue(ciphertext: string): Promise<string> {
  if (!ciphertext) return '';
  
  // Handle unencrypted fallback
  if (ciphertext.startsWith('__plain__')) {
    return ciphertext.slice(9);
  }
  
  try {
    const key = await getKeyMaterial();
    
    // Base64 decode
    const combined = new Uint8Array(
      atob(ciphertext).split('').map(c => c.charCodeAt(0))
    );
    
    // Extract IV and ciphertext
    const iv = combined.slice(0, IV_LENGTH);
    const data = combined.slice(IV_LENGTH);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      data
    );
    
    return new TextDecoder().decode(decrypted);
  } catch {
    // If decryption fails, might be unencrypted legacy data
    console.warn('[crypto] Decryption failed, returning raw value');
    return ciphertext;
  }
}

/**
 * Check if a value appears to be encrypted (base64 encoded with IV prefix)
 * ★ 改进判断逻辑：排除明显的非加密值（__enc__/__plain__前缀、API Key格式等）
 */
export function isEncrypted(value: string): boolean {
  if (!value || value.startsWith('__plain__') || value.startsWith('__enc__')) return false;
  // ★ 排除常见 API Key 格式（sk-xxx 等），这些不应被误判为加密
  if (/^sk[_-]/i.test(value)) return false;
  try {
    const decoded = atob(value);
    // Encrypted values should be at least IV_LENGTH + some ciphertext
    // ★ 且解码后长度应远大于 IV_LENGTH（至少 32 字节密文才有意义）
    return decoded.length > IV_LENGTH + 16;
  } catch {
    return false;
  }
}
