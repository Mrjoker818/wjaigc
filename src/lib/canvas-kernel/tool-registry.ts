export type CanvasToolEntryPoint =
  | 'bottom-toolbar'
  | 'image-toolbar'
  | 'context-menu'
  | 'shortcut'
  | 'canvas'
  | 'workspace-panel'
  | 'upload';

export type CanvasToolSessionKind =
  | 'command'
  | 'image-edit'
  | 'annotation'
  | 'generation'
  | 'group'
  | 'export'
  | 'video'
  | 'three-d'
  | 'specialized'
  | 'refine';

export type CanvasToolPanelPlacement =
  | 'none'
  | 'floating'
  | 'bottom-drawer'
  | 'canvas-overlay';

export interface CanvasToolSessionContext {
  projectId: string | null;
  sourceImageIds: readonly string[];
  entryPoint: CanvasToolEntryPoint;
}

export interface CanvasToolSession {
  toolId: string | null;
  featureId: string | null;
  projectId: string | null;
  sourceImageIds: readonly string[];
  status: 'closed' | 'open';
  sessionKind: CanvasToolSessionKind | null;
  panelPlacement: CanvasToolPanelPlacement;
  entryPoint: CanvasToolEntryPoint | null;
}

export interface CanvasToolDefinition {
  featureId: string;
  id: string;
  capability: string;
  entryPoints: readonly CanvasToolEntryPoint[];
  requiresSelection: boolean;
  sessionKind: CanvasToolSessionKind;
  panelPlacement: CanvasToolPanelPlacement;
  open: (
    current: CanvasToolSession,
    context: CanvasToolSessionContext,
  ) => CanvasToolSession;
  close: () => CanvasToolSession;
}

export const CLOSED_CANVAS_TOOL_SESSION: CanvasToolSession = Object.freeze({
  toolId: null,
  featureId: null,
  projectId: null,
  sourceImageIds: Object.freeze([]) as readonly string[],
  status: 'closed',
  sessionKind: null,
  panelPlacement: 'none',
  entryPoint: null,
});

type ToolSeed = Omit<CanvasToolDefinition, 'open' | 'close'>;

function createTool(seed: ToolSeed): CanvasToolDefinition {
  const definition: CanvasToolDefinition = {
    ...seed,
    open: (_current, context) => {
      if (!definition.entryPoints.includes(context.entryPoint)) {
        throw new Error(`CANVAS_TOOL_ENTRY_POINT_UNSUPPORTED:${definition.id}:${context.entryPoint}`);
      }
      const sourceImageIds = [...new Set(context.sourceImageIds.filter(Boolean))];
      if (definition.requiresSelection && sourceImageIds.length === 0) {
        throw new Error(`CANVAS_TOOL_SELECTION_REQUIRED:${definition.id}`);
      }
      return {
        toolId: definition.id,
        featureId: definition.featureId,
        projectId: context.projectId,
        sourceImageIds,
        status: 'open',
        sessionKind: definition.sessionKind,
        panelPlacement: definition.panelPlacement,
        entryPoint: context.entryPoint,
      };
    },
    close: () => CLOSED_CANVAS_TOOL_SESSION,
  };
  return Object.freeze(definition);
}

const tool = (
  featureId: string,
  id: string,
  capability: string,
  entryPoints: readonly CanvasToolEntryPoint[],
  sessionKind: CanvasToolSessionKind,
  panelPlacement: CanvasToolPanelPlacement,
  requiresSelection = false,
): CanvasToolDefinition => createTool({
  featureId,
  id,
  capability,
  entryPoints,
  requiresSelection,
  sessionKind,
  panelPlacement,
});

const core = 'workspace.canvas.core';
const upload = 'workspace.canvas.upload';
const generate = 'workspace.canvas.generate';
const groups = 'workspace.canvas.reference-groups';
const imageTools = 'workspace.canvas.image-tools';
const annotation = 'workspace.canvas.annotation';
const layers = 'workspace.canvas.layers-history-export';
const video = 'workspace.canvas.video';
const threeD = 'workspace.canvas.three-d';
const specialized = 'workspace.canvas.specialized-tools';
const refine = 'workspace.canvas.refine';

