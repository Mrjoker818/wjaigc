import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8');

describe('purpose-first brand IP skill registration', () => {
  it('registers the built-in brand skill with its governance workflow and inputs', () => {
    expect(source).toContain("id: 'preset-purpose-first-ip-design'");
    expect(source).toContain("name: '品牌 IP 设计与治理系统'");
    expect(source).toContain("category: 'brand'");
    expect(source).toContain('品牌角色关卡');
    expect(source).toContain('可拥有性关卡');
    expect(source).toContain('可落地性关卡');
    expect(source).toContain('保留项 / 改变量 / 预期作用 / 验证方式 / 风险或待确认项');
    expect(source).toContain("{ name: 'brandName', label: '品牌名称'");
    expect(source).toContain("{ name: 'businessGoal', label: '业务目标'");
    expect(source).toContain("{ name: 'audienceJob', label: '受众任务'");
    expect(source).toContain("{ name: 'launchChannels', label: '首批载体与渠道'");
  });
});
