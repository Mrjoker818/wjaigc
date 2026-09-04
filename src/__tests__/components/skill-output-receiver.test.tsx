// @vitest-environment jsdom
import { useCallback, useEffect, useRef, useState } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSkillOutputReceiver } from '@/components/skill-runtime/use-skill-output-receiver';
import { createCanvasSkillProjectionCoordinator } from '@/lib/skill-runtime/canvas-client';

afterEach(cleanup);

it('keeps callback identity stable while invoking the latest receiver and rejects calls after unmount', () => {
  const first = vi.fn();
  const second = vi.fn();
  const view = renderHook(({ receiver }) => useSkillOutputReceiver(receiver), { initialProps: { receiver: first } });
  const receive = view.result.current!;
  view.rerender({ receiver: second });
  expect(view.result.current).toBe(receive);
  receive({ assetId: 'a', assetVersionId: 'v1', url: '/v1.png' });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  view.unmount();
  expect(() => receive({ assetId: 'a', assetVersionId: 'v1', url: '/v1.png' })).toThrow('画布暂时无法接收');
});

it.each(['project-switch', 'unmount'])('rejects late image delivery on %s', async transition => {
  const release: Array<() => void> = [];
  const delivered = vi.fn();
  function Receiver({ projectId }: { projectId: string }): React.ReactElement {
    const receive = useSkillOutputReceiver(reference => delivered(projectId, reference.assetVersionId));
    useEffect(() => {
      const controller = new AbortController();
      void (async () => {
        await new Promise<void>(resolve => release.push(resolve));
        if (!controller.signal.aborted) receive?.({ assetId: 'a', assetVersionId: 'v1', url: '/v1.png' });
      })();
      return () => controller.abort();
    }, [projectId, receive]);
    return <span>{projectId}</span>;
  }
  const view = render(<Receiver projectId="p1" />);
  if (transition === 'unmount') view.unmount();
  else view.rerender(<Receiver projectId="p2" />);
  await act(async () => release[0]());
  expect(delivered).not.toHaveBeenCalled();
  if (transition === 'project-switch') {
    await act(async () => release[1]());
    expect(delivered).toHaveBeenCalledExactlyOnceWith('p2', 'v1');
  }
});

it('keeps four delayed saves alive while every insertion changes the parent receiver callback', async () => {
  const releases: Array<() => void> = [];
  const aborts = vi.fn();
  function Canvas(): React.ReactElement {
    const [images, setImages] = useState<string[]>([]);
    const coordinator = useRef(createCanvasSkillProjectionCoordinator());
    const attempts = useRef(0);
    const onAdd = useCallback(async (reference: { assetVersionId?: string }) => {
      setImages([...images, reference.assetVersionId!]);
      await new Promise<void>(resolve => releases.push(resolve));
    }, [images]);
    const receive = useSkillOutputReceiver(onAdd);
    useEffect(() => {
      if (!receive || attempts.current >= 2) return;
      attempts.current += 1;
      const controller = new AbortController();
      coordinator.current.activate('run-1', 'project-1');
      void (async () => {
        for (const id of ['v1', 'v2', 'v3', 'v4']) {
          if (controller.signal.aborted) return;
          await coordinator.current.project({ runId: 'run-1', projectId: 'project-1', assetVersionId: id,
            project: () => Promise.resolve(receive({ assetId: id, assetVersionId: id, url: `/${id}.png` })),
          });
        }
      })();
      return () => { aborts(); controller.abort(); };
    }, [receive]);
    return <output>{images.join(',')}</output>;
  }
  render(<Canvas />);
  for (let index = 0; index < 4; index += 1) {
    await act(async () => { releases[index]?.(); });
  }
  expect(screen.getByRole('status').textContent).toBe('v1,v2,v3,v4');
  expect(aborts).not.toHaveBeenCalled();
});
