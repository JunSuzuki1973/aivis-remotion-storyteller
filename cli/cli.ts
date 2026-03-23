#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import prompts from "prompts";
import ora from "ora";
import chalk from "chalk";
import * as dotenv from "dotenv";
import {
  generateAiImage,
  generateVoice,
  getGenerateImageDescriptionPrompt,
  getGenerateStoryPrompt,
  openaiStructuredCompletion,
  setApiKey,
} from "./service";
import {
  ContentItemWithDetails,
  StoryMetadataWithDetails,
  StoryScript,
  StoryWithImages,
  Timeline,
} from "../src/lib/types";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { createTimeLineFromStoryWithDetails } from "./timeline";

dotenv.config({ quiet: true });

interface GenerateOptions {
  apiKey?: string;
  aivisApiKey?: string;
  aivisModelUuid?: string;
  title?: string;
  topic?: string;
}

class ContentFS {
  title: string;
  slug: string;

  constructor(title: string) {
    this.title = title;
    this.slug = this.getSlug();
  }

  saveDescriptor(descriptor: StoryMetadataWithDetails) {
    const dirPath = this.getDir();
    const filePath = path.join(dirPath, "descriptor.json");
    fs.writeFileSync(filePath, JSON.stringify(descriptor, null, 2));
  }

  saveTimeline(timeline: Timeline) {
    const dirPath = this.getDir();
    const filePath = path.join(dirPath, "timeline.json");
    fs.writeFileSync(filePath, JSON.stringify(timeline, null, 2));
  }

