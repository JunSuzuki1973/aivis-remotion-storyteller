import z from "zod";
import * as fs from "fs";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../src/lib/constants";
import type { AudioSynthesisResult } from "../src/lib/types";

let apiKey: string | null = null;

export const setApiKey = (key: string) => {
  apiKey = key;
};

export const openaiStructuredCompletion = async <T>(
  prompt: string,
  schema: z.ZodType<T>,
): Promise<T> => {
  const jsonSchema = z.toJSONSchema(schema);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          schema: {
            type: jsonSchema.type || "object",
            properties: jsonSchema.properties,
            required: jsonSchema.required,
            additionalProperties: jsonSchema.additionalProperties ?? false,
          },
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);

  const data = await res.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  const parsed = JSON.parse(content);
  return schema.parse(parsed);
};

function saveUint8ArrayToPng(uint8Array: Uint8Array, filePath: string) {
  const buffer = Buffer.from(uint8Array);
  fs.writeFileSync(filePath, buffer as Uint8Array);
}

export const generateAiImage = async ({
  prompt,
  path,
  onRetry,
}: {
  prompt: string;
  path: string;
  onRetry: (attempt: number) => void;
}) => {
  const maxRetries = 3;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: `${IMAGE_WIDTH}x${IMAGE_HEIGHT}`,
        quality: "high",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const buffer = Buffer.from(data.data[0].b64_json, "base64");
      const uint8Array = new Uint8Array(buffer);

      saveUint8ArrayToPng(uint8Array, path);
      return;
    } else {
      lastError = new Error(
        `OpenAI error (attempt ${attempt + 1}): ${await res.text()}`,
      );
      attempt++;
      if (attempt < maxRetries) {
        // Wait 1 second before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      onRetry(attempt);
    }
  }

  // Ran out of retries, throw the last error
  throw lastError!;
};

export const getGenerateStoryPrompt = (title: string, topic: string) => {
  const prompt = `Write a short story with title [${title}] (its topic is [${topic}]).
   You must follow best practices for great storytelling. 
   The script must be 8-10 sentences long. 
   Story events can be from anywhere in the world, but text must be translated into English language. 
   Result result without any formatting and title, as one continuous text. 
   Skip new lines.`;

  return prompt;
};

export const getGenerateImageDescriptionPrompt = (storyText: string) => {
  const prompt = `You are given story text.
  Generate (in English) 5-8 very detailed image descriptions  for this story. 
  Return their description as json array with story sentences matched to images. 
  Story sentences must be in the same order as in the story and their content must be preserved.
  Each image must match 1-2 sentence from the story.
  Images must show story content in a way that is visually appealing and engaging, not just characters.
  Give output in json format:

  [
    {
      "text": "....",
      "imageDescription": "..."
    }
  ]

  <story>
  ${storyText}
  </story>`;

  return prompt;
};

/**
 * Aivis Cloud API を使用して音声合成を行う
 *
 * @param text - 合成するテキスト
 * @param aivisApiKey - Aivis Cloud API キー
 * @param outputPath - 出力MP3ファイルパス
 * @param modelUuid - Aivis音声モデルUUID（省略時はデフォルト）
 * @returns 音声の長さ（秒）を含む結果
 */
export const generateVoice = async (
  text: string,
  aivisApiKey: string,
  outputPath: string,
  modelUuid: string = "a59cb814-0083-4369-8542-f51a29e72af7",
): Promise<AudioSynthesisResult> => {
  const dir = require("path").dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const res = await fetch("https://api.aivis-project.com/v1/tts/synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aivisApiKey}`,
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
    throw new Error(`Aivis API error (${res.status}): ${errorText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(outputPath, buffer);

  const durationSeconds = estimateMp3Duration(buffer);

  return { durationSeconds, outputPath };
};

/**
 * MP3ファイルのおおよその長さを推定する
 * MPEG1 Layer3 フレームヘッダー解析
 */
function estimateMp3Duration(buffer: Buffer): number {
  const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const sampleRateTable = [44100, 48000, 32000, 0];

  let totalFrames = 0;
  let totalSamples = 0;
  let sampleRate = 44100;

  for (let i = 0; i < buffer.length - 4; i++) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      const version = (buffer[i + 1] >> 3) & 0x03;
      const layer = (buffer[i + 1] >> 1) & 0x03;

      if (version === 3 && layer === 1) {
        const bitrateIdx = (buffer[i + 2] >> 4) & 0x0f;
        const sampleRateIdx = (buffer[i + 2] >> 2) & 0x03;
        const padding = (buffer[i + 2] >> 1) & 0x01;

        const bitrate = bitrateTable[bitrateIdx];
        sampleRate = sampleRateTable[sampleRateIdx];

        if (bitrate > 0 && sampleRate > 0) {
          const frameSize = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
          totalFrames++;
          totalSamples += 1152;
          i += frameSize - 1;
        }
      }
    }
  }

  if (totalFrames === 0 || sampleRate === 0) {
    return buffer.length / (128 * 1000 / 8);
  }

  return totalSamples / sampleRate;
}
