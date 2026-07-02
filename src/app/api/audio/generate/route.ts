/**
 * AI 音频生成 API (TTS)
 * POST /api/audio/generate
 * Body: { text, voice?, speed?, model? }
 * 
 * 策略：多策略降级
 * 1. 如果配置了 TTS API（OPENAI_TTS_API_KEY/EDGETTS_ENDPOINT等），调用外部API
 * 2. 降级：生成一个简单的 WAV 占位音频（静音）供流程联通测试
 */

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// 确保上传目录存在
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

/** 生成一个简单的 WAV 文件头 */
function createWavHeader(dataLength: number, sampleRate: number = 44100, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
}

/** 生成一个简单的正弦波音调（提示音） */
function generateToneWav(durationSec: number = 1.0, frequency: number = 440): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataLength = numSamples * 2; // 16-bit mono
  const header = createWavHeader(dataLength, sampleRate);
  const data = Buffer.alloc(dataLength);
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // 简单的正弦波 + 淡入淡出
    const envelope = Math.min(1, t * 10, (durationSec - t) * 10);
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.3 * envelope * 32767;
    data.writeInt16LE(Math.floor(sample), i * 2);
  }
  
  return Buffer.concat([header, data]);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, voice = 'default', speed = 1.0 } = body;
    
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: '缺少text参数' }, { status: 400 });
    }
    
    // 策略1：尝试调用外部TTS API（如果配置了）
    const ttsApiKey = process.env.OPENAI_TTS_API_KEY || process.env.TTS_API_KEY;
    const ttsBaseUrl = process.env.TTS_BASE_URL || process.env.OPENAI_BASE_URL;
    
    if (ttsApiKey && ttsBaseUrl) {
      try {
        const ttsResp = await fetch(`${ttsBaseUrl.replace(/\/$/, '')}/v1/audio/speech`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ttsApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text.slice(0, 4096),
            voice: voice === 'default' ? 'alloy' : voice,
            speed: Math.max(0.25, Math.min(4.0, Number(speed) || 1.0)),
            response_format: 'mp3',
          }),
        });
        
        if (ttsResp.ok) {
          const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());
          await ensureUploadDir();
          const filename = `tts-${Date.now()}.mp3`;
          await writeFile(join(UPLOAD_DIR, filename), audioBuffer);
          return NextResponse.json({
            success: true,
            audioUrl: `/uploads/${filename}`,
            duration: text.length / 15, // 估算时长
            text,
            source: 'openai-tts',
          });
        }
      } catch (e) {
        console.warn('[audio/generate] External TTS failed, falling back:', e);
      }
    }
    
    // 策略2：降级生成提示音WAV（保证流程联通）
    // 估算时长：中文约3字/秒
    const estDuration = Math.max(1, Math.min(30, text.length / 4));
    const wavBuffer = generateToneWav(estDuration, voice.includes('female') ? 520 : 380);
    
    await ensureUploadDir();
    const filename = `audio-${Date.now()}.wav`;
    await writeFile(join(UPLOAD_DIR, filename), wavBuffer);
    
    // 占位音频不返回 success: true，避免前端误认为AI语音生成成功
    return NextResponse.json({
      success: false,
      audioUrl: `/uploads/${filename}`,
      duration: estDuration,
      text,
      source: 'local-tone',
      error: 'AI语音服务暂未配置，当前为占位提示音。请在管理后台配置TTS API密钥后使用真实AI语音。',
    });
  } catch (error) {
    console.error('[audio/generate] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '音频生成失败' },
      { status: 500 }
    );
  }
}
