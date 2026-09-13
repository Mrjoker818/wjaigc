const CHUNK_RECOVERY_PARAM = '_chunk_retry';
const CHUNK_RECOVERY_MARKER_PREFIX = 'wujie:chunk-recovery:';

interface ChunkRecoveryEnvironment {
  href: string;
  now: () => number;
  readMarker: (key: string) => string | null;
  writeMarker: (key: string, value: string) => void;
  replace: (url: string) => void;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error ?? '');
}

function chunkFingerprint(message: string): string | null {
  const chunkPath = message.match(/\/_next\/static\/chunks\/[^\s)'"?]+\.js/i)?.[0];
  if (chunkPath) return chunkPath;

  const numberedChunk = message.match(/Loading chunk\s+([\w-]+)\s+failed/i)?.[1];
  if (numberedChunk) return `chunk:${numberedChunk}`;

  if (/ChunkLoadError/i.test(message)) return 'chunk-load-error';
  return null;
}

function browserEnvironment(): ChunkRecoveryEnvironment | null {
  if (typeof window === 'undefined') return null;

  return {
    href: window.location.href,
    now: () => Date.now(),
    readMarker: key => window.sessionStorage.getItem(key),
    writeMarker: (key, value) => window.sessionStorage.setItem(key, value),
    replace: url => window.location.replace(url),
  };
}

export function attemptChunkLoadRecovery(
  error: unknown,
  environment: ChunkRecoveryEnvironment | null = browserEnvironment(),
): boolean {
  if (!environment) return false;

  const fingerprint = chunkFingerprint(errorText(error));
  if (!fingerprint) return false;

  const retryUrl = new URL(environment.href);
  if (retryUrl.searchParams.has(CHUNK_RECOVERY_PARAM)) return false;

  const markerKey = `${CHUNK_RECOVERY_MARKER_PREFIX}${fingerprint}`;
  try {
    if (environment.readMarker(markerKey)) return false;
  } catch {
    // The URL retry token remains the loop guard when storage is unavailable.
  }

  const retryToken = String(environment.now());
  try {
    environment.writeMarker(markerKey, retryToken);
  } catch {
    // Storage can be disabled by browser privacy policy; recovery can still proceed once.
  }

  retryUrl.searchParams.set(CHUNK_RECOVERY_PARAM, retryToken);
  environment.replace(retryUrl.toString());
  return true;
}
