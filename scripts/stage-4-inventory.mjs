import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
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

function unwrapExpression(expression) {
  let current = expression;
  while (
    current
    && (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function topLevelConstInitializers(sourceFile) {
  const initializers = new Map();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement)
      || !(statement.declarationList.flags & ts.NodeFlags.Const)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        initializers.set(declaration.name.text, unwrapExpression(declaration.initializer));
      }
    }
  }
  return initializers;
}

function topLevelFunctions(sourceFile) {
  const functions = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    }
  }
  return functions;
}

function stringValue(expression, constants) {
  const value = unwrapExpression(expression);
  if (value && ts.isStringLiteralLike(value)) return value.text;
  if (value && ts.isIdentifier(value)) {
    const initializer = constants.get(value.text);
    if (initializer && ts.isStringLiteralLike(initializer)) return initializer.text;
  }
  return undefined;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function directPropertyInitializer(object, propertyName) {
  const property = object.properties.find(candidate => (
    ts.isPropertyAssignment(candidate)
    && propertyNameText(candidate.name) === propertyName
  ));
  return property?.initializer;
}

function skillObjectFromElement(element) {
  const value = unwrapExpression(element);
  if (value && ts.isObjectLiteralExpression(value)) {
    return { argumentIndex: undefined, object: value };
  }
  if (!value || !ts.isCallExpression(value)) return undefined;
  const argumentIndex = value.arguments.findIndex(argument => {
    const candidate = unwrapExpression(argument);
    return candidate && ts.isObjectLiteralExpression(candidate);
  });
  if (argumentIndex < 0) return undefined;
  return {
    argumentIndex,
    object: unwrapExpression(value.arguments[argumentIndex]),
  };
}

function skillRecords(array, constants) {
  return array.elements.flatMap(element => {
    const skillObject = skillObjectFromElement(element);
    if (!skillObject) return [];
    const idInitializer = directPropertyInitializer(skillObject.object, 'id');
    if (!idInitializer) return [];
    const id = stringValue(idInitializer, constants);
    return id ? [{ ...skillObject, element: unwrapExpression(element), id }] : [];
  });
}

function objectUsesSurfaces(object, surfacesVariableName) {
  const initializer = directPropertyInitializer(object, 'allowedSurfaces');
  const value = initializer && unwrapExpression(initializer);
  return Boolean(value && ts.isIdentifier(value) && value.text === surfacesVariableName);
}

function returnedExpressions(functionLike) {
  if (ts.isArrowFunction(functionLike) && !ts.isBlock(functionLike.body)) {
    return [unwrapExpression(functionLike.body)];
  }
  const body = functionLike.body;
  if (!body || !ts.isBlock(body)) return [];
  return body.statements.flatMap(statement => (
    ts.isReturnStatement(statement) && statement.expression
      ? [unwrapExpression(statement.expression)]
      : []
  ));
}

function objectSpreadsIdentifier(object, identifierName) {
  return object.properties.some(property => {
    if (!ts.isSpreadAssignment(property)) return false;
    const spread = unwrapExpression(property.expression);
    return spread && ts.isIdentifier(spread) && spread.text === identifierName;
  });
}

function callbackNormalizesSkill(callback, surfacesVariableName) {
  const parameter = callback.parameters[0];
  if (!parameter || !ts.isIdentifier(parameter.name)) return false;
  return returnedExpressions(callback).some(returned => (
    returned
    && ts.isObjectLiteralExpression(returned)
    && objectUsesSurfaces(returned, surfacesVariableName)
    && objectSpreadsIdentifier(returned, parameter.name.text)
  ));
}

function constructionUsesSurfaces(expression, surfacesVariableName) {
  const value = unwrapExpression(expression);
  if (!value) return false;
  if (ts.isObjectLiteralExpression(value)) {
    return objectUsesSurfaces(value, surfacesVariableName);
  }
  if (
    !ts.isCallExpression(value)
    || !ts.isPropertyAccessExpression(value.expression)
    || value.expression.name.text !== 'map'
  ) {
    return false;
  }
  const callback = unwrapExpression(value.arguments[0]);
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return false;
  }
  return callbackNormalizesSkill(callback, surfacesVariableName);
}

function factoryNormalizesArgument(functionLike, argumentIndex, surfacesVariableName) {
  const parameter = functionLike.parameters[argumentIndex];
  if (!parameter || !ts.isIdentifier(parameter.name)) return false;
  return returnedExpressions(functionLike).some(returned => (
    returned
    && ts.isObjectLiteralExpression(returned)
    && objectUsesSurfaces(returned, surfacesVariableName)
    && objectSpreadsIdentifier(returned, parameter.name.text)
  ));
}

function mapNormalizesSource(expression, sourceName, surfacesVariableName) {
  const value = unwrapExpression(expression);
  if (
    !value
    || !ts.isCallExpression(value)
    || !ts.isPropertyAccessExpression(value.expression)
    || value.expression.name.text !== 'map'
  ) {
    return false;
  }
  const receiver = unwrapExpression(value.expression.expression);
  if (!receiver || !ts.isIdentifier(receiver) || receiver.text !== sourceName) return false;
  const callback = unwrapExpression(value.arguments[0]);
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return false;
  }
  return callbackNormalizesSkill(callback, surfacesVariableName);
}