const definitions: readonly CanvasToolDefinition[] = Object.freeze([
  tool(core, 'select', '选择', ['bottom-toolbar', 'shortcut', 'canvas'], 'command', 'none'),
  tool(core, 'multi-select', '多选', ['shortcut', 'canvas'], 'command', 'none'),
  tool(core, 'move', '移动', ['canvas'], 'command', 'none', true),
  tool(core, 'resize', '缩放', ['canvas'], 'command', 'none', true),
  tool(core, 'pan', '平移', ['bottom-toolbar', 'shortcut', 'canvas'], 'command', 'none'),
  tool(core, 'delete', '删除', ['image-toolbar', 'context-menu', 'shortcut'], 'command', 'none', true),
  tool(core, 'copy', '复制', ['context-menu', 'shortcut'], 'command', 'none', true),
  tool(core, 'undo', '撤销', ['bottom-toolbar', 'shortcut'], 'command', 'none'),
  tool(core, 'redo', '重做', ['bottom-toolbar', 'shortcut'], 'command', 'none'),
  tool(core, 'reset-view', '重置视图', ['bottom-toolbar', 'context-menu'], 'command', 'none'),

  tool(upload, 'upload-click', '点击上传', ['bottom-toolbar', 'upload'], 'command', 'none'),
  tool(upload, 'upload-drop', '拖入上传', ['canvas', 'upload'], 'command', 'none'),
  tool(upload, 'upload-paste', '粘贴图片', ['shortcut', 'upload'], 'command', 'none'),
  tool(upload, 'persist-media', '持久化媒体', ['canvas'], 'command', 'none'),

  tool(generate, 'generate-model', '选择模型', ['workspace-panel', 'bottom-toolbar'], 'generation', 'bottom-drawer'),
  tool(generate, 'generate-ratio', '选择比例', ['workspace-panel', 'bottom-toolbar'], 'generation', 'bottom-drawer'),
  tool(generate, 'generate-quality', '选择质量', ['workspace-panel', 'bottom-toolbar'], 'generation', 'bottom-drawer'),
  tool(generate, 'generate-count', '设置数量', ['workspace-panel', 'bottom-toolbar'], 'generation', 'bottom-drawer'),
  tool(generate, 'canvas-generator', '提交生成', ['bottom-toolbar', 'workspace-panel'], 'generation', 'floating'),
  tool(generate, 'generation-progressive-result', '逐张回填', ['canvas'], 'generation', 'canvas-overlay'),
  tool(generate, 'generation-cancel', '取消', ['canvas', 'workspace-panel'], 'generation', 'canvas-overlay'),

  tool(groups, 'group-create', '创建组', ['context-menu', 'shortcut'], 'group', 'canvas-overlay', true),
  tool(groups, 'group-move', '拖动组', ['canvas'], 'group', 'canvas-overlay', true),
  tool(groups, 'group-collapse', '折叠', ['canvas'], 'group', 'canvas-overlay'),
  tool(groups, 'group-close', '关闭', ['canvas'], 'group', 'canvas-overlay'),
  tool(groups, 'reference-analyze', '识别参考图', ['canvas'], 'group', 'canvas-overlay', true),
  tool(groups, 'reference-generate', '按参考语义生成', ['canvas'], 'group', 'canvas-overlay', true),
  tool(groups, 'fusion-generate', '融图生成', ['canvas'], 'group', 'canvas-overlay', true),

  tool(imageTools, 'upscale', '放大', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'remove-bg', '移除背景', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'svg-trace', 'SVG智能描摹', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'element-decompose', '元素拆解', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'erase', '擦除', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'mask', '蒙版', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'color-adjust', '调色', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'edit-elements', '编辑元素', ['image-toolbar', 'context-menu'], 'image-edit', 'floating', true),
  tool(imageTools, 'multi-angle', '多角度', ['image-toolbar', 'context-menu'], 'image-edit', 'canvas-overlay', true),
  tool(imageTools, 'expand', '扩展', ['image-toolbar', 'context-menu'], 'image-edit', 'canvas-overlay', true),
  tool(imageTools, 'crop', '裁切', ['image-toolbar', 'context-menu'], 'image-edit', 'canvas-overlay', true),
  tool(imageTools, 'download', '下载', ['image-toolbar', 'context-menu'], 'export', 'floating', true),

  tool(annotation, 'chatcanvas', '点选', ['bottom-toolbar', 'shortcut'], 'annotation', 'canvas-overlay'),
  tool(annotation, 'annotation-region', '框选', ['bottom-toolbar', 'shortcut'], 'annotation', 'canvas-overlay'),
  tool(annotation, 'annotation-brush', '画笔圈选', ['bottom-toolbar', 'shortcut'], 'annotation', 'canvas-overlay'),
  tool(annotation, 'annotation-instruction', '输入修改要求', ['bottom-toolbar'], 'annotation', 'floating'),
  tool(annotation, 'annotation-submit', '提交批注', ['bottom-toolbar'], 'annotation', 'floating'),
  tool(annotation, 'annotation-progress', '查看进度', ['bottom-toolbar'], 'annotation', 'floating'),

  tool(layers, 'layer-order', '调整层级', ['bottom-toolbar', 'context-menu'], 'command', 'floating'),
  tool(layers, 'version-history', '查看版本', ['bottom-toolbar'], 'command', 'floating'),
  tool(layers, 'version-restore', '恢复版本', ['bottom-toolbar'], 'command', 'floating'),
  tool(layers, 'export-png', '导出 PNG', ['image-toolbar', 'context-menu'], 'export', 'floating', true),
  tool(layers, 'export-svg', '导出 SVG', ['image-toolbar', 'context-menu'], 'export', 'floating', true),
  tool(layers, 'export-psd', '导出 PSD', ['image-toolbar', 'context-menu'], 'export', 'floating', true),
  tool(layers, 'export-project', '下载项目', ['bottom-toolbar', 'context-menu'], 'export', 'floating'),

  tool(video, 'video-text-generate', '文生视频', ['bottom-toolbar', 'workspace-panel'], 'video', 'floating'),
  tool(video, 'video-image-generate', '图生视频', ['image-toolbar', 'context-menu'], 'video', 'floating', true),
  tool(video, 'video-extend', '延长视频', ['image-toolbar', 'context-menu'], 'video', 'floating', true),
  tool(video, 'video-extract', '抽帧', ['image-toolbar', 'context-menu'], 'video', 'floating', true),
  tool(video, 'video-dub', '配音', ['image-toolbar', 'context-menu'], 'video', 'floating', true),
  tool(video, 'video-compress', '压缩', ['image-toolbar', 'context-menu'], 'video', 'floating', true),
  tool(video, 'video-download', '下载', ['image-toolbar', 'context-menu'], 'video', 'floating', true),

  tool(threeD, 'three-d-single', '单图转3D', ['bottom-toolbar', 'image-toolbar', 'context-menu', 'shortcut'], 'three-d', 'floating'),
  tool(threeD, 'three-d-multi', '多图转3D', ['bottom-toolbar', 'context-menu'], 'three-d', 'floating'),
  tool(threeD, 'three-d-text', '文生3D', ['bottom-toolbar'], 'three-d', 'floating'),
  tool(threeD, 'three-d-multi-angle', '多角度生成', ['image-toolbar', 'context-menu'], 'three-d', 'floating', true),
  tool(threeD, 'three-d-preview', '预览', ['image-toolbar', 'context-menu'], 'three-d', 'floating', true),
  tool(threeD, 'three-d-download', '下载', ['image-toolbar', 'context-menu'], 'three-d', 'floating', true),

  tool(specialized, 'brand-ecommerce', '品牌电商', ['bottom-toolbar', 'shortcut'], 'specialized', 'floating'),
  tool(specialized, 'brand-ip', '品牌IP', ['bottom-toolbar', 'shortcut'], 'specialized', 'floating'),
  tool(specialized, 'logo-pro', 'Logo Pro', ['bottom-toolbar'], 'specialized', 'floating'),
  tool(specialized, 'packaging-pro', '包装Pro', ['bottom-toolbar'], 'specialized', 'floating'),
  tool(specialized, 'display-pro', '展陈Pro', ['bottom-toolbar'], 'specialized', 'floating'),
  tool(specialized, 'effect-reverse', '效果图反拆', ['bottom-toolbar', 'image-toolbar'], 'specialized', 'bottom-drawer'),
  tool(specialized, 'font-design', '字境大师', ['bottom-toolbar', 'shortcut'], 'specialized', 'floating'),
  tool(specialized, 'vector-design', 'AI矢量设计', ['bottom-toolbar'], 'specialized', 'floating'),
  tool(specialized, 'ai-psd', 'AI PSD', ['bottom-toolbar', 'image-toolbar'], 'specialized', 'floating'),
  tool(specialized, 'sticker-assistant', '表情助手', ['bottom-toolbar'], 'specialized', 'floating'),
  tool(specialized, 'hexcube', '六面体', ['bottom-toolbar'], 'specialized', 'canvas-overlay'),
  tool(specialized, 'agent', 'Agent编排', ['bottom-toolbar', 'image-toolbar', 'context-menu', 'shortcut'], 'specialized', 'floating'),
  tool(specialized, 'brand-factory', '品牌工厂', ['bottom-toolbar', 'shortcut'], 'specialized', 'floating'),
  tool(specialized, 'scene-studio', '3D构图画布 Pro', ['bottom-toolbar'], 'specialized', 'floating'),
  tool(specialized, 'aspect-recompose', '横竖重组', ['image-toolbar', 'context-menu'], 'specialized', 'floating', true),
  tool(specialized, 'image-compare', '图片对比', ['image-toolbar', 'context-menu'], 'specialized', 'floating', true),

  tool(refine, 'product-refine', '产品精修', ['bottom-toolbar', 'image-toolbar', 'context-menu', 'shortcut'], 'refine', 'floating'),
  tool(refine, 'human-refine', '人物精修', ['bottom-toolbar', 'image-toolbar', 'context-menu', 'shortcut'], 'refine', 'floating'),
  tool(refine, 'face-repair', '人脸修复', ['bottom-toolbar', 'image-toolbar'], 'refine', 'floating'),
  tool(refine, 'hand-repair', '手部修复', ['bottom-toolbar', 'image-toolbar'], 'refine', 'floating'),
  tool(refine, 'three-d-view', '三维视角', ['bottom-toolbar', 'image-toolbar'], 'refine', 'floating'),
]);

