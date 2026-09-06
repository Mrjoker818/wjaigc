'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

import { parseSkillDatasetFile } from './dataset-file-parser';
import { SKILL_INPUT_LIMITS } from '@/lib/skill-runtime/input-resolver';
import type { SkillInputField } from '@/lib/skill-runtime/types';

const FORBIDDEN_DATASET_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

interface SkillInputFieldsProps {
  fields: readonly SkillInputField[];
  values: Record<string, unknown>;
  errors?: Readonly<Record<string, string | undefined>>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringListValue(value: unknown): string {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') : '';
}

function datasetValue(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return JSON.stringify(value, null, 2);
}

function effectiveValue(field: SkillInputField, values: Record<string, unknown>): unknown {
  return values[field.key] ?? field.defaultValue;
}

function structuredDrafts(
  fields: readonly SkillInputField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const field of fields) {
    const value = effectiveValue(field, values);
    if (field.kind === 'images') drafts[field.key] = stringListValue(value);
    if (field.kind === 'dataset') drafts[field.key] = datasetValue(value);
  }
  return drafts;
}

function fieldDefinitionSignature(fields: readonly SkillInputField[]): string {
  return JSON.stringify(fields);
}

function assertDatasetKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertDatasetKeys(item);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_DATASET_KEYS.has(key)) {
      throw new Error(`数据集不能包含保留键 ${key}`);
    }
    assertDatasetKeys(nested);
  }
}

