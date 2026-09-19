import type { Metadata } from 'next';

import { SharedCanvasClient } from './shared-canvas-client';

export const metadata: Metadata = {
  title: '只读画布分享 | 无界AI',
  description: '查看无界AI只读画布分享',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
};

export default function SharedCanvasPage(): React.ReactElement {
  return <SharedCanvasClient />;
}
