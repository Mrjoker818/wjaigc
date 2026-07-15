async function main(): Promise<void> {
  if (process.env.HUMAN_AI_SMOKE_TEST !== 'true') {
    console.log('Human AI Engine smoke test skipped. Set HUMAN_AI_SMOKE_TEST=true to enable a paid Provider call.');
    return;
  }

  const imageUrl = process.env.HUMAN_AI_SMOKE_IMAGE_URL;
  const model = process.env.HUMAN_AI_SMOKE_MODEL;
  const cookie = process.env.HUMAN_AI_SMOKE_SESSION_COOKIE;
  if (!imageUrl || !model || !cookie) {
    throw new Error('HUMAN_AI_SMOKE_IMAGE_URL, HUMAN_AI_SMOKE_MODEL and HUMAN_AI_SMOKE_SESSION_COOKIE are required when smoke testing.');
  }

  const smokeOrigin = process.env.HUMAN_AI_SMOKE_ORIGIN || `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const response = await fetch(`${smokeOrigin}/api/human/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      imageId: imageUrl,
      imageUrl,
      targetIds: ['face_01'],
      candidateCount: 1,
      model,
      mode: 'gpt-image-edit',
      options: { strength: 0.6, lockIdentity: true, lockHair: true, lockClothes: true, lockPose: true, lockBackground: true, protectTextLogoProduct: true },
    }),
  });
  const result = await response.json() as { taskId?: string; error?: string };
  if (!response.ok || !result.taskId) throw new Error(result.error || 'Human AI Engine smoke task was not accepted.');
  console.log(`Human AI Engine smoke task accepted: ${result.taskId}`);
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
