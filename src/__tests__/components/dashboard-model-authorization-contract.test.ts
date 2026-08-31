import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as dashboardModule from '@/components/dashboard/dashboard-view';
import type { ApiProvider } from '@/lib/universal-api-types';

const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
  'utf8',
);

interface ModelOption {
  id: string;
  name: string;
  providerId: string;
}

const dashboardHelpers = dashboardModule as unknown as {
  providerModelOptions?: (
    models: string[] | undefined,
    providerId: string,
    providerName: string,
  ) => ModelOption[];
  normalizeModelAssignmentsForSave?: (
    assignments: string[],
    options: ModelOption[],
  ) => string[];
  buildDashboardModelAuthorizationOptions?: (
    providers: ApiProvider[],
  ) => {
    chatModels: ModelOption[];
    imageModels: ModelOption[];
  };
};

function provider(
  id: string,
  modelType: ApiProvider['type'],
  selectedModels: string[],
  discoveredModels: ApiProvider['discoveredModels'],
): ApiProvider {
  return {
    id,
    name: id,
    displayName: `${id} label`,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'server-secret',
    isEnabled: true,
    type: modelType,
    modelType,
    selectedModels,
    discoveredModels,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('dashboard model authorization contract', () => {
  it('mounts the existing themed toast host in the dashboard return branch', () => {
    const workspaceSource = ts.createSourceFile(
      'canvas-workspace.tsx',
      readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const workspace = workspaceSource.statements.find(
      (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node)
        && node.name?.text === 'CanvasWorkspace',
    );
    const dashboardBranch = workspace?.body?.statements.find(
      (node): node is ts.IfStatement => ts.isIfStatement(node)
        && ts.isBinaryExpression(node.expression)
        && ts.isIdentifier(node.expression.left)
        && node.expression.left.text === 'appMode'
        && ts.isStringLiteral(node.expression.right)
        && node.expression.right.text === 'dashboard',
    );
    const canvasReturn = workspace?.body?.statements.find(ts.isReturnStatement);
    const collectToastHosts = (node: ts.Node | undefined): ts.JsxSelfClosingElement[] => {
      const hosts: ts.JsxSelfClosingElement[] = [];
      const visit = (child: ts.Node): void => {
        if (ts.isJsxSelfClosingElement(child)
          && ts.isIdentifier(child.tagName) && child.tagName.text === 'Toaster') {
          hosts.push(child);
        }
        ts.forEachChild(child, visit);
      };
      if (node) visit(node);
      return hosts;
    };
    const dashboardHosts = collectToastHosts(dashboardBranch?.thenStatement);
    const canvasHosts = collectToastHosts(canvasReturn);

    expect(dashboardBranch).toBeDefined();
    expect(canvasHosts).toHaveLength(1);
    expect(dashboardHosts).toHaveLength(1);
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    expect(printer.printNode(ts.EmitHint.Unspecified, dashboardHosts[0].attributes, workspaceSource))
      .toBe(printer.printNode(ts.EmitHint.Unspecified, canvasHosts[0].attributes, workspaceSource));
  });

  it('does not silently refresh after a failed model-authorization save', () => {
    const callbackStart = dashboardSource.indexOf('onUpdateUserModels={async');
    const callbackEnd = dashboardSource.indexOf('adminChatModels=', callbackStart);
    const callbackSource = dashboardSource.slice(callbackStart, callbackEnd);

    expect(callbackStart).toBeGreaterThan(-1);
    expect(callbackSource).toContain('response.ok');
    expect(callbackSource).toContain('data.success');
    expect(callbackSource).toContain('toast.error');
    expect(callbackSource).toContain("toast.warning('模型授权已保存，但列表刷新失败')");
    expect(callbackSource.indexOf('if (!response.ok || !data.success)')).toBeLessThan(
      callbackSource.indexOf('await refreshAdmin()'),
    );
  });

  it('labels duplicate model ids with their provider while keeping exact assignment ids', () => {
    const options = dashboardHelpers.providerModelOptions?.(
      ['shared-model'],
      'provider-a',
      'Provider A',
    );

    expect(options).toEqual([{
      id: 'provider-a::shared-model',
      name: 'shared-model · Provider A',
      providerId: 'provider-a',
    }]);
  });

  it('removes a same-model legacy bare assignment when an exact provider pair is selected', () => {
    const options: ModelOption[] = [
      {
        id: 'provider-a::shared-model',
        name: 'shared-model · Provider A',
        providerId: 'provider-a',
      },
      {
        id: 'provider-b::shared-model',
        name: 'shared-model · Provider B',
        providerId: 'provider-b',
      },
    ];

    const payload = dashboardHelpers.normalizeModelAssignmentsForSave?.(
      ['shared-model', 'provider-a::shared-model', 'legacy-other', 'provider-a::shared-model'],
      options,
    );

    expect(payload).toEqual(['provider-a::shared-model', 'legacy-other']);
  });

  it('uses final effective kinds to build provider-qualified image and chat authorization options', () => {
    const providers: ApiProvider[] = [
      provider(
        'general-provider',
        'universal',
        ['flux-image-pro', 'gpt-4.1', 'qwen3-vl'],
        [
          {
            id: 'flux-image-pro',
            name: 'Flux Image Pro',
            providerId: 'general-provider',
            type: 'chat',
          },
          {
            id: 'gpt-4.1',
            name: 'GPT 4.1',
            providerId: 'general-provider',
            type: 'image',
          },
          {
            id: 'qwen3-vl',
            name: 'Qwen VLM',
            providerId: 'general-provider',
            type: 'chat',
          },
        ],
      ),
      provider('layer-provider', 'layer', ['layer-model'], [{
        id: 'layer-model',
        name: 'Layer Model',
        providerId: 'layer-provider',
        type: 'image',
      }]),
      provider('vector-provider', 'vectorize', ['vector-model'], [{
        id: 'vector-model',
        name: 'Vector Model',
        providerId: 'vector-provider',
        type: 'image',
      }]),
      provider('edit-provider', 'imageEdit', ['edit-model'], [{
        id: 'edit-model',
        name: 'Edit Model',
        providerId: 'edit-provider',
        type: 'chat',
      }]),
      provider('upscale-provider', 'upscaler', ['seedvr2-upscale'], [{
        id: 'seedvr2-upscale',
        name: 'SeedVR2',
        providerId: 'upscale-provider',
        type: 'image',
      }]),
      provider('removebg-provider', 'removebg', ['birefnet-removebg'], [{
        id: 'birefnet-removebg',
        name: 'BiRefNet',
        providerId: 'removebg-provider',
        type: 'image',
      }]),
      provider('chat-provider', 'chat', ['chat-model'], [{
        id: 'chat-model',
        name: 'Chat Model',
        providerId: 'chat-provider',
        type: 'image',
      }]),
    ];

    const options = dashboardHelpers.buildDashboardModelAuthorizationOptions?.(providers);

    expect(options?.imageModels.map(option => option.id)).toEqual([
      'general-provider::flux-image-pro',
      'layer-provider::layer-model',
      'vector-provider::vector-model',
      'edit-provider::edit-model',
      'upscale-provider::seedvr2-upscale',
      'removebg-provider::birefnet-removebg',
    ]);
    expect(options?.imageModels.map(option => option.name)).toEqual([
      'flux-image-pro · general-provider label',
      'layer-model · layer-provider label',
      'vector-model · vector-provider label',
      'edit-model · edit-provider label',
      'seedvr2-upscale · upscale-provider label',
      'birefnet-removebg · removebg-provider label',
    ]);
    expect(options?.chatModels).toEqual([
      {
        id: 'general-provider::gpt-4.1',
        name: 'gpt-4.1 · general-provider label',
        providerId: 'general-provider',
      },
      {
        id: 'general-provider::qwen3-vl',
        name: 'qwen3-vl · general-provider label',
        providerId: 'general-provider',
      },
      {
        id: 'chat-provider::chat-model',
        name: 'chat-model · chat-provider label',
        providerId: 'chat-provider',
      },
    ]);

    const payload = dashboardHelpers.normalizeModelAssignmentsForSave?.(
      ['flux-image-pro', 'general-provider::flux-image-pro', 'layer-provider::layer-model'],
      options?.imageModels || [],
    );
    expect(payload).toEqual([
      'general-provider::flux-image-pro',
      'layer-provider::layer-model',
    ]);
  });

  it('omits disabled providers from the model authorization options', () => {
    const enabledProvider = provider(
      'enabled-provider',
      'image',
      ['enabled-image'],
      [{
        id: 'enabled-image',
        name: 'Enabled Image',
        providerId: 'enabled-provider',
        type: 'image',
      }],
    );
    const disabledProvider = {
      ...provider(
        'disabled-provider',
        'image',
        ['disabled-image'],
        [{
          id: 'disabled-image',
          name: 'Disabled Image',
          providerId: 'disabled-provider',
          type: 'image',
        }],
      ),
      isEnabled: false,
    };

    const options = dashboardHelpers.buildDashboardModelAuthorizationOptions?.([
      enabledProvider,
      disabledProvider,
    ]);

    expect(options?.imageModels.map(option => option.id)).toEqual([
      'enabled-provider::enabled-image',
    ]);
  });
});
