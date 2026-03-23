#!/usr/bin/env node
/**
 * Aivis Cloud API 音声合成スクリプト
 *
 * Usage:
 *   node scripts/synthesize.mjs \
 *     --text "合成するテキスト" \
 *     --output ./public/content/my-story/audio/scene1.mp3 \
 *     --api-key YOUR_API_KEY \
 *     --model-uuid a59cb814-0083-4369-8542-f51a29e72af7
 *
 * 出力:
 *   - 指定パスにMP3ファイルを保存
 *   - stdoutにJSON形式で音声長(秒)を出力: {"durationSeconds": 3.45}
 */

import fs from "fs";
import path from "path";

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const text = getArg("text");
const outputPath = getArg("output");
const apiKey = getArg("api-key") || process.env.AIVIS_API_KEY;
const modelUuid =
  getArg("model-uuid") ||
  process.env.AIVIS_MODEL_UUID ||
  "a59cb814-0083-4369-8542-f51a29e72af7";

if (!text || !outputPath) {
  console.error("Usage: node synthesize.mjs --text <text> --output <path>");
  process.exit(1);
}
if (!apiKey) {
  console.error("Error: --api-key or AIVIS_API_KEY environment variable required");
  process.exit(1);
}

// 出力ディレクトリを作成
const dir = path.dirname(outputPath);
fs.mkdirSync(dir, { recursive: true });

async function synthesize() {
  const res = await fetch("https://api.aivis-project.com/v1/tts/synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_uuid: modelUuid,
      text: text,
      use_ssml: false,
      use_volume_normalizer: true,
      output_format: "mp3",
      output_sampling_rate: 44100,
      output_audio_channels: "mono",
      leading_silence_seconds: 0.0,
      trailing_silence_seconds: 0.3,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Aivis API error (${res.status}): ${errorText}`);
    process.exit(1);
  }

  // 音声データをファイルに保存
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(outputPath, buffer);

  // MP3の長さを計算（フレームヘッダー解析）
  const durationSeconds = estimateMp3Duration(buffer);

  // JSON形式でstdoutに結果を出力
  console.log(JSON.stringify({ durationSeconds, outputPath }));
}

/**
 * MP3ファイルのおおよその長さを推定する
 * Content-Lengthとビットレートから計算
 */
function estimateMp3Duration(buffer) {
  // MP3フレームヘッダーを探す
  const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const sampleRateTable = [44100, 48000, 32000, 0];

  let totalFrames = 0;
  let totalSamples = 0;
  let sampleRate = 44100;

  for (let i = 0; i < buffer.length - 4; i++) {
    // フレーム同期ワード: 0xFFE0 以上
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      const version = (buffer[i + 1] >> 3) & 0x03;
      const layer = (buffer[i + 1] >> 1) & 0x03;

      // MPEG1 Layer3 のみ対応
      if (version === 3 && layer === 1) {
        const bitrateIdx = (buffer[i + 2] >> 4) & 0x0f;
        const sampleRateIdx = (buffer[i + 2] >> 2) & 0x03;
        const padding = (buffer[i + 2] >> 1) & 0x01;

        const bitrate = bitrateTable[bitrateIdx];
        sampleRate = sampleRateTable[sampleRateIdx];

        if (bitrate > 0 && sampleRate > 0) {
          const frameSize = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
          totalFrames++;
          totalSamples += 1152; // MPEG1 Layer3 は 1フレーム = 1152サンプル
          i += frameSize - 1; // 次のフレームへスキップ
        }
      }
    }
  }

  if (totalFrames === 0 || sampleRate === 0) {
    // フォールバック: ファイルサイズ / (128kbps / 8) で推定
    return buffer.length / (128 * 1000 / 8);
  }

  return totalSamples / sampleRate;
}

synthesize().catch((err) => {
  console.error("Synthesis failed:", err);
  process.exit(1);
});
