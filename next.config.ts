import path from 'path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { NextConfig } from 'next';

export function resolveBuildId(directory: string): string {
  const options = {
    cwd: directory,
    encoding: 'utf8' as const,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
  };

  try {
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], options).trim();
    const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim();
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(tree) && !changes) {
      return tree;
    }
  } catch {
    // A source checkout without Git metadata cannot attest a committed tree.
  }

  return `unverified-${randomBytes(16).toString('hex')}`;
}

const LOCAL_BUILD_ARTIFACT_EXCLUDES = [
  '.tmp/**/*',
  '.playwright-cli/**/*',
  'output/**/*',
  'test-results/**/*',
  'playwright-report/**/*',
];

const nextConfig: NextConfig = {
  generateBuildId: () => resolveBuildId(__dirname),
  turbopack: {
    resolveAlias: {
      // 浏览器内的直接/传递 Yjs 引用必须使用同一入口。
      yjs: { browser: './node_modules/yjs/dist/yjs.cjs' },
    },
  },
  outputFileTracingRoot: path.resolve(__dirname),
  outputFileTracingExcludes: {
    '*': LOCAL_BUILD_ARTIFACT_EXCLUDES,
    instrumentation: LOCAL_BUILD_ARTIFACT_EXCLUDES,
  },
  serverExternalPackages: [
    'yjs',
    'wasm_vtracer',
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
    '@langchain/core',
    '@langchain/openai',
    'coze-coding-dev-sdk',
    'dotenv',
    // P0 fix: native .node binaries must not be bundled by webpack
    '@napi-rs/canvas',
  ],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // P1 fix: 基础安全响应头
          // 移除 X-Frame-Options，改用 CSP frame-ancestors 允许预览面板嵌入
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 权限策略：关闭不需要的高危浏览器 API（保留 camera/microphone 供画布工具使用）
          { key: 'Permissions-Policy', value: 'geolocation=(), payment=()' },
          // 宽松 CSP：允许 Next.js 正常运行（unsafe-inline/unsafe-eval）同时阻断最高危注入
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.cn https://fonts.googleapis.com",
              "img-src * data: blob:",
              "media-src * blob:",
              "connect-src * ws: wss:",
              "font-src 'self' data: https://fonts.gstatic.cn https://fonts.gstatic.com",
              "worker-src 'self' blob:",
              "frame-src 'self' blob: https://*.dev.coze.site",
              "frame-ancestors 'self' https://*.dev.coze.site https://*.coze.cn https://code.coze.cn",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, yjs: require.resolve('yjs') };
    }
    if (isServer) {
      config.externals.push(({ request }: { request?: string }, callback: (error?: Error | null, result?: string) => void) => {
        if (
          request === 'yjs'
          || request?.startsWith('@aws-sdk/')
          || request?.startsWith('@smithy/')
          || request?.startsWith('@langchain/')
          || request === 'coze-coding-dev-sdk'
          || request === 'dotenv'
          // P0 fix: 原生 .node 模块必须排除在 webpack bundle 之外
          || request?.startsWith('@napi-rs/')
        ) {
          callback(null, `commonjs ${request}`);
          return;
        }
        callback();
      });
    }
    return config;
  },
  // turbopack disabled to avoid HMR "Router action" error breaking React event system
  // turbopack: {
  //   root: path.resolve(__dirname),
  // },
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site', '127.0.0.1', 'localhost'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    // 开发模式代理超时：匹配后端maxDuration(600s=10分钟)，部分API生图最久可达90秒+
    proxyTimeout: 600000,
    // 代理请求体大小限制：默认 1MB 不够 base64 图片（语言修图等）
    proxyClientMaxBodySize: '50mb',
  },
  // Standard Next.js output (no standalone)
  // output: 'standalone',
};

export default nextConfig;
