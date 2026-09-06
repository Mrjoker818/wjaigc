import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appFileToRoute,
  discoverRepository,
  extractAgentTools,
  posixPath,
  walk,
} from './generate-function-inventory.mjs';

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueInOrder(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractLiteralApiRoutes(source) {
  return uniqueSorted(
    [...source.matchAll(/['"`](\/api\/[^'"`\s)]+)['"`]/g)].map(match => match[1]),
  );
}

function extractTaskTypes(source) {
  return uniqueSorted(
    [...source.matchAll(/registerTask\(\s*[^,]+,\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
  );
}

function extractNamedArray(source, arrayName) {
  const escapedName = arrayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`\\b(?:export\\s+)?const\\s+${escapedName}\\b[^=]*=\\s*\\[`).exec(source);
  if (!declaration) return '';

  const start = declaration.index + declaration[0].lastIndexOf('[');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return '';
}

export function extractSkillIds(source, arrayName) {
  const arraySource = extractNamedArray(source, arrayName);
  const ids = [];
  let objectDepth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < arraySource.length; index += 1) {
    const character = arraySource[index];
    const next = arraySource[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') {
      objectDepth += 1;
      continue;
    }
    if (character === '}') {
      objectDepth -= 1;
      continue;
    }
    if (
      objectDepth !== 1
      || arraySource.slice(index, index + 2) !== 'id'
      || /[A-Za-z0-9_$]/.test(arraySource[index - 1] || '')
      || /[A-Za-z0-9_$]/.test(arraySource[index + 2] || '')
    ) {
      continue;
    }

    let cursor = index + 2;
    while (/\s/.test(arraySource[cursor] || '')) cursor += 1;
    if (arraySource[cursor] !== ':') continue;
    cursor += 1;
    while (/\s/.test(arraySource[cursor] || '')) cursor += 1;

    const valueQuote = arraySource[cursor];
    if (valueQuote !== "'" && valueQuote !== '"') {
      const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(arraySource.slice(cursor))?.[0];
      if (!identifier) continue;
      const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const constant = new RegExp(
        `\\bconst\\s+${escapedIdentifier}\\s*=\\s*(['"])(.*?)\\1`,
      ).exec(source);
      if (constant?.[2]) ids.push(constant[2]);
      continue;
    }
    const valueStart = cursor + 1;
    cursor = valueStart;
    let valueEscaped = false;
    while (cursor < arraySource.length) {
      const valueCharacter = arraySource[cursor];
      if (valueEscaped) {
        valueEscaped = false;
      } else if (valueCharacter === '\\') {
        valueEscaped = true;
      } else if (valueCharacter === valueQuote) {
        ids.push(arraySource.slice(valueStart, cursor));
        index = cursor;
        break;
      }
      cursor += 1;
    }
  }

  return uniqueInOrder(ids);
}

export function extractSkillIdsForSurface(
  source,
  arrayName,
  surfacesVariableName,
  surface,
) {
  const escapedSurfacesName = surfacesVariableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`\\ballowedSurfaces\\s*:\\s*${escapedSurfacesName}\\b`).test(source)) {
    return [];
  }
  const declaredSurfaces = extractNamedArray(source, surfacesVariableName);
  const allowedSurfaces = [];
  let quote = null;
  let value = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < declaredSurfaces.length; index += 1) {
    const character = declaredSurfaces[index];
    const next = declaredSurfaces[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        value += character;
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        allowedSurfaces.push(value);
        quote = null;
        value = '';
      } else {
        value += character;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (character === "'" || character === '"') {
      quote = character;
    }
  }
  return allowedSurfaces.includes(surface) ? extractSkillIds(source, arrayName) : [];
}

function extractObjectKeys(source, exportName) {
  const match = source.match(new RegExp(`export\\s+const\\s+${exportName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!match) return [];
  return uniqueSorted(
    [...match[1].matchAll(/^\s*['"]?([a-zA-Z0-9:-]+)['"]?\s*:/gm)].map(entry => entry[1]),
  );
}

function extractWorkspaceRoutes(source) {
  const routes = extractLiteralApiRoutes(source);
  return routes;
}

function hasCoverage(testSources, patterns) {
  return patterns.some(pattern => testSources.some(source => source.includes(pattern)));
}

function deriveRisk(routes, taskTypes) {
  if (
    routes.some(route => route.startsWith('/api/workflow') || route === '/api/agent-edit')
    || taskTypes.some(type => /workflow|agent|generate|video/i.test(type))
  ) {
    return 'high';
  }
  return routes.length >= 4 || taskTypes.length >= 2 ? 'medium' : 'low';
}

function renderWorkspaceTable(workspaces) {
  return workspaces.map(workspace => `| \`${workspace.id}\` | \`${workspace.entryRoute}\` | ${
    workspace.routes.map(route => `\`${route}\``).join('<br>')
  } | ${
    workspace.taskTypes.map(taskType => `\`${taskType}\``).join('<br>')
  } | ${
    workspace.assetInputs.join('<br>')
  } | ${
    workspace.assetOutputs.join('<br>')
  } | ${workspace.hasAutomatedCoverage ? 'yes' : 'no'} | ${workspace.risk} |`).join('\n');
}

function renderStage4InventoryMarkdown(inventory) {
  return `# Stage 4 Inventory

- Generated at: ${inventory.generatedAt}
- Root: \`${inventory.root}\`
- Workspaces: ${inventory.workspaces.length}
- Node types: ${inventory.nodeTypes.length}
- Port types: ${inventory.portTypes.length}
- Agent tools: ${inventory.agentTools.length}
- Skills: ${inventory.skills.length}
- Canvas Skills: ${inventory.skillCatalogs.canvas.length}
- Workflow Skills: ${inventory.skillCatalogs.workflow.length}
- Simple Chat Skills: ${inventory.skillCatalogs.simpleChat.length}
- Routes: ${inventory.routes.length}

## Workspaces

| Workspace | Entry | Routes | Task types | Asset inputs | Asset outputs | Tested | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
${renderWorkspaceTable(inventory.workspaces)}

## Agent tools

${inventory.agentTools.map(tool => `- \`${tool}\``).join('\n')}

## Skills

${inventory.skills.map(skill => `- \`${skill}\``).join('\n')}

## Node types

${inventory.nodeTypes.map(nodeType => `- \`${nodeType}\``).join('\n')}

## Port types

${inventory.portTypes.map(portType => `- \`${portType}\``).join('\n')}

## Routes

${inventory.routes.map(route => `- \`${route}\``).join('\n')}
`;
}

async function collectWorkspaceSources(root) {
  const files = await Promise.all([
    readFile(join(root, 'src/app/page.tsx'), 'utf8'),
    readFile(join(root, 'src/components/canvas-workspace.tsx'), 'utf8'),
    readFile(join(root, 'src/components/infinite-canvas.tsx'), 'utf8'),
    readFile(join(root, 'src/components/node-editor.tsx'), 'utf8'),
    readFile(join(root, 'src/app/simple-chat/page.tsx'), 'utf8'),
    readFile(join(root, 'src/components/chat-panel.tsx'), 'utf8'),
    readFile(join(root, 'src/lib/agent-engine.ts'), 'utf8'),
    readFile(join(root, 'src/lib/workflow-engine.ts'), 'utf8'),
    readFile(join(root, 'src/lib/skill-runtime/canvas-presets.ts'), 'utf8'),
    readFile(join(root, 'src/lib/skill-runtime/marketing-presets.ts'), 'utf8'),
    readFile(join(root, 'src/lib/skill-runtime/simple-chat-presets.ts'), 'utf8'),
  ]);

  return {
    homePageSource: files[0],
    canvasWorkspaceSource: files[1],
    canvasSource: files[2],
    nodeEditorSource: files[3],
    simpleChatPageSource: files[4],
    chatPanelSource: files[5],
    agentSource: files[6],
    workflowSource: files[7],
    canvasSkillsSource: files[8],
    marketingSkillsSource: files[9],
    simpleChatSkillsSource: files[10],
  };
}

export async function collectStage4Inventory(root = process.cwd()) {
  const repository = await discoverRepository(root);
  const {
    homePageSource,
    canvasWorkspaceSource,
    canvasSource,
    nodeEditorSource,
    simpleChatPageSource,
    chatPanelSource,
    agentSource,
    workflowSource,
    canvasSkillsSource,
    marketingSkillsSource,
    simpleChatSkillsSource,
  } = await collectWorkspaceSources(root);

  const testFiles = await walk(
    join(root, 'src', '__tests__'),
    file => ['.ts', '.tsx'].includes(file.slice(file.lastIndexOf('.'))),
  );
  const extraTestFiles = await walk(
    join(root, 'tests'),
    file => ['.ts', '.tsx'].includes(file.slice(file.lastIndexOf('.'))),
  );
  const testSources = await Promise.all(
    [...testFiles, ...extraTestFiles].map(file => readFile(file, 'utf8')),
  );

  const routeSet = uniqueSorted([
    ...repository.apiRoutes.map(route => route.route),
    ...extractWorkspaceRoutes(canvasSource),
    ...extractWorkspaceRoutes(nodeEditorSource),
    ...extractWorkspaceRoutes(chatPanelSource),
    ...extractWorkspaceRoutes(workflowSource),
  ]);

  const taskTypes = uniqueSorted(
    extractTaskTypes(agentSource).concat(
      extractTaskTypes(await readFile(join(root, 'src/lib/task-registry.ts'), 'utf8')),
      extractTaskTypes(await readFile(join(root, 'src/app/api/agent-edit/route.ts'), 'utf8')),
      extractTaskTypes(await readFile(join(root, 'src/app/api/generate/route.ts'), 'utf8')),
      extractTaskTypes(await readFile(join(root, 'src/app/api/workflow/execute/route.ts'), 'utf8')),
    ),
  );

  const nodeTypes = extractObjectKeys(workflowSource, 'NODE_TYPE_LABELS');
  const portTypes = extractObjectKeys(workflowSource, 'PORT_COMPATIBILITY');
  const legacyCanvasSkills = extractSkillIdsForSurface(
    canvasSkillsSource,
    'RAW_CANVAS_PRESET_SKILLS',
    'canvasSurfaces',
    'canvas',
  );
  const legacyWorkflowSkills = extractSkillIdsForSurface(
    canvasSkillsSource,
    'RAW_CANVAS_PRESET_SKILLS',
    'canvasSurfaces',
    'workflow',
  );
  const marketingCanvasSkills = extractSkillIdsForSurface(
    marketingSkillsSource,
    'LOVART_MARKETING_SKILLS',
    'surfaces',
    'canvas',
  );
  const marketingWorkflowSkills = extractSkillIdsForSurface(
    marketingSkillsSource,
    'LOVART_MARKETING_SKILLS',
    'surfaces',
    'workflow',
  );
  const canvasSkills = uniqueInOrder([...legacyCanvasSkills, ...marketingCanvasSkills]);
  const workflowSkills = uniqueInOrder([...legacyWorkflowSkills, ...marketingWorkflowSkills]);
  const simpleChatSkills = extractSkillIdsForSurface(
    simpleChatSkillsSource,
    'RAW_SIMPLE_CHAT_PRESET_SKILLS',
    'simpleChatSurfaces',
    'simple-chat',
  );
  const skillCatalogs = {
    canvas: canvasSkills,
    workflow: workflowSkills,
    simpleChat: simpleChatSkills,
  };
  const skills = uniqueSorted([...canvasSkills, ...simpleChatSkills]);
  const agentTools = extractAgentTools(agentSource);

  const workspaces = [
    {
      id: 'canvas',
      name: 'Canvas workspace',
      entryRoute: '/',
      entryFile: 'src/app/page.tsx',
      entrypoints: ['loginMode=canvas', 'default login panel'],
      components: uniqueSorted([
        'src/app/page.tsx',
        'src/components/canvas-workspace.tsx',
        'src/components/infinite-canvas.tsx',
        'src/components/generation-panel.tsx',
        'src/components/chat-panel.tsx',
      ]),
      routes: uniqueSorted([
        ...extractWorkspaceRoutes(homePageSource),
        ...extractWorkspaceRoutes(canvasWorkspaceSource),
        ...extractWorkspaceRoutes(canvasSource),
      ]),
      taskTypes: taskTypes.filter(type => /generate|image|agent|edit|video|svg|refine/i.test(type)),
      assetInputs: ['canvas images', 'uploads', 'chat bridge references'],
      assetOutputs: ['canvas placements', 'saved uploads', 'task artifacts'],
      hasAutomatedCoverage: hasCoverage(testSources, [
        'openCanvasProject',
        'data-canvas-viewport',
        'stage-3-canvas-kernel',
        'stage-2-cross-workspace',
      ]),
      risk: 'high',
    },
    {
      id: 'workflow',
      name: 'Workflow workspace',
      entryRoute: '/?projectId=<project>',
      entryFile: 'src/components/node-editor.tsx',
      entrypoints: ['canvas toolbar 节点模式', 'workflow metadata restore'],
      components: uniqueSorted([
        'src/components/canvas-workspace.tsx',
        'src/components/node-editor.tsx',
        'src/lib/workflow-engine.ts',
      ]),
      routes: uniqueSorted([
        '/api/workflow/execute',
        '/api/workflow/models',
        '/api/workflow/save',
        '/api/workflow/ai-build',
        ...extractWorkspaceRoutes(nodeEditorSource),
        ...extractWorkspaceRoutes(workflowSource),
      ]),
      taskTypes: taskTypes.filter(type => /workflow|generate|agent/i.test(type)),
      assetInputs: ['project metadata workflow', 'canvas image references', 'prompt inputs'],
      assetOutputs: ['workflow execution outputs', 'canvas transfers', 'saved workflow records'],
      hasAutomatedCoverage: hasCoverage(testSources, [
        '执行工作流',
        'workflow',
        'project workflow restoration',
        'stage-2-cross-workspace',
      ]),
      risk: deriveRisk(
        ['/api/workflow/execute', '/api/workflow/ai-build', '/api/chat'],
        taskTypes.filter(type => /workflow|agent|generate/i.test(type)),
      ),
    },
    {
      id: 'simple-chat',
      name: 'Standalone simple chat',
      entryRoute: '/simple-chat',
      entryFile: 'src/app/simple-chat/page.tsx',
      entrypoints: ['mode switch to chat', 'projectId query parameter'],
      components: uniqueSorted([
        'src/app/simple-chat/page.tsx',
        'src/components/simple-chat/sidebar.tsx',
        'src/components/simple-chat/chat-area.tsx',
        'src/components/simple-chat/simple-chat-types.ts',
      ]),
      routes: uniqueSorted([
        ...extractWorkspaceRoutes(simpleChatPageSource),
        ...extractWorkspaceRoutes(chatPanelSource),
        '/api/simple-chat/chat',
        '/api/simple-chat/share',
        '/api/simple-chat/upload-file',
        '/api/user-data/sync',
      ]),
      taskTypes: uniqueSorted([
        ...taskTypes.filter(type => /chat|agent/i.test(type)),
        'simple-chat-message',
        'simple-chat-share',
      ]),
      assetInputs: ['chat attachments', 'workspace asset references', 'knowledge items'],
      assetOutputs: ['chat messages', 'shared links', 'registered image refs'],
      hasAutomatedCoverage: hasCoverage(testSources, [
        '/api/simple-chat/chat',
        'simple-chat',
        'standalone-chat',
      ]),
      risk: 'medium',
    },
  ].map(workspace => ({
    ...workspace,
    routes: uniqueSorted(workspace.routes),
    taskTypes: uniqueSorted(workspace.taskTypes),
    components: uniqueSorted(workspace.components),
  }));

  return {
    root: posixPath(resolve(root)),
    generatedAt: new Date().toISOString(),
    workspaces,
    nodeTypes,
    portTypes,
    routes: routeSet,
    agentTools,
    skills,
    skillCatalogs,
    taskTypes,
  };
}

async function writeStage4InventoryArtifacts(root, inventory) {
  const outputRoot = join(root, 'test-results', 'stage-4-baseline', 'inventory');
  const jsonPath = join(outputRoot, 'stage-4-inventory.json');
  const markdownPath = join(outputRoot, 'stage-4-inventory.md');
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderStage4InventoryMarkdown(inventory), 'utf8');
  return { jsonPath, markdownPath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = process.cwd();
  const inventory = await collectStage4Inventory(root);
  const artifacts = await writeStage4InventoryArtifacts(root, inventory);
  process.stdout.write(`${JSON.stringify({
    routes: inventory.routes.length,
    workspaces: inventory.workspaces.length,
    nodeTypes: inventory.nodeTypes.length,
    portTypes: inventory.portTypes.length,
    jsonPath: posixPath(artifacts.jsonPath),
    markdownPath: posixPath(artifacts.markdownPath),
  }, null, 2)}\n`);
}
