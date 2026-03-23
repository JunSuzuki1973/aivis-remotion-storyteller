import { loadFont } from "@remotion/google-fonts/NotoSansJP";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import { z } from "zod";
import { FPS, INTRO_DURATION } from "../lib/constants";
import { TimelineSchema } from "../lib/types";
import { calculateFrameTiming, getAudioPath } from "../lib/utils";
import { Background } from "./Background";
import Subtitle from "./Subtitle";

export const aiVideoSchema = z.object({
  timeline: TimelineSchema.nullable(),
});

const { fontFamily } = loadFont();

export const AIVideo: React.FC<z.infer<typeof aiVideoSchema>> = ({
  timeline,
}) => {
  if (!timeline) {
    throw new Error("Expected timeline to be fetched");
  }

  const { id } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "white" }}>
      <Sequence durationInFrames={INTRO_DURATION}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            display: "flex",
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: 80,
              lineHeight: "96px",
              width: "87%",
              color: "white",
              fontFamily,
              fontWeight: "bold",
              backgroundColor: "rgba(0, 0, 0, 0.75)",
              paddingTop: 24,
              paddingBottom: 24,
              paddingLeft: 16,
              paddingRight: 16,
              borderRadius: 16,
            }}
          >
            {timeline.shortTitle}
          </div>
        </AbsoluteFill>
      </Sequence>

      {timeline.elements.map((element, index) => {
        const { startFrame, duration } = calculateFrameTiming(
          element.startMs,
          element.endMs,
          { includeIntro: index === 0 },
        );

        return (
          <Sequence
            key={`element-${index}`}
            from={startFrame}
            durationInFrames={duration}
            premountFor={3 * FPS}
          >
            <Background project={id} item={element} />
          </Sequence>
        );
      })}

      {timeline.text.map((element, index) => {
        const { startFrame, duration } = calculateFrameTiming(
          element.startMs,
          element.endMs,
          { addIntroOffset: true },
        );

        return (
          <Sequence
            key={`element-${index}`}
            from={startFrame}
            durationInFrames={duration}
          >
            <Subtitle key={index} text={element.text} />
          </Sequence>
        );
      })}

      {timeline.audio.map((element, index) => {
        const { startFrame, duration } = calculateFrameTiming(
          element.startMs,
          element.endMs,
          { addIntroOffset: true },
        );

        return (
          <Sequence
            key={`element-${index}`}
            from={startFrame}
            durationInFrames={duration}
            premountFor={3 * FPS}
          >
            <Audio src={staticFile(getAudioPath(id, element.audioUrl))} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