function serializedBytes(values: Record<string, unknown>): number {
  try {
    return new TextEncoder().encode(JSON.stringify(values)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function SkillInputFields({
  fields,
  values,
  errors = {},
  onChange,
  disabled = false,
}: SkillInputFieldsProps): React.ReactElement {
  const instanceId = useId();
  const initialDrafts = structuredDrafts(fields, values);
  const definitionSignature = fieldDefinitionSignature(fields);
  const [drafts, setDrafts] = useState<Record<string, string>>(initialDrafts);
  const [localErrors, setLocalErrors] = useState<Record<string, string | undefined>>({});
  const previousDefinitionSignature = useRef(definitionSignature);
  const previousExternalDrafts = useRef(initialDrafts);
  const emittedDefaults = useRef<Record<string, string>>({});

  useEffect(() => {
    const nextExternalDrafts = structuredDrafts(fields, values);
    const definitionChanged = previousDefinitionSignature.current !== definitionSignature;
    const synchronizedKeys = new Set<string>();
    for (const [key, draft] of Object.entries(nextExternalDrafts)) {
      if (definitionChanged || previousExternalDrafts.current[key] !== draft) {
        synchronizedKeys.add(key);
      }
    }
    setDrafts(current => {
      const next: Record<string, string> = {};
      for (const [key, draft] of Object.entries(nextExternalDrafts)) {
        next[key] = synchronizedKeys.has(key) ? draft : (current[key] ?? draft);
      }
      return next;
    });
    if (definitionChanged) {
      setLocalErrors({});
    } else if (synchronizedKeys.size > 0) {
      setLocalErrors(current => {
        const next = { ...current };
        for (const key of synchronizedKeys) next[key] = undefined;
        return next;
      });
    }
    previousDefinitionSignature.current = definitionSignature;
    previousExternalDrafts.current = nextExternalDrafts;
  }, [definitionSignature, fields, values]);

  useEffect(() => {
    const declaredKeys = new Set(fields.map(field => field.key));
    for (const key of Object.keys(emittedDefaults.current)) {
      if (!declaredKeys.has(key)) delete emittedDefaults.current[key];
    }
    for (const field of fields) {
      if (values[field.key] != null || field.defaultValue === undefined) {
        delete emittedDefaults.current[field.key];
        continue;
      }
      const fingerprint = JSON.stringify([field.kind, field.defaultValue]);
      if (emittedDefaults.current[field.key] === fingerprint) continue;
      emittedDefaults.current[field.key] = fingerprint;
      onChange(field.key, field.defaultValue);
    }
  }, [fields, onChange, values]);

  const commitValue = (field: SkillInputField, value: unknown): boolean => {
    if (serializedBytes({ ...values, [field.key]: value }) > SKILL_INPUT_LIMITS.serialized) {
      setLocalErrors(current => ({ ...current, [field.key]: '输入内容超过 512 KiB' }));
      return false;
    }
    setLocalErrors(current => ({ ...current, [field.key]: undefined }));
    onChange(field.key, value);
    return true;
  };

  const updateStructuredValue = (
    field: SkillInputField,
    draft: string,
    parse: () => unknown,
  ): void => {
    setDrafts(current => ({ ...current, [field.key]: draft }));
    try {
      const value = parse();
      commitValue(field, value);
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith('数据集')
        ? error.message
        : error instanceof Error && error.message.startsWith('最多允许')
          ? error.message
          : '请输入有效的 JSON 数组';
      setLocalErrors(current => ({
        ...current,
        [field.key]: message,
      }));
    }
  };

  return (
    <div className="space-y-3">
      {fields.map(field => {
        const value = effectiveValue(field, values);
        const inputId = `${instanceId}-${field.key}`;
        const hintId = `${inputId}-hint`;
        const errorId = `${inputId}-error`;
        const error = errors[field.key] || localErrors[field.key];
        const describedBy = [field.kind === 'images' ? hintId : '', error ? errorId : '']
          .filter(Boolean)
          .join(' ') || undefined;
        const common = {
          id: inputId,
          'aria-label': field.label,
          disabled,
          required: field.required,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          className: 'w-full rounded border px-2 py-1.5 text-sm',
        } as const;

        let control: React.ReactNode;
        switch (field.kind) {
          case 'text':
            control = (
              <textarea
                {...common}
                maxLength={SKILL_INPUT_LIMITS.text}
                value={textValue(value)}
                onChange={event => commitValue(field, event.target.value)}
              />
            );
            break;
          case 'image':
          case 'brand-kit':
            control = (
              <input
                {...common}
                type="text"
                maxLength={SKILL_INPUT_LIMITS.text}
                value={textValue(value)}
                onChange={event => commitValue(field, event.target.value)}
              />
            );
            break;
          case 'images': {
            const maximum = Math.min(
              field.maximumItems ?? SKILL_INPUT_LIMITS.images,
              SKILL_INPUT_LIMITS.images,
            );
            if (field.bindToSourceVersions) {
              const selectedCount = Array.isArray(value)
                ? value.filter(item => typeof item === 'string' && item.length > 0).length
                : 0;
              control = (
                <div
                  id={inputId}
                  role="status"
                  aria-label={field.label}
                  aria-describedby={describedBy}
                  className="rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                >
                  {selectedCount > 0
                    ? `已选择 ${selectedCount} 张来源图片`
                    : '尚未选择来源图片'}
                </div>
              );
              break;
            }
            control = (
              <>
                <textarea
                  {...common}
                  value={drafts[field.key] ?? stringListValue(value)}
                  onChange={event => {
                    const draft = event.target.value;
                    setDrafts(current => ({ ...current, [field.key]: draft }));
                    const items = draft.split(/[\n,]/u).map(item => item.trim()).filter(Boolean);
                    if (items.length > maximum) {
                      setLocalErrors(current => ({
                        ...current,
                        [field.key]: `最多允许 ${maximum} 项`,
                      }));
                      return;
                    }
                    commitValue(field, items);
                  }}
                />
                <div id={hintId} className="text-xs text-muted-foreground">最多 {maximum} 项</div>
              </>
            );
            break;
          }
          case 'dataset':
            control = (
              <div className="space-y-2">
                <textarea
                  {...common}
                  value={drafts[field.key] ?? datasetValue(value)}
                  onChange={event => updateStructuredValue(field, event.target.value, () => {
                    const parsed: unknown = JSON.parse(event.target.value || '[]');
                    if (!Array.isArray(parsed)) throw new Error('请输入有效的 JSON 数组');
                    const maximum = Math.min(
                      field.maximumItems ?? SKILL_INPUT_LIMITS.datasetRows,
                      SKILL_INPUT_LIMITS.datasetRows,
                    );
                    if (parsed.length > maximum) throw new Error(`最多允许 ${maximum} 行`);
                    if (parsed.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
                      throw new Error('数据集每一行必须是对象');
                    }
                    assertDatasetKeys(parsed);
                    return parsed;
                  })}
                />
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Upload aria-hidden="true" size={14} />
                  导入 CSV/JSON
                  <input
                    type="file"
                    accept=".csv,.json"
                    aria-label={`导入 ${field.label}`}
                    className="sr-only"
                    disabled={disabled}
                    onChange={async event => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      try {
                        const rows = await parseSkillDatasetFile(file);
                        const maximum = Math.min(
                          field.maximumItems ?? SKILL_INPUT_LIMITS.datasetRows,
                          SKILL_INPUT_LIMITS.datasetRows,
                        );
                        if (rows.length > maximum) throw new Error(`最多允许 ${maximum} 行`);
                        if (commitValue(field, rows)) {
                          setDrafts(current => ({
                            ...current,
                            [field.key]: JSON.stringify(rows, null, 2),
                          }));
                        }
                      } catch (caught) {
                        setLocalErrors(current => ({
                          ...current,
                          [field.key]: caught instanceof Error ? caught.message : '数据集文件解析失败',
                        }));
                      }
                    }}
                  />
                </label>
                {Array.isArray(value) && value.length > 0 && (() => {
                  const rows = value.filter(row => row && typeof row === 'object' && !Array.isArray(row))
                    .slice(0, 5) as Record<string, unknown>[];
                  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 8);
                  return (
                    <div className="max-w-full overflow-x-auto rounded border" aria-label={`${field.label}预览`}>
                      <div className="px-2 py-1 text-xs text-muted-foreground">共 {value.length} 行，预览前 {rows.length} 行</div>
                      <table className="min-w-full text-left text-xs">
                        <thead><tr>{columns.map(column => <th className="border-t px-2 py-1 font-medium" key={column}>{column}</th>)}</tr></thead>
                        <tbody>{rows.map((row, index) => (
                          <tr key={index}>{columns.map(column => (
                            <td className="max-w-48 truncate border-t px-2 py-1" key={column}>{String(row[column] ?? '')}</td>
                          ))}</tr>
                        ))}</tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            );
            break;
          case 'select':
            control = (
              <select
                {...common}
                value={textValue(value)}
                onChange={event => commitValue(field, event.target.value)}
              >
                {!field.required && <option value="">请选择</option>}
                {(field.options || []).map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            );
            break;
          case 'multi-select': {
            const selected = Array.isArray(value)
              ? value.filter(item => typeof item === 'string')
              : [];
            const maximum = field.maximumItems ?? SKILL_INPUT_LIMITS.images;
            const atLimit = selected.length >= maximum;
            control = (
              <fieldset
                id={inputId}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                className="space-y-1"
              >
                <legend className="text-sm font-medium">
                  {field.label}
                  {field.required && <span aria-hidden="true"> *</span>}
                </legend>
                {(field.options || []).map(option => {
                  const checked = selected.includes(option);
                  return (
                    <label key={option} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || (atLimit && !checked)}
                        onChange={() => commitValue(field, checked
                          ? selected.filter(item => item !== option)
                          : [...selected, option])}
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </fieldset>
            );
            break;
          }
          case 'number':
            control = (
              <input
                {...common}
                type="number"
                value={typeof value === 'number' ? String(value) : ''}
                onChange={event => {
                  if (event.target.value === '') {
                    commitValue(field, undefined);
                    return;
                  }
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) {
                    setLocalErrors(current => ({ ...current, [field.key]: '请输入有限数字' }));
                    return;
                  }
                  commitValue(field, value);
                }}
              />
            );
            break;
          case 'boolean':
            control = (
              <input
                id={inputId}
                type="checkbox"
                disabled={disabled}
                checked={value === true}
                aria-label={field.label}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                onChange={event => commitValue(field, event.target.checked)}
              />
            );
            break;
        }

        return (
          <div key={field.key} className="space-y-1">
            {field.kind !== 'multi-select' && (
              <label htmlFor={inputId} className="block text-sm font-medium">
                {field.label}
                {field.required && <span aria-hidden="true"> *</span>}
              </label>
            )}
            {control}
            {error && <div id={errorId} role="alert" className="text-xs text-destructive">{error}</div>}
          </div>
        );
      })}
    </div>
  );
}
