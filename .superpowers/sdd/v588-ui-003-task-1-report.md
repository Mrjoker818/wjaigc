# V588-UI-003 Task 1 Report

## Status

RED gate established. Production `CanvasMinimap` remains absent.

## Changed Files

- `src/__tests__/components/canvas-minimap.test.tsx`
- `src/__tests__/components/canvas-minimap-wiring.test.ts`
- `src/__tests__/components/canvas-zoom-cluster.test.tsx`

No production files were created or modified. The supplied task brief remains uncommitted.

## Exact RED Command

```powershell
pnpm exec vitest run src/__tests__/components/canvas-minimap.test.tsx src/__tests__/components/canvas-minimap-wiring.test.ts src/__tests__/components/canvas-zoom-cluster.test.tsx
```

## Exact RED Output

The command exited with code `1` and produced:

```text
Test Files  3 failed (3)
Tests  3 failed | 1 passed (4)

FAIL  src/__tests__/components/canvas-minimap.test.tsx
Error: Failed to resolve import "@/components/canvas/CanvasMinimap" from "src/__tests__/components/canvas-minimap.test.tsx". Does the file exist?
Plugin: vite:import-analysis

FAIL  src/__tests__/components/canvas-minimap-wiring.test.ts > V588-UI-003 canvas minimap wiring > requires the minimap leaf and parent/tool-cluster wiring contract
AssertionError: expected false to be true // Object.is equality
src/__tests__/components/canvas-minimap-wiring.test.ts:11:39
expect(existsSync(componentPath)).toBe(true)

FAIL  src/__tests__/components/canvas-zoom-cluster.test.tsx > CanvasZoomCluster > preserves every current auxiliary-toolbar command and zoom readout
AssertionError: expected ... to contain 'title="打开小地图"'

FAIL  src/__tests__/components/canvas-zoom-cluster.test.tsx > CanvasZoomCluster > projects active panel state and generation progress without owning controller state
AssertionError: expected ... to contain 'title="关闭小地图"'

PASS  src/__tests__/components/canvas-zoom-cluster.test.tsx > CanvasZoomCluster > hides the minimap command when the viewport is unavailable
```

The final run reported `Start at 16:28:01` and `Duration 3.25s (transform 73ms, setup 0ms, collect 222ms, tests 72ms, environment 1.54s, prepare 546ms)`.

## Why This Failure Is Expected

The first failure is the required missing-production import. The wiring test then fails at its required first existence assertion because `src/components/canvas/CanvasMinimap.tsx` is intentionally absent. The existing `CanvasZoomCluster` also lacks the new minimap props and rendered command, so the new RED assertions fail at the missing behavior. Vitest starts normally, resolves the existing component test, and executes one existing test successfully; there is no syntax, environment, or unrelated-history failure.

## Self-Review

- Confirmed only the three specified test files are in commit `d1fe9d6`.
- Confirmed the minimap component path does not exist.
- Confirmed the fixed viewport values, 300 rectangles, 100 samples, and `8ms` p95 threshold are present verbatim.
- Confirmed availability thresholds, preference fail-closed behavior, geometry filtering, aspect-ratio/inverse-projection expectations, interaction isolation, theme/empty/close coverage, wiring strings, and legacy toolbar assertions are covered.
- Ran `git diff --cached --check` before commit with no whitespace errors.
- Avoided `jest-dom`-specific matchers because this repository has no registered `jest-dom` setup.

## Concerns

- Geometry/component interaction tests cannot execute until the production component and its fixed exported interface are implemented in the next task.
- The focused command is intentionally red by design; it is not a passing regression suite for this task.
+
## 控制器复审修订（2026-08-22）

### 精确 RED 命令

```powershell
pnpm exec vitest run src/__tests__/components/canvas-minimap.test.tsx src/__tests__/components/canvas-minimap-wiring.test.ts src/__tests__/components/canvas-zoom-cluster.test.tsx
```

### 精确 RED 输出

