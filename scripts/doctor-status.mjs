export function getDoctorExitCode({
  blockedCount,
  failedCount,
  production,
}) {
  return failedCount > 0 || (production && blockedCount > 0) ? 1 : 0;
}
