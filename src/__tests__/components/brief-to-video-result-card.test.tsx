// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BriefToVideoResultCard } from '@/components/skill-runtime/BriefToVideoResultCard';

const video = { assetId: 'video-a', assetVersionId: 'video-v', kind: 'video', url: '/owned-video.mp4' };
const structured = { schemaId: 'brief-to-video-result-v1', runId: 'video-run', planChecksum: 'a'.repeat(64),
  videoAssetVersionId: 'video-v', sourceAssetVersionIds: ['source'], providerId: 'fixture', modelId: 'fixture',
  remoteTaskId: 'fixture', durationSeconds: 10, aspectRatio: '16:9' };
function runResponse(): Response { return Response.json({ run: { runId: 'video-run', status: 'completed',
  assetVersionIds: ['video-v'], outputs: [{ stepId: 'film', kind: 'json', schemaId: structured.schemaId, content: JSON.stringify(structured) }] } }); }
function props(authority: 'document' | 'legacy' | 'pending', fetcher: typeof fetch) {
  return { runId: 'video-run', projectId: 'target', authority, expectedActorId: 'editor', fetcher };
}
describe('1397 fix1 actual Brief card', () => {
  it('document card reads the authorized owner video without private asset reads', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).startsWith('/api/skill-runs/video-run/assets?')
      ? Response.json({ actorUserId: 'editor', projectId: 'target', runId: 'video-run', references: [video] })
      : String(url).startsWith('/api/assets?') ? Response.json({ error: 'owner not actor' }, { status: 403 }) : runResponse());
    render(<BriefToVideoResultCard {...props('document', fetcher)} />);
    expect((await screen.findByRole('link', { name: '下载成片' })).getAttribute('href')).toBe(video.url);
    expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/api/assets?'))).toBe(false);
  });
  it('pending card rejects delivery instead of falling back to private assets', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).startsWith('/api/assets?') ? Response.json(video) : runResponse());
    render(<BriefToVideoResultCard {...props('pending', fetcher)} />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.queryByRole('link', { name: '下载成片' })).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/api/assets?'))).toBe(false);
  });
  it('legacy retains the same video display and download', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).startsWith('/api/assets?') ? Response.json(video) : runResponse());
    const view = render(<BriefToVideoResultCard {...props('legacy', fetcher)} />);
    expect((await screen.findByRole('link', { name: '下载成片' })).getAttribute('href')).toBe(video.url);
    expect(view.container.querySelector('video')?.getAttribute('src')).toBe(video.url);
  });
  it.each(['actor', 'project', 'run', 'authority', 'unmount'] as const)('rejects late video after %s changes', async mode => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn<typeof fetch>(async url => String(url).startsWith('/api/skill-runs/video-run/assets?')
      ? pending : runResponse());
    const initial = props('document', fetcher);
    const view = render(<BriefToVideoResultCard {...initial} />);
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes('/assets?'))).toBe(true));
    if (mode === 'actor') view.rerender(<BriefToVideoResultCard {...initial} expectedActorId="other" />);
    if (mode === 'project') view.rerender(<BriefToVideoResultCard {...initial} projectId="other" />);
    if (mode === 'run') view.rerender(<BriefToVideoResultCard {...initial} runId="other" />);
    if (mode === 'authority') view.rerender(<BriefToVideoResultCard {...initial} authority="pending" />);
    if (mode === 'unmount') view.unmount();
    await act(async () => { resolve(Response.json({ actorUserId: 'editor', projectId: 'target', runId: 'video-run', references: [video] })); await pending; });
    expect(screen.queryByRole('link', { name: '下载成片' })).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/api/assets?'))).toBe(false);
  });
  it('rejects a wrong response actor at the actual document card', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('/assets?')
      ? Response.json({ actorUserId: 'other', projectId: 'target', runId: 'video-run', references: [video] }) : runResponse());
    render(<BriefToVideoResultCard {...props('document', fetcher)} />);
    expect((await screen.findByRole('alert')).textContent).toContain('身份不一致');
    expect(screen.queryByRole('link', { name: '下载成片' })).toBeNull();
  });
});