```text
RUN  v3.2.4 J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release

 ❯ src/__tests__/components/canvas-zoom-cluster.test.tsx (3 tests | 2 failed) 51ms
   × CanvasZoomCluster > preserves every current auxiliary-toolbar command and zoom readout 29ms
     → expected '<div class="w-px h-5 ml-1.5 separator…' to contain 'title="打开小地图"'
   × CanvasZoomCluster > projects active panel state and generation progress without owning controller state 15ms
     → expected '<div class="w-px h-5 ml-1.5 separator…' to contain 'title="关闭小地图"'
   ✓ CanvasZoomCluster > hides the minimap command when the viewport is unavailable 6ms
 ❯ src/__tests__/components/canvas-minimap-wiring.test.ts (1 test | 1 failed) 11ms
   × V588-UI-003 canvas minimap wiring > requires the fixed leaf API and parent-owned minimap visibility contract 9ms
     → expected false to be true // Object.is equality

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/components/canvas-minimap.test.tsx [ src/__tests__/components/canvas-minimap.test.tsx ]
Error: Failed to resolve import "@/components/canvas/CanvasMinimap" from "src/__tests__/components/canvas-minimap.test.tsx". Does the file exist?
  Plugin: vite:import-analysis
  File: J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/src/__tests__/components/canvas-minimap.test.tsx:15:7
  11 |    readCanvasMinimapPreference,
  12 |    writeCanvasMinimapPreference
  13 |  } from "@/components/canvas/CanvasMinimap";
     |          ^
  14 |  const viewport = {
  15 |    width: 1e3,
 ❯ TransformPluginContext._formatLog ../../../../../%E6%97%A0%E7%95%8C%E6%9C%AC%E5%9C%B0%E7%89%88/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/node_modules/vite/dist/node/chunks/config.js:29079:43
 ❯ TransformPluginContext.error ../../../../../%E6%97%A0%E7%95%8C%E6%9C%AC%E5%9C%B0%E7%89%88/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/node_modules/vite/dist/node/chunks/config.js:29076:14
 ❯ normalizeUrl ../../../../../%E6%97%A0%E7%95%8C%E6%9C%AC%E5%9C%B0%E7%89%88/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/node_modules/vite/dist/node/chunks/config.js:27199:18
 ❯ ../../../../../%E6%97%A0%E7%95%8C%E6%9C%AC%E5%9C%B0%E7%89%88/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/node_modules/vite/dist/node/chunks/config.js:27257:32
 ❯ TransformPluginContext.transform ../../../../../%E6%97%A0%E7%95%8C%E6%9C%AC%E5%9C%B0%E7%89%88/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/node_modules/vite/dist/node/chunks/config.js:27225:4
 ❯ EnvironmentPluginContainer.transform ../../../../../%E6%97%A0%E7%95%8C%E6%9C%AC%E5%9C%B0%E7%89%88/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/node_modules/vite/dist/node/chunks/config.js:28877:14
 ❯ loadAndTransform ../../../../../%E6%97%A0%E7%95%8C%E6%9C%AC%E5%9C%B0%E7%89%88/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release/node_modules/vite/dist/node/chunks/config.js:22746:26

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/components/canvas-minimap-wiring.test.ts > V588-UI-003 canvas minimap wiring > requires the fixed leaf API and parent-owned minimap visibility contract
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ src/__tests__/components/canvas-minimap-wiring.test.ts:11:39
      9| describe('V588-UI-003 canvas minimap wiring', () => {
     10|   it('requires the fixed leaf API and parent-owned minimap visibility …
     11|     expect(existsSync(componentPath)).toBe(true);
       |                                       ^
     12|
     13|     const component = readFileSync(componentPath, 'utf8');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  src/__tests__/components/canvas-zoom-cluster.test.tsx > CanvasZoomCluster > preserves every current auxiliary-toolbar command and zoom readout
AssertionError: expected '<div class="w-px h-5 ml-1.5 separator…' to contain 'title="打开小地图"'

Expected: "title="打开小地图""
Received: "<div class="w-px h-5 ml-1.5 separator-theme"></div><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="缩小画布"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-out h-3.5 w-3.5 zoom-out-theme"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">缩小</span></button><span class="text-xs font-mono w-10 text-center select-none shrink-0 text-gold">125%</span><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="放大画布"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-in h-3.5 w-3.5 zoom-in-theme"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line><line x1="11" x2="11" y1="8" y2="14"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">放大</span></button><div class="w-px h-5 mx-1 separator-theme shrink-0"></div><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="重置视图"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-maximize2 h-4 w-4"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" x2="14" y1="3" y2="10"></line><line x1="3" x2="10" y1="21" y2="14"></line></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">重置视图</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="命令面板 (Ctrl+K / Cmd+K)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-command h-4 w-4"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">命令面板 Ctrl+K</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="网格: 点阵"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-grip h-4 w-4"><circle cx="12" cy="5" r="1"></circle><circle cx="19" cy="5" r="1"></circle><circle cx="5" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle><circle cx="19" cy="19" r="1"></circle><circle cx="5" cy="19" r="1"></circle></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">点阵</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-gold-light hover:bg-gold/10" title="显示连线"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-git-merge h-4 w-4"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">显示连线</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-gold-light hover:bg-gold/10" title="打开图层"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layers h-4 w-4"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">图层面板</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-gold-light hover:bg-gold/10" title="版本历史"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-git-branch h-4 w-4"><line x1="6" x2="6" y1="3" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">版本历史</span></button><div class="w-px h-5 mx-1 separator-theme shrink-0"></div><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="AI 引擎设置 (放大/去背景/SVG/分层)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings h-4 w-4"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">AI引擎设置</span></button>"

 ❯ src/__tests__/components/canvas-zoom-cluster.test.tsx:49:20
     47|     expect(markup).toContain('title="打开图层"');
     48|     expect(markup).toContain('title="版本历史"');
     49|     expect(markup).toContain('title="打开小地图"');
       |                    ^
     50|     expect(markup).toContain('title="AI 引擎设置 (放大/去背景/SVG/分层)"');
     51|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  src/__tests__/components/canvas-zoom-cluster.test.tsx > CanvasZoomCluster > projects active panel state and generation progress without owning controller state
AssertionError: expected '<div class="w-px h-5 ml-1.5 separator…' to contain 'title="关闭小地图"'

Expected: "title="关闭小地图""
Received: "<div class="w-px h-5 ml-1.5 separator-theme"></div><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="缩小画布"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-out h-3.5 w-3.5 zoom-out-theme"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">缩小</span></button><span class="text-xs font-mono w-10 text-center select-none shrink-0 text-gold">125%</span><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="放大画布"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-in h-3.5 w-3.5 zoom-in-theme"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line><line x1="11" x2="11" y1="8" y2="14"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">放大</span></button><div class="w-px h-5 mx-1 separator-theme shrink-0"></div><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="重置视图"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-maximize2 h-4 w-4"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" x2="14" y1="3" y2="10"></line><line x1="3" x2="10" y1="21" y2="14"></line></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">重置视图</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="命令面板 (Ctrl+K / Cmd+K)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-command h-4 w-4"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">命令面板 Ctrl+K</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="网格: 点阵"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-grip h-4 w-4"><circle cx="12" cy="5" r="1"></circle><circle cx="19" cy="5" r="1"></circle><circle cx="5" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle><circle cx="19" cy="19" r="1"></circle><circle cx="5" cy="19" r="1"></circle></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">点阵</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-gold-light hover:bg-gold/10" title="显示连线"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-git-merge h-4 w-4"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">显示连线</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-gold-light hover:bg-gold/10" title="打开图层"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layers h-4 w-4"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">图层面板</span></button><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-gold-light hover:bg-gold/10" title="版本历史"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-git-branch h-4 w-4"><line x1="6" x2="6" y1="3" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">版本历史</span></button><div class="w-px h-5 mx-1 separator-theme shrink-0"></div><button type="button" class="p-2 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transform-none motion-reduce:transition-none relative group hover:scale-110 active:scale-95 whitespace-nowrap shrink-0 text-gold-muted hover:text-text-bright hover:bg-white/10" title="AI 引擎设置 (放大/去背景/SVG/分层)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings h-4 w-4"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none z-[60] bg-black/90 text-white">AI引擎设置</span></button>"

 ❯ src/__tests__/components/canvas-zoom-cluster.test.tsx:65:50
     63|     expect(markup).toContain('title="关闭图层"');
     64|     expect(markup).toContain('title="关闭版本历史"');
     65|     expect(renderCluster({ minimapOpen: true })).toContain('title="关闭小…
       |                                                  ^
     66|     expect(markup).toContain('width:50%');
     67|     expect(markup).toContain('生成中');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  3 failed (3)
      Tests  3 failed | 1 passed (4)
   Start at  16:36:50
   Duration  3.28s (transform 71ms, setup 0ms, collect 222ms, tests 61ms, environment 1.56s, prepare 516ms)
```

