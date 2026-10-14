import type { NodeCategory, NodeType, PortType } from '@/lib/workflow-engine';

export const WORKFLOW_RENDER_NODE_COLORS: Readonly<Record<NodeCategory, string>> = {
  input: '#3b82f6',
  ai: '#d4af37',
  'ai-video': '#8b5cf6',
  logic: '#f59e0b',
  agent: '#f472b6',
  subgraph: '#06b6d4',
  output: '#2ea043',
  'video-tool': '#ff4081',
  tool: '#00897b',
};

export const WORKFLOW_RENDER_PORT_COLORS: Readonly<Record<PortType, string>> = {
  image: '#3b82f6',
  mask: '#f472b6',
  prompt: '#a78bfa',
  condition: '#f59e0b',
  any: '#7d8590',
  data: '#22d3ee',
  video: '#f97316',
  audio: '#10b981',
  frames: '#06b6d4',
  text: '#60a5fa',
  'document-reference': '#22d3ee',
};

export const WORKFLOW_RENDER_NODE_ICONS: Readonly<Record<NodeType, string>> = {
  'input-image': 'Image',
  'input-text': 'Type',
  'input-param': 'SlidersHorizontal',
  'input-video': 'FileVideo',
  'audio-input': 'Music',
  'ai-generate': 'Wand2',
  'ai-sketch-to-code': 'Pencil',
  'ai-sketch-to-image': 'Pencil',
  'ai-edit': 'Pencil',
  'ai-annotation-edit': 'MessageSquare',
  'ai-retouch': 'Wand2',
  'ai-upscale': 'Maximize',
  'ai-removebg': 'Scissors',
  'ai-vectorize': 'PenTool',
  'ai-style-transfer': 'Palette',
  'ai-color-adjust': 'Sun',
  'ai-analyze': 'ScanSearch',
  'ai-font-design': 'Type',
  'ai-refine-engine': 'Sparkles',
  'ai-human-repair': 'UserRoundCheck',
  'ai-brand-ecommerce': 'ShoppingBag',
  'ai-segment': 'Layers',
  'ai-multi-angle': 'Rotate3d',
  'ai-3d-model': 'Box',
  'ai-panorama': 'Globe',
  'ai-video-generate': 'Video',
  'ai-video-i2v': 'Video',
  'ai-llm': 'Brain',
  'ai-skill': 'Blocks',
  'ai-audio': 'Volume2',
  'video-speed-change': 'Clock',
  'video-filter': 'Filter',
  'video-concat': 'Link',
  'video-trim': 'Scissors',
  'video-extract-frames': 'Film',
  'video-compose': 'Clapperboard',
  'manual-color-adjust': 'Palette',
  'condition-if': 'GitBranch',
  'condition-switch': 'GitMerge',
  'loop-for': 'Repeat',
  'loop-while': 'RefreshCw',
  'loop-each': 'RepeatOne',
  parallel: 'Layers',
  'agent-auto': 'Bot',
  'agent-chat': 'MessageSquare',
  subgraph: 'BoxSelect',
  group: 'Group',
  'storyboard-sequence': 'Film',
  'output-image': 'ImageDown',
  'output-save': 'Save',
  'output-export': 'Download',
  'output-image-group': 'Layers',
  'output-video': 'FileVideo',
  'output-audio': 'AudioLines',
};

export function getWorkflowRenderNodeCategory(type: NodeType): NodeCategory {
  if (type.startsWith('input-')) return 'input';
  if (type === 'ai-video-generate' || type === 'ai-video-i2v') return 'ai-video';
  if (type.startsWith('ai-')) return 'ai';
  if (type.startsWith('condition-') || type.startsWith('loop-') || type === 'parallel') return 'logic';
  if (type.startsWith('agent-')) return 'agent';
  if (type === 'subgraph' || type === 'group') return 'subgraph';
  if (type.startsWith('output-')) return 'output';
  if (['video-trim', 'video-concat', 'video-filter', 'video-speed-change', 'video-compose', 'video-extract-frames'].includes(type)) return 'video-tool';
  if (['manual-color-adjust', 'ai-audio'].includes(type)) return 'tool';
  return 'ai';
}
