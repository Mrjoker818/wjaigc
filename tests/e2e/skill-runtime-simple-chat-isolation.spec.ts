import type { Page } from '@playwright/test';

import {
  ensureStage4Session,
  expect,
  openStage4ChatProject,
  seedStage4Baseline,
  stage4FixtureForProject,
  test,
  writeStage4Metrics,
} from '../helpers/stage-4-e2e';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
// The Stage 4 fixture owns a sanitized trace so Playwright must not start a second trace.
test.use({ trace: 'off', video: 'on' });

interface CatalogSkill {
  id: string;
  version: number;
  name: string;
}

async function readCatalog(page: Page, surface: 'canvas' | 'simple-chat'): Promise<CatalogSkill[]> {
  const response = await page.request.get(`/api/skills?surface=${surface}`);
  expect(response.ok(), `${surface} Skill catalog returned HTTP ${response.status()}`).toBe(true);
  const payload = await response.json() as { skills?: CatalogSkill[] };
  expect(Array.isArray(payload.skills)).toBe(true);
  return payload.skills ?? [];
}

test('独立智能对话只显示 16 项专属 Skills 且不含画布 Skills', async ({ page, stage4Evidence }, testInfo) => {
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  const auth = await ensureStage4Session(page, fixture);
  await seedStage4Baseline(page, fixture, auth);
  await openStage4ChatProject(page, String(fixture.chatProject.id));

  const [simpleChatSkills, canvasSkills] = await Promise.all([
    readCatalog(page, 'simple-chat'),
    readCatalog(page, 'canvas'),
  ]);
  const canvasIds = new Set(canvasSkills.map(skill => skill.id));
  expect(simpleChatSkills).toHaveLength(16);
  expect(simpleChatSkills.filter(skill => canvasIds.has(skill.id))).toEqual([]);

  await page.getByTitle('Skill').click();
  const renderedSkills = page.locator('[data-simple-chat-skill-id]');
  await expect(renderedSkills).toHaveCount(16);
  await expect(page.getByText('PPT大师', { exact: true })).toBeVisible();
  await expect(page.getByText('电商商品套图', { exact: true })).toHaveCount(0);
  await writeStage4Metrics(stage4Evidence, testInfo, 'simple-chat-skill-isolation', {
    simpleChat: simpleChatSkills.map(skill => `${skill.id}@${skill.version}`).sort(),
    canvasIntersection: simpleChatSkills.filter(skill => canvasIds.has(skill.id)).map(skill => skill.id),
  });
});
