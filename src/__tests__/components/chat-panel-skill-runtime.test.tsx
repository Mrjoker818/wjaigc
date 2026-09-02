import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/chat-panel.tsx'),
  'utf8',
);

describe('canvas chat shared Skill runtime wiring', () => {
  it('uses the Task 7 controls and never routes an active Skill through ordinary chat', () => {
    expect(source).toContain("import { SkillInputFields } from '@/components/skill-runtime/SkillInputFields';");
    expect(source).toContain("import { SkillRunProgress } from '@/components/skill-runtime/SkillRunProgress';");
    expect(source).toContain("import { useSkillRun } from '@/components/skill-runtime/use-skill-run';");
    expect(source).toContain('const skillRun = useSkillRun();');
    expect(source).toContain('<SkillInputFields');
    expect(source).toContain('<SkillRunProgress');
    expect(source).toContain('onClick={handleCloseSkill}');
    expect(source).toMatch(/const handleCloseSkill =[\s\S]*?skillProjectionControllerRef\.current\?\.abort\(\)[\s\S]*?skillRun\.reset\(\)/);

    const submitStart = source.indexOf('const handleSend =');
    const submitEnd = source.indexOf('const handleUseSkill =', submitStart);
    expect(submitStart).toBeGreaterThan(-1);
    expect(submitEnd).toBeGreaterThan(submitStart);
    const ordinaryChatSubmit = source.slice(submitStart, submitEnd);
    expect(ordinaryChatSubmit).not.toContain('【当前激活技能：');
    expect(ordinaryChatSubmit).not.toContain("activeSkill && ['image', 'design']");

    const saveStart = source.indexOf('const handleSaveAsSkill =');
    const saveEnd = source.indexOf('const handleDeleteSkill =', saveStart);
    expect(source.slice(saveStart, saveEnd)).toContain('messages.slice(-6)');
    expect(source.slice(saveStart, saveEnd)).toContain('createConversationCanvasSkill({');
    expect(source.slice(saveStart, saveEnd)).not.toContain('activeSkill');
    expect(source.slice(saveStart, saveEnd)).not.toContain('chat_skills');
    expect(source).toContain('await deleteCanvasSkill(skillId)');
  });

  it('starts a canvas run and only inserts authoritative completed output versions as new nodes', () => {
    expect(source).toContain("surface: 'canvas'");
    expect(source).toContain('skill.id === activeSkill.sourceSkillId && skill.builtIn');
    expect(source).toContain('skillId: executionSkill.id');
    expect(source).toContain('skillVersion: executionSkill.version');
    expect(source).toContain("roles.add('orchestrator')");
    expect(source).toContain('sourceVersionIds: skillSourceVersionIds');
    expect(source).toContain('await skillRun.estimateRun(request)');
    expect(source).toContain('await skillRun.startRun(request)');
    expect(source).toContain('loadCompletedCanvasSkillAssets');
    expect(source).toContain('projection.status !== \'completed\'');
    expect(source).toContain('projection.runId !== activeCanvasSkillRunRef.current?.runId');
    expect(source).toContain('const sourceImageId = selectedCanvasImage?.id');
    expect(source).toContain('sourceImageId: context.sourceImageId');
    expect(source).toContain('onAddGeneratedImage(reference');
    expect(source).not.toContain('onAddImages?.(skill');
    expect(source).toContain('skillProjectionCoordinatorRef.current.project({');
    expect(source).toContain('runId: context.runId');
    expect(source).toContain('sourceVersionIds: context.sourceVersionIds');
    expect(source).toContain('deleteCanvasSkillsSequentially(userSkills.map(skill => skill.id))');
  });
});
