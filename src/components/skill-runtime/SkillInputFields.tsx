'use client';

import { useEffect, useId, useMemo, useState } from 'react';

import { SKILL_INPUT_LIMITS } from '@/lib/skill-runtime/input-resolver';
import type { SkillInputField } from '@/lib/skill-runtime/types';

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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [localErrors, setLocalErrors] = useState<Record<string, string | undefined>>({});
  const synchronizedDrafts = useMemo(() => {
    const nextDrafts: Record<string, string> = {};
    for (const field of fields) {
      if (field.kind === 'images') nextDrafts[field.key] = stringListValue(values[field.key]);
      if (field.kind === 'dataset') nextDrafts[field.key] = datasetValue(values[field.key]);
    }
    return nextDrafts;
  }, [fields, values]);

  useEffect(() => {
    setDrafts(synchronizedDrafts);
    setLocalErrors({});
  }, [synchronizedDrafts]);

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
                value={textValue(values[field.key])}
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
                value={textValue(values[field.key])}
                onChange={event => commitValue(field, event.target.value)}
              />
            );
            break;
          case 'images': {
            const maximum = Math.min(
              field.maximumItems ?? SKILL_INPUT_LIMITS.images,
              SKILL_INPUT_LIMITS.images,
            );
            control = (
              <>
                <textarea
                  {...common}
                  value={drafts[field.key] ?? stringListValue(values[field.key])}
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
              <textarea
                {...common}
                value={drafts[field.key] ?? datasetValue(values[field.key])}
                onChange={event => updateStructuredValue(field, event.target.value, () => {
                  const parsed: unknown = JSON.parse(event.target.value || '[]');
                  if (!Array.isArray(parsed)) throw new Error('请输入有效的 JSON 数组');
                  if (parsed.length > SKILL_INPUT_LIMITS.datasetRows) {
                    throw new Error(`最多允许 ${SKILL_INPUT_LIMITS.datasetRows} 行`);
                  }
                  if (parsed.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
                    throw new Error('数据集每一行必须是对象');
                  }
                  return parsed;
                })}
              />
            );
            break;
          case 'select':
            control = (
              <select
                {...common}
                value={textValue(values[field.key] ?? field.defaultValue)}
                onChange={event => commitValue(field, event.target.value)}
              >
                {!field.required && <option value="">请选择</option>}
                {(field.options || []).map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            );
            break;
          case 'number':
            control = (
              <input
                {...common}
                type="number"
                value={typeof values[field.key] === 'number' ? String(values[field.key]) : ''}
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
                checked={values[field.key] === true}
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
            <label htmlFor={inputId} className="block text-sm font-medium">
              {field.label}
              {field.required && <span aria-hidden="true"> *</span>}
            </label>
            {control}
            {error && <div id={errorId} role="alert" className="text-xs text-destructive">{error}</div>}
          </div>
        );
      })}
    </div>
  );
}
