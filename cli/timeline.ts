import type {
  BackgroundElement,
  ElementAnimation,
  StoryMetadataWithDetails,
  TextElement,
  Timeline,
} from "../src/lib/types";

export const createTimeLineFromStoryWithDetails = (
  storyWithDetails: StoryMetadataWithDetails,
): Timeline => {
  const timeline: Timeline = {
    elements: [],
    text: [],
    audio: [],
    shortTitle: storyWithDetails.shortTitle,
  };

  let durationMs = 0;
  let zoomIn = true;

  for (let i = 0; i < storyWithDetails.content.length; i++) {
    const content = storyWithDetails.content[i];

    const lenMs = Math.ceil(content.durationSeconds * 1000);

    const bgElem: BackgroundElement = {
      startMs: durationMs,
      endMs: durationMs + lenMs,
      imageUrl: content.uid,
      enterTransition: "blur",
      exitTransition: "blur",
      animations: getBgAnimations(lenMs, zoomIn),
    };

    timeline.elements.push(bgElem);
    timeline.audio.push({
      startMs: durationMs,
      endMs: durationMs + lenMs,
      audioUrl: content.uid,
    });

    // 日本語対応の文字ベース字幕分割
    const textElements = splitTextForSubtitles(content.text, durationMs, lenMs);
    timeline.text.push(...textElements);

    durationMs += lenMs;
    zoomIn = !zoomIn;
  }

  return timeline;
};

/**
 * テキストを字幕用に分割する
 * 日本語（句読点・文字数ベース）と英語（スペース区切り）の両方に対応
 */
function splitTextForSubtitles(
  text: string,
  baseMs: number,
  totalLenMs: number,
): TextElement[] {
  const MAX_CHARS = 12;
  const elements: TextElement[] = [];
  const segments: string[] = [];

  // 句読点・記号で区切りつつ、MAX_CHARS以内に収める
  let current = "";

  for (let i = 0; i < text.length; i++) {
    current += text[i];

    const isBreakChar =
      text[i] === "。" ||
      text[i] === "、" ||
      text[i] === "！" ||
      text[i] === "？" ||
      text[i] === "." ||
      text[i] === "," ||
      text[i] === "!" ||
      text[i] === "?" ||
      text[i] === "\n";

    if (current.length >= MAX_CHARS || isBreakChar) {
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

  // 各セグメントに時間を均等に割り当て（文字数比例）
  const totalChars = segments.reduce((sum, s) => sum + s.length, 0);
  const msPerChar = totalLenMs / totalChars;
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

export const getBgAnimations = (durationMs: number, zoomIn: boolean) => {
  const animations: ElementAnimation[] = [];

  const startMs = 0;
  const endMs = durationMs;

  const scaleFrom = zoomIn ? 1.5 : 1;
  const scaleTo = zoomIn ? 1 : 1.5;

  animations.push({
    type: "scale",
    from: scaleFrom,
    to: scaleTo,
    startMs,
    endMs,
  });

  return animations;
};

export const getTextAnimations = () => {
  const animations: ElementAnimation[] = [];

  const durationMs = 300;

  const startMs = 0;
  const endMs = durationMs;

  // eslint-disable-next-line @remotion/deterministic-randomness
  const startScale = Math.random() * 0.2 + 0.5;
  // eslint-disable-next-line @remotion/deterministic-randomness
  const dontScale = Math.random() > 0.6;
  // eslint-disable-next-line @remotion/deterministic-randomness
  const bounces = Math.random() > 0.5;

  animations.push({
    type: "scale",
    from: dontScale ? 1 : startScale,
    to: bounces ? 1.25 : 1,
    startMs,
    endMs,
  });

  if (bounces) {
    animations.push({
      type: "scale",
      from: 1.25,
      to: 1,
      startMs: endMs,
      endMs: endMs + 200,
    });
  }

  return animations;
};
