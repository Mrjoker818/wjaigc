import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');

describe('canvas multi-platform export drawer wiring', () => {
  it('renders the dedicated bottom drawer only for the canvas export Skill', () => {
    expect(source).toContain("import { MultiPlatformExportDrawer } from '@/components/skill-runtime/MultiPlatformExportDrawer';");
    expect(source).toContain('activeSkill?.id === MULTI_PLATFORM_EXPORT_SKILL_ID');
    expect(source).toContain('<MultiPlatformExportDrawer');
    expect(source).toContain('sourceAssetVersionIds={canvasSkillSourceVersionIds}');
    expect(source).toContain('projection={skillRun.projection}');
    expect(source).toContain('onCancel={() => { void skillRun.cancel(); }}');
    expect(source).toContain("onRetry={() => { void skillRun.retry('export'); }}");
  });

  it('keeps the generic Skill controls intact for every other canvas Skill', () => {
    expect(source).toContain('<SkillInputFields');
    expect(source).toContain('<SkillRunProgress');
    expect(source).toContain('activeSkill.id !== MULTI_PLATFORM_EXPORT_SKILL_ID');
    expect(source).toContain('onClick={handleCloseSkill}');
  });

  it('adds exported images through authoritative existing AssetVersions without starting another export', () => {
    expect(source).toContain('onAddExportImagesToCanvas');
    expect(source).toContain('receiveSkillOutput(reference');
    expect(source).not.toContain('reExportResult');
  });
});