class CanvasToolRegistry {
  readonly definitions = definitions;
  private readonly byId = new Map(definitions.map(definition => [definition.id, definition]));

  get(toolId: string): CanvasToolDefinition | undefined {
    return this.byId.get(toolId);
  }

  featureIds(): string[] {
    return [...new Set(this.definitions.map(definition => definition.featureId))];
  }

  capabilities(featureId: string): string[] {
    return this.definitions
      .filter(definition => definition.featureId === featureId)
      .map(definition => definition.capability);
  }

  duplicates(): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const definition of this.definitions) {
      if (seen.has(definition.id)) duplicates.add(definition.id);
      seen.add(definition.id);
    }
    return [...duplicates];
  }
}

export const canvasToolRegistry = new CanvasToolRegistry();

export function openCanvasToolSession(
  current: CanvasToolSession,
  toolId: string,
  context: CanvasToolSessionContext,
): CanvasToolSession {
  const definition = canvasToolRegistry.get(toolId);
  if (!definition) throw new Error(`CANVAS_TOOL_NOT_REGISTERED:${toolId}`);
  return definition.open(current, context);
}

export function closeCanvasToolSession(
  session: CanvasToolSession,
): CanvasToolSession {
  const definition = session.toolId ? canvasToolRegistry.get(session.toolId) : undefined;
  return definition?.close() ?? CLOSED_CANVAS_TOOL_SESSION;
}

export type CanvasToolSessionEvent =
  | { type: 'escape' }
  | { type: 'external-pointer' }
  | { type: 'project-change'; projectId: string | null }
  | { type: 'images-change'; imageIds: readonly string[] };

export function reconcileCanvasToolSession(
  session: CanvasToolSession,
  event: CanvasToolSessionEvent,
): CanvasToolSession {
  if (session.status === 'closed') return session;
  if (event.type === 'escape' || event.type === 'external-pointer') {
    return closeCanvasToolSession(session);
  }
  if (event.type === 'project-change') {
    return session.projectId !== event.projectId
      ? closeCanvasToolSession(session)
      : session;
  }
  if (session.sourceImageIds.length === 0) return session;
  const availableIds = new Set(event.imageIds);
  return session.sourceImageIds.every(imageId => availableIds.has(imageId))
    ? session
    : closeCanvasToolSession(session);
}
