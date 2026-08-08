export default async function warmupServer(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
  const allowBlocked = ['1', 'true'].includes(
    (process.env.E2E_ALLOW_BLOCKED || '').toLowerCase(),
  );
  let response: Response;
  try {
    response = await fetch(baseURL, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    if (allowBlocked) {
      console.warn(
        `[stage-0] Deployment warmup is blocked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    throw error;
  }

  if (!response.ok) {
    if (allowBlocked) {
      console.warn(`[stage-0] Deployment warmup returned HTTP ${response.status}.`);
      return;
    }
    throw new Error(`E2E server warmup failed with HTTP ${response.status}`);
  }

  await response.arrayBuffer();
}
