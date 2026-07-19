export default async function warmupServer(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
  const response = await fetch(baseURL, { signal: AbortSignal.timeout(60_000) });

  if (!response.ok) {
    throw new Error(`E2E server warmup failed with HTTP ${response.status}`);
  }

  await response.arrayBuffer();
}
