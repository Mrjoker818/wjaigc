import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
const autoSaveStart = source.indexOf('// 自动保存画布图片到当前项目');
const autoSaveEnd = source.indexOf('// 页面关闭/刷新前同步保存', autoSaveStart);
const autoSaveSource = source.slice(autoSaveStart, autoSaveEnd);

describe('project autosave wiring', () => {
  it('does not reschedule itself by writing currentProject from the autosave callback', () => {
    expect(autoSaveSource).toContain('const project = currentProjectRef.current');
    expect(autoSaveSource).not.toContain('setCurrentProject(prev => prev ?');
    expect(autoSaveSource).not.toMatch(/\}, \[images, currentProject,/);
  });

  it('deduplicates unchanged project payloads before recording cloud autosaves', () => {
    expect(autoSaveSource).toContain('lastAutoSaveSignatureRef');
    expect(autoSaveSource).toContain('if (lastAutoSaveSignatureRef.current === saveSignature) return;');
  });
});
