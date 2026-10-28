import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { LANGUAGES, VOICE_PRESETS } from '../constants.js';
import { ffmpeg, ensureProjectDir, seedNumber, splitCaptionChunks, writeSrt } from './utils.js';

const require = createRequire(import.meta.url);
const SAMPLE_RATE = 24000;
const meSpeak = require('mespeak');
meSpeak.loadConfig(require('mespeak/src/mespeak_config.json'));

function languageVoiceFile(language) {
  return LANGUAGES.find((item) => item.id === language)?.voice || 'en/en-us';
}

export function activeTtsProvider() {
  const requested = config.media.ttsProvider;
  if (requested === 'mespeak') return 'mespeak-local';
  if (requested === 'openai') {
    if (!config.ai.openaiKey) throw new Error('TTS_PROVIDER=openai requires OPENAI_API_KEY. No voice-over was generated.');
    return `openai:${config.media.openaiTtsModel}`;
  }
  if (requested === 'elevenlabs') {
    if (!config.media.elevenLabsKey) throw new Error('TTS_PROVIDER=elevenlabs requires ELEVENLABS_API_KEY. No voice-over was generated.');
    return 'elevenlabs:multilingual-v2';
  }
  throw new Error(`Unsupported TTS_PROVIDER "${requested}". Use mespeak, openai, or elevenlabs.`);
}

async function writeBinaryResponse(url, options, outputPath, timeoutMs = 120000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 600);
    const error = new Error(`TTS provider returned ${response.status}: ${body}`);
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  return outputPath;
}

