export async function readWithTransientTransportRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  const attempts = Math.max(1, Math.trunc(maxAttempts));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
      const message = error instanceof Error ? error.message : String(error);
      const transient = /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up/iu.test(`${code} ${message}`);
      if (!transient || attempt === attempts) throw error;
    }
  }
  throw new Error('Transient transport retry exhausted unexpectedly');
}
