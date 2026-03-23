# Aivis Remotion Storyteller (Antigravity Skill)

このリポジトリは、**Antigravity**（AIエージェント）用の自動ショート動画生成スキルです。
高精細な画像と、Aivis Cloud APIによる自然な日本語音声合成（TTS）を組み合わせ、TikTokやInstagram Reels向けの縦型ショート動画をフルオート〜対話形式で生成します。

## 🌟 特徴 (Features)

本スキルは以下の役割分担によって動作します：

- **台本生成**: Antigravityの内部LLM処理により、与えられたテーマから魅力的なショート動画用の台本を考案します。
- **画像生成**: Antigravityの内部処理（`generate_image` ツール）を使用し、シーンごとのプロンプトから画像を生成します。
- **音声合成**: **Aivis Cloud API** を利用し、高品質で感情豊か・自然な日本語ナレーション音声を生成します。（日本語特化）
- **動画レンダリング**: **Remotion** を活用し、生成された画像・音声・字幕をタイムラインに沿って1本の動画（1080x1920）に書き出します。

## 🚀 使い方 (Getting Started)

### 1. 前提条件

- Node.js (v18以上推奨)
- Antigravity 環境
- Aivis Cloud API キー

### 2. 環境変数の設定

プロジェクトルートにある `.env.example` をコピーして `.env` ファイルを作成し、Aivis Cloud APIの情報を入力してください。

```env
AIVIS_API_KEY=your_api_key_here
AIVIS_MODEL_UUID=a59cb814-0083-4369-8542-f51a29e72af7
```

※ `AIVIS_MODEL_UUID` はAivisHubで公開されている任意の音声モデルUUIDに変更可能です。

### 3. Antigravityでの実行

Antigravityに対して以下のように指示を出してください：
> 「〇〇についてのショート動画を作成して」

エージェントが台本の提案、画像テイストの確認を行った後、全自動でアセットを生成し、Remotionで動画のレンダリングまで完了させます。

### 4. 手動でのプレビュー

生成された動画をブラウザでプレビューしたり、手動で再レンダリングする場合は以下のコマンドを使用します。

```bash
# パッケージのインストール
npm install

# Remotion Studio（プレビュー画面）の起動
npm run dev

# 手動での動画レンダリング
npx remotion render
```

## 🙏 レコメンド・参考元 (Credits & Recommendation)

このプロジェクトにおける動画のタイムライン処理やRemotionの基盤構成は、以下の素晴らしいテンプレートをベースに（レコメンドとして）使用し、日本語音声合成（Aivis）およびAntigravityでの自動化向けに改修を行いました。

- **Original Template**: [Remotion AI Video template (template-prompt-to-video)](https://github.com/remotion-dev/template-prompt-to-video)
- テンプレート作成者: [@webmonch](https://github.com/webmonch)
- **Remotion**: [https://www.remotion.dev/](https://www.remotion.dev/)

優れたツールキットとテンプレートエコシステムに深く感謝いたします。

## License

本プロジェクトのコードは元のテンプレートのライセンスに準拠します。使用条件や商用利用に関する詳細は [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) をご参照ください。
