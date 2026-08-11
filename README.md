# Codex Slide Maker

YouTube URLや台本を、検証済みの日本語教材スライド画像一式へ変換するCodex Skillを開発するリポジトリです。

## 収録Skill

- [`teaching-slide-package`](skills/teaching-slide-package/SKILL.md)
  - YouTubeのメタデータと日本語字幕を`yt-dlp`で取得
  - 1スライド1テーマで内容、表示文言、講師台本、時間、構図を設計
  - Codex組み込み`image_gen`でスライド画像を1枚ずつ生成
  - 画像検証、モンタージュ、再生成用プロンプト、ZIPをまとめて納品

標準デザインは、白背景、太い黒見出し、鮮明な青の罫線と強調、黒と青の線画図解です。内容ごとに比較、工程、円環、関係図などの構図を変えます。

## インストール

Codexに次のGitHubパスからインストールするよう依頼します。

```text
https://github.com/rahiseko-alt/Codex-slide-maker/tree/main/skills/teaching-slide-package
```

ローカルのSkill Installerを直接使う場合の例:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" `
  --repo rahiseko-alt/Codex-slide-maker `
  --path skills/teaching-slide-package
```

既に同名Skillがある場合、Installerは上書きしません。既存Skillを退避または削除してから再実行します。

## 実行要件

- Codexの組み込み`imagegen` Skillと`image_gen`ツール
- `yt-dlp`。YouTube URLを入力にする場合のみ必要
- PNGの寸法確認とモンタージュ作成に使える画像処理ランタイム

APIキーや外部画像生成サービスは不要です。動画、字幕、生成画像、顧客資料などの案件固有成果物はこの公開リポジトリへ保存しません。

## 開発

Skill構造の検証:

```bash
pnpm validate:skills
```

リポジトリ全体の既存チェック:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