### 本次自审

- 偏好键断言为唯一的 `wujie.canvas.minimap.open.v1`，并通过写入和读取使用同一精确键名。
- 测试只使用 Task 2 的固定 API：边界、投影、场景函数，以及 `CanvasMinimap(items, viewport, theme?, rightOffset, onNavigate, onClose)` 契约；未保留 `open` 或 `onCanvasClick`。
- 地图点击测试模拟 `canvas-minimap-map` 的 `getBoundingClientRect`，验证传给 `onNavigate` 的世界坐标是投影的反变换，并验证指针、滚轮和点击不会冒泡到父画布。
- 接线测试要求父画布在 `!minimapOpen || !minimapAvailable` 时立即返回空 `minimapItems`，并以 `minimapOpen && minimapAvailable` 条件渲染叶组件，保证关闭或不可用状态不做地图几何工作。
- 渲染测试断言暗色和单色输出、无 `img`、无任何 `src` 属性以及未调用 `fetch`；响应式边界覆盖宽度 768/767 和可用宽度 560/559。
- 退化投影与场景坐标均断言有限；保留 300 项、100 次采样和 p95 不超过 8ms 的性能门槛；现有工具簇命令断言未删除。

### 本次关注点

- 由于 Task 2 的生产组件仍不存在，几何、交互、主题和性能测试在模块解析阶段无法执行；这是本任务预期的唯一阻塞项。
- 父画布和工具簇尚未接入小地图，因此对应 RED 断言也保持失败，供 Task 2/3 转绿时使用。

