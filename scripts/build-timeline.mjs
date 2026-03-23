#!/usr/bin/env node
/**
 * タイムライン生成スクリプト
 *
 * descriptor.json からRemotionのtimeline.jsonを生成する。
 * 日本語テキスト対応（文字数ベースの分割）。
 *
 * Usage:
 *   node scripts/build-timeline.mjs --input ./public/content/my-story/descriptor.json
 *
 * 出力:
 *   descriptor.json と同じディレクトリに timeline.json を生成
 */

import fs from "fs";
import path from "path";

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const inputPath = getArg("input");

if (!inputPath) {
  console.error("Usage: node build-timeline.mjs --input <descriptor.json>");
  process.exit(1);
}

const descriptor = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

/**
 * descriptor.json の構造:
 * {
 *   "shortTitle": "タイトル",
 *   "content": [
 *     {
 *       "text": "ナレーション文",
 *       "imageDescription": "画像の説明",
 *       "uid": "uuid",
 *       "durationSeconds": 3.45
 *     },
 *     ...
 *   ]
 * }
 */

function createTimeline(descriptor) {
  const timeline = {
    shortTitle: descriptor.shortTitle,
    elements: [],
    text: [],
    audio: [],
  };

  let durationMs = 0;
  let zoomIn = true;

  for (let i = 0; i < descriptor.content.length; i++) {
    const scene = descriptor.content[i];
    const lenMs = Math.ceil(scene.durationSeconds * 1000);

    // 背景要素（画像）
    timeline.elements.push({
      startMs: durationMs,
      endMs: durationMs + lenMs,
      imageUrl: scene.uid,
      enterTransition: "blur",
      exitTransition: "blur",
      animations: getBgAnimations(lenMs, zoomIn),
    });

    // 音声要素
    timeline.audio.push({
      startMs: durationMs,
      endMs: durationMs + lenMs,
      audioUrl: scene.uid,
    });

    // テキスト要素（日本語対応の文字分割）
    const textElements = splitJapaneseText(scene.text, durationMs, lenMs);
    timeline.text.push(...textElements);

    durationMs += lenMs;
    zoomIn = !zoomIn;
  }

  return timeline;
}

/**
 * 日本語テキストを字幕用に分割する
 * 句読点や文字数で自然に分割
 */
function splitJapaneseText(text, baseMs, totalLenMs) {
  const MAX_CHARS = 12; // 1字幕あたりの最大文字数
  const elements = [];

  // 句読点で分割を試みる
  const segments = [];
  let current = "";

  for (let i = 0; i < text.length; i++) {
    current += text[i];

    // 句読点や改行で区切る
    if (
      current.length >= MAX_CHARS ||
      text[i] === "。" ||
      text[i] === "、" ||
      text[i] === "！" ||
      text[i] === "？" ||
      text[i] === "\n"
    ) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = "";
    }
  }

  // 残りのテキスト
  const remaining = current.trim();
  if (remaining.length > 0) {
    segments.push(remaining);
  }

  if (segments.length === 0) return elements;

  // 各セグメントに時間を均等に割り当て
  const msPerChar = totalLenMs / text.length;
  let charOffset = 0;

  for (const segment of segments) {
    const startMs = baseMs + Math.floor(charOffset * msPerChar);
    const endMs = baseMs + Math.floor((charOffset + segment.length) * msPerChar);

    elements.push({
      startMs,
      endMs,
      text: segment,
      position: "center",
      animations: getTextAnimations(),
    });

    charOffset += segment.length;
  }

  return elements;
}

function getBgAnimations(durationMs, zoomIn) {
  const scaleFrom = zoomIn ? 1.5 : 1;
  const scaleTo = zoomIn ? 1 : 1.5;

  return [
    {
      type: "scale",
      from: scaleFrom,
      to: scaleTo,
      startMs: 0,
      endMs: durationMs,
    },
  ];
}

function getTextAnimations() {
  const durationMs = 300;
  const startScale = 0.6 + Math.random() * 0.2;
  const dontScale = Math.random() > 0.6;
  const bounces = Math.random() > 0.5;

  const animations = [
    {
      type: "scale",
      from: dontScale ? 1 : startScale,
      to: bounces ? 1.15 : 1,
      startMs: 0,
      endMs: durationMs,
    },
  ];

  if (bounces) {
    animations.push({
      type: "scale",
      from: 1.15,
      to: 1,
      startMs: durationMs,
      endMs: durationMs + 200,
    });
  }

  return animations;
}

// 実行
const timeline = createTimeline(descriptor);
const outputPath = path.join(path.dirname(inputPath), "timeline.json");
fs.writeFileSync(outputPath, JSON.stringify(timeline, null, 2));
console.log(JSON.stringify({ outputPath, sceneCount: descriptor.content.length }));
