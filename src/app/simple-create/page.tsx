import { SimpleCreateApp } from '@/components/simple-create/simple-create-page';

export default async function SimpleCreateRoute({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const params = await searchParams;
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] || '' : params.projectId || '';
  return <SimpleCreateApp initialProjectId={projectId} />;
}
