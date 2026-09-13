import { describe, expect, it } from 'vitest';

import {
  mimeTypeForVideoPath,
  parseFfprobeVideoDimensions,
} from '@/lib/asset-core/video-file-metadata';

describe('persisted video metadata', () => {
  it('selects the video stream instead of an earlier audio stream', () => {
    expect(parseFfprobeVideoDimensions({
      streams: [
        { codec_type: 'audio' },
        { codec_type: 'video', width: 720, height: 1280 },
      ],
    })).toEqual({ width: 720, height: 1280 });
  });

  it('rejects missing, fractional, or non-positive dimensions', () => {
    expect(parseFfprobeVideoDimensions({
      streams: [{ codec_type: 'video', width: 0, height: 1279.5 }],
    })).toEqual({});
    expect(parseFfprobeVideoDimensions({ streams: [] })).toEqual({});
  });

  it('preserves the MIME type implied by MP4, WebM, MOV, and M4V files', () => {
    expect(mimeTypeForVideoPath('/tmp/result.mp4')).toBe('video/mp4');
    expect(mimeTypeForVideoPath('/tmp/result.webm')).toBe('video/webm');
    expect(mimeTypeForVideoPath('/tmp/result.mov')).toBe('video/quicktime');
    expect(mimeTypeForVideoPath('/tmp/result.m4v')).toBe('video/x-m4v');
  });
});
