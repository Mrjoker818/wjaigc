'use client';

import { createContext, useContext } from 'react';
import type { CreditEstimate } from '@/lib/drama/workbench-client';
import type { DramaEpisode, DramaProjectV1, DramaShot } from '@/lib/drama/types';
import type { DramaModelOption } from './drama-models';

export type DramaStep = 'script' | 'bible' | 'board' | 'shots' | 'final';

/** Steps in production order; the workbench numbers them because the order is real. */
export const DRAMA_STEPS: Array<{ id: DramaStep; label: string; hint: string }> = [
  { id: 'script', label: '剧本', hint: '写或生成分集剧本' },
  { id: 'bible', label: '设定', hint: '角色和场景的定妆图' },
  { id: 'board', label: '分镜', hint: '把每一场拆成镜头' },
  { id: 'shots', label: '镜头', hint: '生成、重拍、选用' },
  { id: 'final', label: '成片', hint: '转场、字幕、渲染' },
];

export interface DramaWorkbenchApi {
  doc: DramaProjectV1;
  episode: DramaEpisode | undefined;
  /** Applies a pure edit to the document; the workbench saves it automatically. */
  update: (edit: (doc: DramaProjectV1) => DramaProjectV1) => void;
  /** Replaces the whole document, for a newly generated script. */
  replaceDoc: (doc: DramaProjectV1) => void;
  setEpisodeId: (id: string) => void;
  step: DramaStep;
  setStep: (step: DramaStep) => void;
  selectedShotId: string | null;
  selectShot: (id: string | null) => void;
  models: DramaModelOption[];
  modelsLoading: boolean;
  defaultModel: DramaModelOption | undefined;
  setDefaultModelKey: (key: string) => void;
  modelForShot: (shot: DramaShot) => DramaModelOption | undefined;
  generateAudio: boolean;
  setGenerateAudio: (value: boolean) => void;
  /** Shots with a take in flight. */
  runningShotIds: ReadonlySet<string>;
  batchRunning: boolean;
  /** Generates the given shots one after another, so each can start from the previous shot's last frame. */
  generateShots: (shotIds: string[]) => Promise<void>;
  stopGeneration: () => void;
  estimate: CreditEstimate | null;
  /** Label of the planner or image job that is running, shown in the top bar. */
  busyLabel: string | null;
  /** Runs one job at a time and reports its error as a toast. Resolves false when it failed or another job is running. */
  runJob: (label: string, job: () => Promise<void>) => Promise<boolean>;
  dramaId: string;
  projectId?: string;
  saveState: SaveState;
  flushSave: () => Promise<boolean>;
  render: RenderState;
  /** Saves, then renders the current episode in the background. */
  renderEpisode: () => Promise<void>;
  onPlaceOnCanvas?: (result: { videoUrl: string; thumbnailUrl?: string; duration?: number; aspectRatio?: string }) => void;
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface RenderState {
  status: 'idle' | 'rendering' | 'failed';
  progress: number;
  error?: string;
}

export const DramaWorkbenchContext = createContext<DramaWorkbenchApi | null>(null);

export function useDrama(): DramaWorkbenchApi {
  const value = useContext(DramaWorkbenchContext);
  if (!value) throw new Error('useDrama must be used inside the drama workbench');
  return value;
}
