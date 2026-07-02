import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // outputFileTracingRoot: path.resolve(__dirname),
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
    // 开发模式代理超时：匹配后端maxDuration(600s=10分钟)，部分API生图最久可达90秒+
    proxyTimeout: 600000,
    // 代理请求体大小限制：默认 1MB 不够 base64 图片（语言修图等）
    proxyClientMaxBodySize: '50mb',
  },
  // Standard Next.js output (no standalone)
  // output: 'standalone',
};

export default nextConfig;