## V588-UI-003 Task 1 RED Contract Fixes (2026-08-22)

### Changed Files

- `src/__tests__/components/canvas-minimap.test.tsx` — changed the empty-state assertion to the exact Task 2 copy `暂无画布内容`.
- `src/__tests__/components/canvas-minimap-wiring.test.ts` — replaced the unconstrained `toggle-minimap` presence check with a source regex requiring the entry to be inside `...(minimapAvailable ? [{ id: 'toggle-minimap', ...`.
- `.superpowers/sdd/v588-ui-003-task-1-report.md` — appended this verification record.

No production files were created or modified. No push was performed.

### Exact RED Command

```powershell
pnpm exec vitest run src/__tests__/components/canvas-minimap.test.tsx src/__tests__/components/canvas-minimap-wiring.test.ts src/__tests__/components/canvas-zoom-cluster.test.tsx
```

### Exact RED Output

```text
EXIT_CODE=1

 RUN  v3.2.4 J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s4-release

 ❯ src/__tests__/components/canvas-zoom-cluster.test.tsx (3 tests | 2 failed)
   × CanvasZoomCluster > preserves every current auxiliary-toolbar command and zoom readout
     → expected ... to contain 'title="打开小地图"'
   × CanvasZoomCluster > projects active panel state and generation progress without owning controller state
     → expected ... to contain 'title="关闭小地图"'
   ✓ CanvasZoomCluster > hides the minimap command when the viewport is unavailable
 ❯ src/__tests__/components/canvas-minimap-wiring.test.ts (1 test | 1 failed)
   × V588-UI-003 canvas minimap wiring > requires the fixed leaf API and parent-owned minimap visibility contract
     → expected false to be true // Object.is equality

 FAIL  src/__tests__/components/canvas-minimap.test.tsx
 Error: Failed to resolve import "@/components/canvas/CanvasMinimap" from "src/__tests__/components/canvas-minimap.test.tsx". Does the file exist?

 FAIL  src/__tests__/components/canvas-minimap-wiring.test.ts
 AssertionError: expected false to be true // Object.is equality
 at src/__tests__/components/canvas-minimap-wiring.test.ts:11:39
   expect(existsSync(componentPath)).toBe(true)

 Test Files  3 failed (3)
 Tests  3 failed | 1 passed (4)
 Start at 16:43:46
 Duration 3.22s (transform 71ms, setup 0ms, collect 222ms, tests 59ms, environment 1.54s, prepare 500ms)
```

### Self-Review

- Confirmed the empty-state assertion is the exact `暂无画布内容` string.
- Confirmed the wiring contract requires `minimapAvailable` in the conditional spread immediately before the `toggle-minimap` command object; a standalone `id` occurrence cannot satisfy it.
- Confirmed the focused run remains RED only on absent production minimap behavior/wiring: missing `CanvasMinimap` import/component, missing open/close toolbar titles, and the expected first existence assertion.
- Confirmed no production files changed and no unrelated tests or APIs were edited.
- Confirmed the working tree diff contains only the two requested test changes plus this report append; unrelated pre-existing untracked artifacts were left untouched.

### Concerns

- The component test cannot execute until Task 2 adds `src/components/canvas/CanvasMinimap.tsx`.
- The toolbar and parent wiring failures remain intentionally reserved for the production implementation tasks.
