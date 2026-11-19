/**
 * Reference audio for video models: a character's voice sample, so the model speaks the line in that voice.
 * Only the endpoints that document it get any:
 * - Pear: `reference_contents` items of type `audio` (pearapi.apifox.cn Seedance 2.x pages, 2026-11-19).
 * - APIMart: `audio_urls` (docs.apib.ai seedance-2-0 / seedance-2-5 generation, 2026-11-19).
 * Seedance cannot take reference audio together with first/last frames, and 2.0 needs at least one reference image.
 */
import { getPearVideoModelSpec } from './pear-video-models';

/** Seedance 2.0 takes clips of 2 to 15 seconds, up to 15MB each, as WAV or MP3. */
export const VOICE_SAMPLE_MIN_SEC = 2;
export const VOICE_SAMPLE_MAX_SEC = 15;
export const VOICE_SAMPLE_MAX_BYTES = 15 * 1024 * 1024;

/** How many reference audio clips the model accepts; 0 means none. `protocol` is the video compat profile. */
export function referenceAudioLimit(protocol: string | undefined, modelId: string): number {
  if (protocol === 'pearapi-video') return getPearVideoModelSpec(modelId)?.maxAudios ?? 0;
  if (protocol === 'apimart-video') {
    const id = modelId.trim().toLowerCase();
    if (id === 'seedance-2.5') return 10;
    if (/^seedance-2\.0(?:-fast|-mini)?$/u.test(id)) return 3;
  }
  return 0;
}
