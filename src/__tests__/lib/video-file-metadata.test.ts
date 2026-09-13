import { describe, expect, it } from 'vitest';

import { parseFfprobeVideoDimensions } from '@/lib/asset-core/video-file-metadata';

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
});