function returnedArrayNormalizesSource(expression, sourceName, surfacesVariableName) {
  const value = unwrapExpression(expression);
  if (!value) return false;
  if (mapNormalizesSource(value, sourceName, surfacesVariableName)) return true;
  return ts.isArrayLiteralExpression(value)
    && value.elements.length > 0
    && value.elements.every(element => (
      ts.isSpreadElement(element)
      && returnedArrayNormalizesSource(element.expression, sourceName, surfacesVariableName)
    ));
}

function functionNormalizesArgument(functionLike, argumentIndex, surfacesVariableName) {
  const parameter = functionLike.parameters[argumentIndex];
  if (!parameter || !ts.isIdentifier(parameter.name)) return false;
  return returnedExpressions(functionLike).some(expression => (
    returnedArrayNormalizesSource(expression, parameter.name.text, surfacesVariableName)
  ));
}

function elementUsesSurfaces(record, functions, surfacesVariableName) {
  if (ts.isObjectLiteralExpression(record.element)) {
    return objectUsesSurfaces(record.element, surfacesVariableName);
  }
  if (
    record.argumentIndex === undefined
    || !ts.isCallExpression(record.element)
    || !ts.isIdentifier(record.element.expression)
  ) return false;
  const factory = functions.get(record.element.expression.text);
  return Boolean(
    factory
    && factoryNormalizesArgument(factory, record.argumentIndex, surfacesVariableName),
  );
}

function arrayConstructionUsesSurfaces(
  sourceFile,
  arrayName,
  functions,
  surfacesVariableName,
) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
      if (!initializer || !ts.isCallExpression(initializer)) continue;

      if (
        ts.isPropertyAccessExpression(initializer.expression)
        && initializer.expression.name.text === 'map'
        && ts.isIdentifier(unwrapExpression(initializer.expression.expression))
        && unwrapExpression(initializer.expression.expression).text === arrayName
        && constructionUsesSurfaces(initializer, surfacesVariableName)
      ) {
        return true;
      }

      if (
        ts.isIdentifier(initializer.expression)
        && initializer.arguments.some((argument, argumentIndex) => {
          const value = unwrapExpression(argument);
          if (!value || !ts.isIdentifier(value) || value.text !== arrayName) return false;
          const normalizer = functions.get(initializer.expression.text);
          return Boolean(
            normalizer
            && functionNormalizesArgument(normalizer, argumentIndex, surfacesVariableName),
          );
        })
      ) {
        return true;
      }
    }
  }
  return false;
}

function parseSkillSource(source, arrayName) {
  const sourceFile = ts.createSourceFile(
    'skill-inventory.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const constants = topLevelConstInitializers(sourceFile);
  const array = constants.get(arrayName);
  return {
    array: array && ts.isArrayLiteralExpression(array) ? array : undefined,
    constants,
    sourceFile,
  };
}

export function extractSkillIds(source, arrayName) {
  const { array, constants } = parseSkillSource(source, arrayName);
  if (!array) return [];
  return uniqueInOrder(skillRecords(array, constants).map(record => record.id));
}

export function extractSkillIdsForSurface(
  source,
  arrayName,
  surfacesVariableName,
  surface,
) {
  const { array, constants, sourceFile } = parseSkillSource(source, arrayName);
  if (!array) return [];
  const surfaces = constants.get(surfacesVariableName);
  if (
    !surfaces
    || !ts.isArrayLiteralExpression(surfaces)
    || !surfaces.elements.some(element => stringValue(element, constants) === surface)
  ) {
    return [];
  }

  const records = skillRecords(array, constants);
  const functions = topLevelFunctions(sourceFile);
  const boundRecords = records.filter(record => (
    elementUsesSurfaces(record, functions, surfacesVariableName)
  ));
  if (boundRecords.length > 0) {
    return uniqueInOrder(boundRecords.map(record => record.id));
  }
  return arrayConstructionUsesSurfaces(
    sourceFile,
    arrayName,
    functions,
    surfacesVariableName,
  ) ? uniqueInOrder(records.map(record => record.id)) : [];
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
    readFile(join(root, 'src/lib/skill-runtime/content-commerce-presets.ts'), 'utf8'),
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
    contentCommerceSkillsSource: files[10],
    simpleChatSkillsSource: files[11],
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
    contentCommerceSkillsSource,
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
  const contentCommerceCanvasSkills = extractSkillIdsForSurface(
    contentCommerceSkillsSource,
    'LOVART_CONTENT_COMMERCE_SKILLS',
    'surfaces',
    'canvas',
  );
  const contentCommerceWorkflowSkills = extractSkillIdsForSurface(
    contentCommerceSkillsSource,
    'LOVART_CONTENT_COMMERCE_SKILLS',
    'surfaces',
    'workflow',
  );
  const canvasSkills = uniqueInOrder([
    ...legacyCanvasSkills,
    ...marketingCanvasSkills,
    ...contentCommerceCanvasSkills,
  ]);
  const workflowSkills = uniqueInOrder([
    ...legacyWorkflowSkills,
    ...marketingWorkflowSkills,
    ...contentCommerceWorkflowSkills,
  ]);
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
