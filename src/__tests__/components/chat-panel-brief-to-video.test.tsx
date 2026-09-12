import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');

describe('Canvas Brief 到视频成片 UI wiring', () => {
  it('keeps approval and finished-video UI inside Canvas Skill runtime', () => {
    expect(source).toContain("import { BriefToVideoApprovalCard } from '@/components/skill-runtime/BriefToVideoApprovalCard';");
    expect(source).toContain("import { BriefToVideoResultCard } from '@/components/skill-runtime/BriefToVideoResultCard';");
    expect(source).toContain('activeSkill.id === BRIEF_TO_VIDEO_SKILL_ID');
    expect(source).toContain('onApprove={skillRun.approve}');
    expect(source).toContain('onRevise={skillRun.revise}');
    expect(source).toContain('onCancel={skillRun.cancel}');
    expect(source).toContain('<BriefToVideoResultCard');
  });

  it('loads a video capability catalog and freezes the selected video model for the Skill', () => {
    expect(source).toContain("loadCatalog('video')");
    expect(source).toContain('discoveredVideoModels');
    expect(source).toContain("role === 'video'");
    expect(source).toContain('modelBindings.video =');
    expect(source).toContain('capabilityDescriptors={{ video: selectedVideoDescriptor }}');
    expect(source).toContain('aria-label="video 模型"');
  });
});
