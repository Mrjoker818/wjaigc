export type SelectedModelsStorageKind = 'jsonb' | 'text-array';

interface ProviderColumnMetadata {
  column_name?: unknown;
  data_type?: unknown;
  udt_name?: unknown;
}

export function resolveSelectedModelsStorageKind(
  rows: ProviderColumnMetadata[],
): SelectedModelsStorageKind {
  const column = rows.find(row => String(row.column_name || '').toLowerCase() === 'selected_models');
  const dataType = String(column?.data_type || '').toLowerCase();
  const udtName = String(column?.udt_name || '').toLowerCase();
  return dataType === 'jsonb' || udtName === 'jsonb' ? 'jsonb' : 'text-array';
}

export function encodeSelectedModelsForStorage(
  models: string[],
  kind: SelectedModelsStorageKind,
): string[] | string {
  return kind === 'jsonb' ? JSON.stringify(models) : models;
}
