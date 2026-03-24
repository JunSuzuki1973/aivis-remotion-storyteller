#!/usr/bin/env node
/**
 * Aivis Cloud API 一括音声合成 + 無音検出分割スクリプト
 *
 * 全シーンのテキストを1回のAPI呼び出しで合成し、
 * ffmpegのsilencedetectでシーン間の無音を検出して分割する。
 *
 * Usage:
 *   node scripts/synthesize.mjs --descriptor ./public/content/my-story/descriptor.json
 *
 * 出力:
 *   - descriptor.jsonと同じディレクトリの audio/ に各シーンのMP3を保存
 *   - stdoutにJSON形式で結果を出力
 *
 * 環境変数:
 *   AIVIS_API_KEY       - Aivis Cloud APIキー（必須）
 *   AIVIS_MODEL_UUID    - 音声モデルUUID（デフォルト: a59cb814-...）
 *
 * レガシーモード（単一シーン）:
 *   node scripts/synthesize.mjs --text "テキスト" --output ./path/to/output.mp3
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const apiKey = getArg("api-key") || process.env.AIVIS_API_KEY;
const modelUuid =
  getArg("model-uuid") ||
  process.env.AIVIS_MODEL_UUID ||
  "a59cb814-0083-4369-8542-f51a29e72af7";

if (!apiKey) {
  console.error("Error: --api-key or AIVIS_API_KEY environment variable required");
  process.exit(1);
}

// --- レガシーモード（単一テキスト） ---
const singleText = getArg("text");
const singleOutput = getArg("output");

if (singleText && singleOutput) {
  await synthesizeSingle(singleText, singleOutput);
  process.exit(0);
}

// --- 一括モード（descriptor.json） ---
const descriptorPath = getArg("descriptor");

if (!descriptorPath) {
  console.error("Usage:");
  console.error("  一括: node synthesize.mjs --descriptor <descriptor.json>");
  console.error("  単体: node synthesize.mjs --text <text> --output <path>");
  process.exit(1);
}

await synthesizeBatch(descriptorPath);

// ============================================================
// 単一テキスト合成（レガシー互換）
// ============================================================
async function synthesizeSingle(text, outputPath) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const buffer = await callAivisApi(text);
  fs.writeFileSync(outputPath, buffer);

  const durationSeconds = getMp3Duration(outputPath);
  console.log(JSON.stringify({ durationSeconds, outputPath }));
}

// ============================================================
// 一括合成 + 無音検出分割
// ============================================================
async function synthesizeBatch(descriptorPath) {
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf-8"));
  const contentDir = path.dirname(descriptorPath);
  const audioDir = path.join(contentDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const scenes = descriptor.content;
  if (!scenes || scenes.length === 0) {
    console.error("Error: descriptor.content is empty");
    process.exit(1);
  }

  // 全テキストを結合（シーン間に改行2つで自然なポーズ）
  const combinedText = scenes.map((s) => s.text).join("\n\n");

  // 1回のAPI呼び出しで一括合成
  const combinedBuffer = await callAivisApi(combinedText);
  const combinedPath = path.join(audioDir, "_combined.mp3");
  fs.writeFileSync(combinedPath, combinedBuffer);

  const totalDuration = getMp3Duration(combinedPath);

  if (scenes.length === 1) {
    // 1シーンなら分割不要
    const outPath = path.join(audioDir, `${scenes[0].uid}.mp3`);
    fs.copyFileSync(combinedPath, outPath);
    const result = {
      scenes: [{ uid: scenes[0].uid, durationSeconds: totalDuration, outputPath: outPath }],
      totalDurationSeconds: totalDuration,
    };
    // descriptor更新
    scenes[0].durationSeconds = totalDuration;
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2));
    cleanup(combinedPath);
    console.log(JSON.stringify(result));
    return;
  }

  // 無音検出
  const silences = detectSilences(combinedPath);

  // シーン間の分割点を決定（テキスト文字数比率ベース）
  const splitPoints = findSceneBoundaries(silences, scenes, totalDuration);

  // 分割
  const results = [];
  for (let i = 0; i < scenes.length; i++) {
    const start = splitPoints[i];
    const end = splitPoints[i + 1];
    const uid = scenes[i].uid;
    const outPath = path.join(audioDir, `${uid}.mp3`);

    execSync(
      `ffmpeg -y -i "${combinedPath}" -ss ${start} -to ${end} -acodec libmp3lame -q:a 2 "${outPath}"`,
      { stdio: "pipe" },
    );

    const durationSeconds = getMp3Duration(outPath);
    results.push({ uid, durationSeconds, outputPath: outPath });

    // descriptor更新
    scenes[i].durationSeconds = durationSeconds;
  }

  // descriptor.jsonを更新（正確なdurationSecondsを反映）
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2));

  cleanup(combinedPath);

  console.log(
    JSON.stringify({
      scenes: results,
      totalDurationSeconds: totalDuration,
      splitPoints,
    }),
  );
}

// ============================================================
// Aivis Cloud API呼び出し
// ============================================================
async function callAivisApi(text) {
  const res = await fetch("https://api.aivis-project.com/v1/tts/synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_uuid: modelUuid,
      text,
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

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================================
// ffmpeg silencedetect で無音区間を検出
// ============================================================
function detectSilences(mp3Path) {
  const output = execSync(
    `ffmpeg -i "${mp3Path}" -af silencedetect=noise=-30dB:d=0.3 -f null - 2>&1`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
  ).toString();

  const silences = [];
  const lines = output.split("\n");

  let currentStart = null;
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);

    if (startMatch) {
      currentStart = parseFloat(startMatch[1]);
    }
    if (endMatch && currentStart !== null) {
      silences.push({
        start: currentStart,
        end: parseFloat(endMatch[1]),
        duration: parseFloat(endMatch[2]),
      });
      currentStart = null;
    }
  }

  return silences;
}

// ============================================================
// シーン間の分割点を無音区間から決定
// テキストの文字数比率から期待位置を推定し、最寄りの無音で分割
// ============================================================
function findSceneBoundaries(silences, scenes, totalDuration) {
  const sceneCount = scenes.length;
  if (sceneCount <= 1) return [0, totalDuration];

  // 各シーンのテキスト文字数から期待duration比率を算出
  const charCounts = scenes.map((s) => s.text.length);
  const totalChars = charCounts.reduce((a, b) => a + b, 0);

  // 期待される累積分割位置
  const expectedPositions = [];
  let cumChars = 0;
  for (let i = 0; i < sceneCount - 1; i++) {
    cumChars += charCounts[i];
    expectedPositions.push((cumChars / totalChars) * totalDuration);
  }

  const boundaries = [0];
  const usedSilences = new Set();

  for (let i = 0; i < expectedPositions.length; i++) {
    const expectedPos = expectedPositions[i];
    // 期待位置±20%の範囲内で最寄りの無音を探す
    const tolerance = totalDuration * 0.2;

    const nearby = silences.filter(
      (s, idx) =>
        !usedSilences.has(idx) &&
        s.start >= expectedPos - tolerance &&
        s.start <= expectedPos + tolerance,
    );

    if (nearby.length > 0) {
      // 期待位置に最も近い無音を優先、同距離なら長い無音を優先
      nearby.sort((a, b) => {
        const distA = Math.abs((a.start + a.end) / 2 - expectedPos);
        const distB = Math.abs((b.start + b.end) / 2 - expectedPos);
        // 距離が近いものを優先、同距離なら長い無音を優先
        if (Math.abs(distA - distB) < 0.5) return b.duration - a.duration;
        return distA - distB;
      });
      const best = nearby[0];
      const bestIdx = silences.indexOf(best);
      usedSilences.add(bestIdx);
      boundaries.push((best.start + best.end) / 2);
    } else {
      // フォールバック: 期待位置で分割
      boundaries.push(expectedPos);
    }
  }

  boundaries.push(totalDuration);
  boundaries.sort((a, b) => a - b);

  return boundaries;
}

// ============================================================
// ffprobe でMP3のdurationを取得
// ============================================================
function getMp3Duration(mp3Path) {
  const output = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${mp3Path}"`,
    { encoding: "utf-8" },
  ).trim();
  return parseFloat(output);
}

// ============================================================
// 一時ファイル削除
// ============================================================
function cleanup(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}
