'use client';

import { createContext, useContext } from 'react';
import type { AutopilotChoices, AutopilotQuote, AutopilotRun } from '@/lib/drama/autopilot';
import type { CanvasMediaLike } from '@/lib/drama/library';
import type { KeyframeKind } from '@/lib/drama/reference-prompts';
import type { CreditEstimate } from '@/lib/drama/workbench-client';
import type { DramaEpisode, DramaProjectV1, DramaShot } from '@/lib/drama/types';
import type { DramaImageModelOption, DramaModelOption } from './drama-models';

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
  /**
   * Generates the given shots one after another, so each can start from the previous shot's last frame.
   * Resolves false when the batch was stopped, ran out of credits or had no model; failed shots alone do not count.
   */
  generateShots: (shotIds: string[]) => Promise<boolean>;
  stopGeneration: () => void;
  estimate: CreditEstimate | null;
  imageModels: DramaImageModelOption[];
  /** Image model that draws keyframes; undefined lets the server pick its default. */
  imageModel: DramaImageModelOption | undefined;
  setImageModelKey: (key: string) => void;
  /** Shots whose keyframe is being drawn; a closing frame is listed as `${shotId}:last`. */
  keyframeShotIds: ReadonlySet<string>;
  /**
   * Draws the opening frame of each shot with the image model; the video then starts from it.
   * With `kind: 'last'` it draws the closing frame, which models with first/last-frame support end on.
   * After `stop` aborts, frames already being drawn finish and no new ones start. Resolves false when stopped or out of credits.
   */
  generateKeyframes: (shotIds: string[], kind?: KeyframeKind, stop?: AbortSignal) => Promise<boolean>;
  /** Shots whose voiceover is being recorded. */
  voiceoverShotIds: ReadonlySet<string>;
  /** Records the line of each shot in its speaker's voice; free of credits. */
  generateVoiceovers: (shotIds: string[]) => Promise<void>;
  /** Credits for drawing keyframes of the shots that have none yet. */
  keyframeEstimate: CreditEstimate | null;
  /** Label of the planner or image job that is running, shown in the top bar. */
  busyLabel: string | null;
  /** Runs one job at a time and reports its error as a toast. Resolves false when it failed or another job is running. */
  runJob: (label: string, job: () => Promise<void>) => Promise<boolean>;
  dramaId: string;
  projectId?: string;
  saveState: SaveState;
  flushSave: () => Promise<boolean>;
  render: RenderState;
  /** Saves, then renders the episode (the current one by default) in the background. */
  renderEpisode: (episodeId?: string) => Promise<void>;
  /** The one-click run in progress, or null. */
  autopilot: AutopilotRun | null;
  /** Splits scenes that have no shots (free), then prices what the current episode still lacks. Null when it could not start. */
  quoteAutopilot: () => Promise<AutopilotQuote | null>;
  /** Fills the quoted gaps stage by stage; refuses when the episode gained paid work since the quote. */
  runAutopilot: (quote: AutopilotQuote, choices: AutopilotChoices) => Promise<void>;
  stopAutopilot: () => void;
  /** The admin has a speech model; without one voiceovers cannot be recorded. */
  voiceAvailable: boolean;
  /** Puts a video on the project's canvas; `label` names it there ("镜头 03"), the film when absent. */
  onPlaceOnCanvas?: (result: { videoUrl: string; thumbnailUrl?: string; duration?: number; aspectRatio?: string; label?: string }) => void;
  /** Puts one image (a bible image or keyframe) on the project's canvas. */
  onPlaceImageOnCanvas?: (image: { url: string; name?: string }) => void;
  /** Pictures and videos on the project's canvas, offered in the library picker. */
  canvasMedia?: readonly CanvasMediaLike[];
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