  getDir(dir?: string): string {
    const segments = ["public", "content", this.slug];
    if (dir) {
      segments.push(dir);
    }
    const p = path.join(process.cwd(), ...segments);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  getImagePath(uid: string): string {
    const dirPath = this.getDir("images");
    return path.join(dirPath, `${uid}.png`);
  }

  getAudioPath(uid: string): string {
    const dirPath = this.getDir("audio");
    return path.join(dirPath, `${uid}.mp3`);
  }

  getSlug(): string {
    return this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}

async function generateStory(options: GenerateOptions) {
  try {
    let apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    let aivisApiKey =
      options.aivisApiKey || process.env.AIVIS_API_KEY;
    const aivisModelUuid =
      options.aivisModelUuid ||
      process.env.AIVIS_MODEL_UUID ||
      "a59cb814-0083-4369-8542-f51a29e72af7";

    if (!apiKey) {
      const response = await prompts({
        type: "password",
        name: "apiKey",
        message: "Enter your OpenAI API key:",
        validate: (value) => value.length > 0 || "API key is required",
      });

      if (!response.apiKey) {
        console.log(chalk.red("API key is required. Exiting..."));
        process.exit(1);
      }

      apiKey = response.apiKey;
    }

    if (!aivisApiKey) {
      const response = await prompts({
        type: "password",
        name: "aivisApiKey",
        message: "Enter your Aivis Cloud API key:",
        validate: (value) =>
          value.length > 0 || "Aivis API key is required",
      });

      if (!response.aivisApiKey) {
        console.log(chalk.red("Aivis API key is required. Exiting..."));
        process.exit(1);
      }

      aivisApiKey = response.aivisApiKey;
    }

    let { title, topic } = options;

    if (!title || !topic) {
      const response = await prompts([
        {
          type: "text",
          name: "title",
          message: "Title of the story:",
          initial: title,
          validate: (value) => value.length > 0 || "Title is required",
        },
        {
          type: "text",
          name: "topic",
          message: "Topic of the story:",
          initial: topic,
          validate: (value) => value.length > 0 || "Topic is required",
        },
      ]);

      if (!response.title || !response.topic) {
        console.log(chalk.red("Title and topic are required. Exiting..."));
        process.exit(1);
      }

      title = response.title;
      topic = response.topic;
    }

    console.log(chalk.blue(`\n📖 Creating story: "${title}"`));
    console.log(chalk.blue(`📝 Topic: ${topic}\n`));

    const storyWithDetails: StoryMetadataWithDetails = {
      shortTitle: title!,
      content: [],
    };

    const storySpinner = ora("Generating story...").start();
    setApiKey(apiKey!);
    const storyRes = await openaiStructuredCompletion(
      getGenerateStoryPrompt(title!, topic!),
      StoryScript,
    );
    storySpinner.succeed(chalk.green("Story generated!"));

    const descriptionsSpinner = ora("Generating image descriptions...").start();
    const storyWithImagesRes = await openaiStructuredCompletion(
      getGenerateImageDescriptionPrompt(storyRes.text),
      StoryWithImages,
    );
    descriptionsSpinner.succeed(chalk.green("Image descriptions generated!"));

    for (const item of storyWithImagesRes.result) {
      const contentWithDetails: ContentItemWithDetails = {
        text: item.text,
        imageDescription: item.imageDescription,
        uid: uuidv4(),
        durationSeconds: 0,
      };

      storyWithDetails.content.push(contentWithDetails);
    }

    const contentFs = new ContentFS(title!);
    contentFs.saveDescriptor(storyWithDetails);

    const totalScenes = storyWithDetails.content.length;
    let completedTasks = 0;
    const totalTasks = totalScenes * 2; // image + voice per scene

    const assetsSpinner = ora(
      `Generating images and voice in parallel... [0/${totalTasks}]`,
    ).start();

    const updateProgress = () => {
      completedTasks++;
      assetsSpinner.text = `Generating images and voice in parallel... [${completedTasks}/${totalTasks}]`;
    };

    // 全シーンの画像生成と音声合成を並列実行
    await Promise.all(
      storyWithDetails.content.map(async (storyItem, i) => {
        // 各シーン内で画像と音声を同時に生成
        const [, voiceResult] = await Promise.all([
          generateAiImage({
            prompt: storyItem.imageDescription,
            path: contentFs.getImagePath(storyItem.uid),
            onRetry: () => {},
          }).then(() => {
            updateProgress();
          }),
          generateVoice(
            storyItem.text,
            aivisApiKey!,
            contentFs.getAudioPath(storyItem.uid),
            aivisModelUuid,
          ).then((result) => {
            updateProgress();
            return result;
          }),
        ]);

        storyItem.durationSeconds = voiceResult.durationSeconds;
      }),
    );

    contentFs.saveDescriptor(storyWithDetails);
    assetsSpinner.succeed(
      chalk.green(`Images and voice generated! (${totalScenes} scenes, parallel)`),
    );

    const finalSpinner = ora("Generating final result...").start();
    const timeline = createTimeLineFromStoryWithDetails(storyWithDetails);
    contentFs.saveTimeline(timeline);
    finalSpinner.succeed(chalk.green("Final result generated!"));

    console.log(chalk.green.bold("\n✨ Story generation complete!\n"));
    console.log("Run " + chalk.blue("npm run dev") + " to preview the story");

    return {};
  } catch (error) {
    console.error(chalk.red("\n❌ Error:"), error);
    process.exit(1);
  }
}

yargs(hideBin(process.argv))
  .command(
    "generate",
    "Generate story timeline for given title and topic",
    (yargs) => {
      return yargs
        .option("api-key", {
          alias: "k",
          type: "string",
          description: "OpenAI API key",
        })
        .option("aivis-api-key", {
          type: "string",
          description: "Aivis Cloud API key",
        })
        .option("aivis-model-uuid", {
          type: "string",
          description: "Aivis voice model UUID",
        })
        .option("title", {
          alias: "t",
          type: "string",
          description: "Title of the story",
        })
        .option("topic", {
          alias: "p",
          type: "string",
          description:
            "Topic of the story (e.g. Interesting Facts, History, etc.)",
        });
    },
    async (argv) => {
      await generateStory({
        apiKey: argv["api-key"],
        aivisApiKey: argv["aivis-api-key"],
        aivisModelUuid: argv["aivis-model-uuid"],
        title: argv.title,
        topic: argv.topic,
      });
    },
  )
  .command(
    "$0",
    "Generate a story (default command)",
    (yargs) => {
      return yargs
        .option("api-key", {
          alias: "k",
          type: "string",
          description: "OpenAI API key",
        })
        .option("aivis-api-key", {
          type: "string",
          description: "Aivis Cloud API key",
        })
        .option("aivis-model-uuid", {
          type: "string",
          description: "Aivis voice model UUID",
        })
        .option("title", {
          alias: "t",
          type: "string",
          description: "Title of the story",
        })
        .option("topic", {
          alias: "p",
          type: "string",
          description:
            "Topic of the story (e.g. Interesting Facts, History, etc.)",
        });
    },
    async (argv) => {
      await generateStory({
        apiKey: argv["api-key"],
        aivisApiKey: argv["aivis-api-key"],
        aivisModelUuid: argv["aivis-model-uuid"],
        title: argv.title,
        topic: argv.topic,
      });
    },
  )
  .demandCommand(0, 1)
  .help()
  .alias("help", "h")
  .version()
  .alias("version", "v")
  .strict()
  .parse();