export async function synthesizeScene({ text, language, voice, outputPath, workDir, index }) {
  const provider = config.media.ttsProvider;
  const preset = VOICE_PRESETS[voice] || VOICE_PRESETS.nova;
  let rawPath;
  if (provider === 'mespeak') {
    const voiceFile = language === 'en' ? (preset.variant || 'en/en-us') : languageVoiceFile(language);
    const voiceJson = require(`mespeak/voices/${voiceFile}.json`);
    meSpeak.loadVoice(voiceJson);
    const wav = meSpeak.speak(text, {
      rawdata: 'buffer',
      speed: Math.max(95, Math.min(230, preset.speed)),
      pitch: Math.max(20, Math.min(80, preset.pitch)),
      amplitude: Math.max(50, Math.min(130, preset.amplitude)),
      wordgap: 1,
    });
    if (!Buffer.isBuffer(wav)) throw new Error('Local TTS engine did not return WAV audio.');
    rawPath = path.join(workDir, `voice-${index}.wav`);
    await fs.writeFile(rawPath, wav);
  } else if (provider === 'openai') {
    const openaiVoice = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(voice) ? voice : 'alloy';
    rawPath = path.join(workDir, `voice-${index}.wav`);
    await writeBinaryResponse(`${config.externalApis.openai}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.openaiKey}` },
      body: JSON.stringify({ model: config.media.openaiTtsModel, voice: openaiVoice, input: text, response_format: 'wav' }),
    }, rawPath);
  } else if (provider === 'elevenlabs') {
    const voiceId = voice === 'eleven-default' || !VOICE_PRESETS[voice] ? config.media.elevenLabsVoiceId : voice;
    rawPath = path.join(workDir, `voice-${index}.mp3`);
    const url = `${config.externalApis.elevenLabs}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    await writeBinaryResponse(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': config.media.elevenLabsKey },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.7, style: 0.2 } }),
    }, rawPath);
  } else {
    throw new Error(`Unsupported TTS provider "${provider}".`);
  }
  await ffmpeg(['-i', rawPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', outputPath]);
  return outputPath;
}

export function readWav(input) {
  const buffer = Buffer.isBuffer(input) ? input : fsSync.readFileSync(input);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const readAscii = (offset, length) => String.fromCharCode(...buffer.subarray(offset, offset + length));
  if (readAscii(0, 4) !== 'RIFF' || readAscii(8, 4) !== 'WAVE') throw new Error('Invalid WAV file');
  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || audioFormat !== 1 || bitsPerSample !== 16 || channels < 1) throw new Error('Unsupported WAV format; expected 16-bit PCM');
  const frames = Math.floor(dataSize / (2 * channels));
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += view.getInt16(dataOffset + (i * channels + c) * 2, true);
    samples[i] = Math.round(sum / channels);
  }
  return { samples, sampleRate, channels };
}

export async function writeWav(samples, outputPath, sampleRate = SAMPLE_RATE) {
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);
  const pcm = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
    pcm.writeInt16LE(value, i * 2);
  }
  await fs.writeFile(outputPath, Buffer.concat([header, pcm]));
  return outputPath;
}

export function resamplePcm(samples, targetLength, fromSampleRate = SAMPLE_RATE, toSampleRate = SAMPLE_RATE) {
  if (targetLength <= 0) return new Int16Array(0);
  if (samples.length === targetLength && fromSampleRate === toSampleRate) return samples;
  const result = new Int16Array(targetLength);
  const ratio = (samples.length - 1) / Math.max(1, targetLength - 1) * (fromSampleRate / toSampleRate);
  for (let i = 0; i < targetLength; i += 1) {
    const source = Math.min(samples.length - 1, i * ratio);
    const index = Math.floor(source);
    const next = Math.min(samples.length - 1, index + 1);
    const fraction = source - index;
    result[i] = Math.round(samples[index] * (1 - fraction) + samples[next] * fraction);
  }
  return result;
}

function ambientSamples(length, seed, style) {
  const result = new Int16Array(length);
  if (!length) return result;
  const root = [98, 110, 123.47, 146.83, 164.81, 196][seed % 6];
  const intervals = style === 'creepy-comic' ? [1, 1.189, 1.498] : [1, 1.25, 1.5, 2];
  const freqs = intervals.map((interval) => root * interval);
  const phase = (seed % 360) / 360;
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.045 * t + phase);
    const slowPulse = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.11 * t);
    let value = 0;
    for (let f = 0; f < freqs.length; f += 1) value += Math.sin(2 * Math.PI * freqs[f] * t + f * 1.7) / (f + 2);
    value += 0.16 * Math.sin(2 * Math.PI * (root / 2) * t);
    result[i] = Math.round(value * envelope * slowPulse * 2200);
  }
  return result;
}

function clip16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

export async function buildNarrationAudio({ projectId, plan, input, onProgress = async () => {} }) {
  const provider = activeTtsProvider();
  const dir = await ensureProjectDir(projectId);
  const audioDir = path.join(dir, 'audio');
  const targetDuration = Math.max(8, Number(input.duration) || 45);
  const totalSamples = Math.round(targetDuration * SAMPLE_RATE);
  const sceneSamples = Math.floor(totalSamples / plan.scenes.length);
  const padSamples = Math.round(SAMPLE_RATE * 0.14);
  const speechSamples = Math.max(SAMPLE_RATE / 2, sceneSamples - padSamples * 2);
  const voiceTrack = new Int16Array(totalSamples);
  const frames = [];
  let ttsCharacters = 0;

  for (let index = 0; index < plan.scenes.length; index += 1) {
    const scene = plan.scenes[index];
    const sceneText = String(scene.narration || '').trim();
    ttsCharacters += sceneText.length;
    const wavPath = path.join(audioDir, `scene-${index + 1}.wav`);
    await synthesizeScene({ text: sceneText, language: input.language, voice: input.voice, outputPath: wavPath, workDir: audioDir, index: index + 1 });
    const { samples, sampleRate } = readWav(await fs.readFile(wavPath));
    const fitted = resamplePcm(samples, speechSamples, sampleRate, SAMPLE_RATE);
    const sceneStart = index * sceneSamples;
    for (let i = 0; i < fitted.length && sceneStart + padSamples + i < totalSamples; i += 1) {
      voiceTrack[sceneStart + padSamples + i] = fitted[i];
    }
    const chunks = input.captions ? splitCaptionChunks(scene.caption || scene.narration, input.language === 'zh' ? 5 : 7) : [''];
    const weights = chunks.map((chunk) => Math.max(1, chunk.length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const chunkStartSeconds = sceneStart / SAMPLE_RATE;
    const sceneDurationSeconds = sceneSamples / SAMPLE_RATE;
    let elapsed = 0;
    for (let c = 0; c < chunks.length; c += 1) {
      const duration = sceneDurationSeconds * (weights[c] / totalWeight);
      frames.push({
        sceneIndex: index,
        imageIndex: index,
        caption: chunks[c],
        start: chunkStartSeconds + elapsed,
        duration: Math.max(0.35, duration),
        motion: chunks.length <= 1 ? 0 : c / (chunks.length - 1),
      });
      elapsed += duration;
    }
    await onProgress(56 + Math.round(((index + 1) / plan.scenes.length) * 16));
  }

  const ambient = input.music ? ambientSamples(totalSamples, seedNumber(`${projectId}:ambient`), input.style) : new Int16Array(totalSamples);
  const mixed = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i += 1) mixed[i] = clip16(voiceTrack[i] * 0.92 + ambient[i] * 0.38);
  const audioPath = path.join(audioDir, 'soundtrack.wav');
  await writeWav(mixed, audioPath);
  const srtPath = path.join(dir, 'captions.srt');
  await writeSrt(frames, srtPath);
  return {
    audioPath, srtPath, frames, duration: targetDuration, provider, ttsCharacters,
    musicProvider: input.music ? 'procedural-original' : 'none',
  };
}
