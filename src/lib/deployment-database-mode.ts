/** Coze's production entry point opts out of filesystem credential replicas. */
export function isDeploymentDatabaseOnly(): boolean {
  return process.env.WUJIE_DEPLOYMENT_DB_ONLY === '1';
}
