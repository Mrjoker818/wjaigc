import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
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
    serverActions: {
      bodySizeLimit: '50mb',
    },
    // 开发模式代理超时：默认 30s 不够 LLM 协作 + 图像编辑流程（可能 2-3 分钟）
    proxyTimeout: 300000,
    // 代理请求体大小限制：默认 1MB 不够 base64 图片（语言修图等）
    proxyClientMaxBodySize: '50mb',
  },
  // Standard Next.js output (no standalone)
  // output: 'standalone',
};

export default nextConfig;
