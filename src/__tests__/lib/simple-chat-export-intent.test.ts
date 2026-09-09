import { describe, expect, it } from 'vitest';

import {
  parseSimpleChatExportIntent,
  resolveSimpleChatExportRequestContext,
} from '@/lib/multi-platform-export/simple-chat-intent';
import type { PlatformExportPreset } from '@/lib/multi-platform-export/types';

const presets: PlatformExportPreset[] = [
  {
    id: 'instagram-post', version: 3, platform: 'instagram', usage: 'post',
    label: 'Instagram 帖子', width: 1080, height: 1080, recommendedFormat: 'jpeg',
    supportsTransparency: false, enabled: true,
  },
  {
    id: 'instagram-story', version: 2, platform: 'instagram', usage: 'story',
    label: 'Instagram 快拍', width: 1080, height: 1920, recommendedFormat: 'jpeg',
    supportsTransparency: false, enabled: true,
  },
  {
    id: 'xiaohongshu-note', version: 1, platform: 'xiaohongshu', usage: 'note',
    label: '小红书笔记', width: 1242, height: 1660, recommendedFormat: 'jpeg',
    supportsTransparency: false, enabled: true,
  },
];

describe('parseSimpleChatExportIntent', () => {
  it('normalizes an explicit batch export request from server preset identities', () => {
    expect(parseSimpleChatExportIntent(
      '把这两张图导出 Instagram 帖子和故事尺寸，完整留白',
      presets,
    )).toEqual({
      kind: 'ready',
      fit: 'contain',
      background: '#ffffffff',
      namingTemplate: '{project}-{asset}-{platform}-{size}-{index}',
      targetPresetIds: ['instagram-post-v3', 'instagram-story-v2'],
    });
  });

  it('asks for both source attachments and targets when both are absent', () => {
    expect(parseSimpleChatExportIntent('帮我批量导出平台尺寸', presets)).toMatchObject({
      kind: 'needs_clarification',
      missing: ['sources', 'targets'],
    });
  });

  it('asks only for the missing side and never invents a preset id', () => {
    expect(parseSimpleChatExportIntent('把这些图片批量导出平台尺寸', presets)).toMatchObject({
      kind: 'needs_clarification', missing: ['targets'], targetPresetIds: [],
    });
    expect(parseSimpleChatExportIntent('批量导出 Instagram 帖子尺寸', presets)).toMatchObject({
      kind: 'needs_clarification', missing: ['sources'], targetPresetIds: ['instagram-post-v3'],
    });
    expect(parseSimpleChatExportIntent('把这些图片批量导出 MySpace 尺寸', presets)).toMatchObject({
      kind: 'needs_clarification', missing: ['targets'], targetPresetIds: [],
    });
  });

  it('does not intercept ordinary chat or a request missing an explicit batch signal', () => {
    expect(parseSimpleChatExportIntent('Instagram 帖子应该怎么设计？', presets)).toEqual({ kind: 'none' });
    expect(parseSimpleChatExportIntent('导出这张图片为 Instagram 帖子尺寸', presets)).toEqual({ kind: 'none' });
  });

  it('uses only enabled presets supplied by the server and recognizes transparent output', () => {
    expect(parseSimpleChatExportIntent(
      '把这些图片批量导出小红书笔记尺寸，透明背景',
      [...presets, { ...presets[2], id: 'disabled-target', version: 9, label: '禁用目标', enabled: false }],
    )).toMatchObject({
      kind: 'ready',
      targetPresetIds: ['xiaohongshu-note-v1'],
      background: 'transparent',
    });
  });
});

describe('resolveSimpleChatExportRequestContext', () => {
  it('inherits managed source versions only from the immediately preceding export clarification', () => {
    expect(resolveSimpleChatExportRequestContext({
      messages: [{
        role: 'assistant',
        content: '请指定目标平台或尺寸。',
        retryContext: {
          sourceVersionIds: ['version-source-1'],
          canvasProjectId: 'project-1',
        },
      }],
      currentSourceVersionIds: [],
      currentAssetProjectId: '',
    })).toEqual({
      sourceVersionIds: ['version-source-1'],
      assetProjectId: 'project-1',
    });

    expect(resolveSimpleChatExportRequestContext({
      messages: [{
        role: 'assistant',
        content: '批量导出任务已提交。',
        retryContext: {
          sourceVersionIds: ['version-source-1'],
          canvasProjectId: 'project-1',
        },
      }],
      currentSourceVersionIds: [],
      currentAssetProjectId: '',
    })).toEqual({ sourceVersionIds: [], assetProjectId: '' });
  });
});
