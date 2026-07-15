/**
 * 参考资产语义绑定（兼容导出）
 * 基于 Seedance 2.0 Skill OS 的参考角色设计
 */

export type {
  VideoReferenceRole as ReferenceRole,
  VideoReferenceBinding as ReferenceBinding,
} from './prompt-compiler';
export {
  REFERENCE_ROLE_LABEL as REFERENCE_ROLE_LABELS,
  REFERENCE_ROLE_COLOR as REFERENCE_ROLE_DESCRIPTIONS,
  classifyReferenceByHint as classifyVideoReferenceType,
  classifyReferenceByHint,
  REFERENCE_ROLE_LABEL,
  REFERENCE_ROLE_COLOR,
} from './prompt-compiler';

import type { VideoReferenceBinding } from './prompt-compiler';
import { REFERENCE_ROLE_LABEL } from './prompt-compiler';

type ExtendedVideoReferenceBinding = VideoReferenceBinding & {
  assetUrl?: string;
  assetType?: string;
  type?: string;
};

export function buildReferenceTagSection(refs: VideoReferenceBinding[]): string {
  if (!refs || refs.length === 0) return '';
  const lines: string[] = [];
  const grouped: Record<string, VideoReferenceBinding[]> = {};
  for (const r of refs) {
    const reference = r as ExtendedVideoReferenceBinding;
    if (!grouped[r.role]) grouped[r.role] = [];
    grouped[r.role].push(r);
    if (!reference.assetUrl && !reference.url) {
      // skip refs without url
    }
  }
  for (const role of Object.keys(grouped)) {
    const label = (REFERENCE_ROLE_LABEL as Record<string, string>)[role] || role;
    const urls = grouped[role]
      .map(r => {
        const reference = r as ExtendedVideoReferenceBinding;
        const url = reference.assetUrl || reference.url || '';
        const type = reference.assetType || reference.type || '';
        return type === 'video' ? `[video]${url}` : url;
      })
      .filter(Boolean)
      .join('; ');
    if (urls) lines.push(`- ${label}参考: ${urls}`);
  }
  return lines.length ? lines.join('\n') : '';
}
