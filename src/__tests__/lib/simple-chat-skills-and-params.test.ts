import { describe, expect, it } from 'vitest';
import { selectSimpleChatSkill, SIMPLE_CHAT_SKILLS } from '@/lib/simple-chat-skills';
import { fitImageParams, parseImageRequest } from '@/lib/simple-chat-image-params';
import { getProviderAspectRatios } from '@/lib/canvas-generation-group';

describe('parseImageRequest', () => {
  it('reads explicit ratios, Chinese ratio phrasing and orientation words', () => {
    expect(parseImageRequest('画一张 16:9 的城市夜景').aspectRatio).toBe('16:9');
    expect(parseImageRequest('比例 3比4 的海报').aspectRatio).toBe('3:4');
    expect(parseImageRequest('做一张竖版手机壁纸').aspectRatio).toBe('9:16');
    expect(parseImageRequest('正方形头像').aspectRatio).toBe('1:1');
  });

  it('turns pixel sizes into a reduced ratio and a resolution tier', () => {
    const parsed = parseImageRequest('尺寸 1920x1080');
    expect(parsed).toMatchObject({ aspectRatio: '16:9', resolution: '2K', width: 1920, height: 1080 });
    expect(parseImageRequest('3840×2160 的壁纸').resolution).toBe('4K');
  });

  it('reads resolution tiers and quality words', () => {
    expect(parseImageRequest('出一张 4K 的图').resolution).toBe('4K');
    expect(parseImageRequest('高清产品图').resolution).toBe('2K');
    expect(parseImageRequest('要高质量、细节丰富').quality).toBe('high');
    expect(parseImageRequest('先出个草图').quality).toBe('low');
    expect(parseImageRequest('一只猫')).toEqual({});
  });
});

describe('fitImageParams', () => {
  it('always returns a ratio the selected model supports', () => {
    const model = 'doubao-seedream-5-0-pro-260628';
    const hint = 'api_x PearAPI 图像 https://api.pearapi.ai';
    const supported = getProviderAspectRatios(model, hint);
    const fitted = fitImageParams({ aspectRatio: '21:9' }, '1:1', model, hint);
    if (supported.length > 0) expect(supported).toContain(fitted.aspectRatio);
    const kept = fitImageParams({}, '16:9', model, hint);
    if (supported.includes('16:9')) expect(kept.aspectRatio).toBe('16:9');
  });

  it('explains when a requested value had to be changed', () => {
    const model = 'doubao-seedream-5-0-pro-260628';
    const hint = 'PearAPI https://api.pearapi.ai';
    const supported = getProviderAspectRatios(model, hint);
    if (supported.length > 0 && !supported.includes('7:3')) {
      expect(fitImageParams({ aspectRatio: '7:3' }, '1:1', model, hint).notes.join('')).toContain('7:3');
    }
  });
});

describe('selectSimpleChatSkill', () => {
  it('routes requests to the matching built-in skill', () => {
    expect(selectSimpleChatSkill('帮我做一份季度汇报PPT').skill?.id).toBe('pptx');
    expect(selectSimpleChatSkill('整理成 Excel 表格').skill?.id).toBe('xlsx');
    expect(selectSimpleChatSkill('画一张海报').skill?.id).toBe('image');
    expect(selectSimpleChatSkill('用流程图说明审批过程').skill?.id).toBe('flowchart');
    expect(selectSimpleChatSkill('你好').skill).toBeNull();
  });

  it('uses the vision skill for uploaded images without another intent', () => {
    expect(selectSimpleChatSkill('这是什么', { hasImages: true }).skill?.id).toBe('vision');
  });

  it('honours slash commands and explicit choices', () => {
    const byCommand = selectSimpleChatSkill('/word 写一份请假条');
    expect(byCommand).toMatchObject({ source: 'command', text: '写一份请假条' });
    expect(byCommand.skill?.id).toBe('docx');
    expect(selectSimpleChatSkill('随便聊聊', { explicitSkillId: 'mindmap' }).skill?.id).toBe('mindmap');
  });

  it('gives every skill steps, a command and instructions', () => {
    for (const skill of SIMPLE_CHAT_SKILLS) {
      expect(skill.steps.length).toBeGreaterThan(0);
      expect(skill.command.startsWith('/')).toBe(true);
      expect(skill.instructions.length).toBeGreaterThan(10);
    }
  });
});
