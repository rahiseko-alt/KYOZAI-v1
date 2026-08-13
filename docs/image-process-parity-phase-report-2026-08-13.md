# KYOZAI 画像工程同等化 実装・検証報告書

作成日: 2026-08-13
対象ブランチ: `codex/image-process-parity`
状態: Draft。公開切替前
未完成であるため、このPhaseを公開完成とは判定しない。
## 1. 今回の決定

画像生成モデルは固定しない。教材生成と画像を伴う修正のたびに、利用者が次の3候補から明示選択する。

- `gemini-3.1-flash-lite-image` 1K / 16:9
- `gemini-3.1-flash-image` 1K / 16:9
- `gpt-image-2-2026-04-21` medium / 2048x1152

未選択ではUIとAPIの両方が生成を拒否する。教材構成と画像QAは`gpt-5.5`を使用する。

## 2. 実装済み

- 正本`kyozai-slide` Skillは変更していない。
- 教材生成時に、凍結教材hash、選択モデル、枚数、有効期限を持つ署名grantを発行する。
- 画像APIは署名された教材と選択モデルの組だけを受理する。
- 1ページ1画像requestとし、通信timeout時は二重課金防止のため自動再送しない。
- 実画像のmagic bytes、provider寸法、16:9、decode、白紙、納品寸法`1672x941`を検査する。
- `gpt-5.5`で誤字、欠落、余計な文字、切れ、重なり、コントラスト、可読性を検査する。
- 画像QA不合格または構造不良ページだけを1回再生成する。
- 合格済みPNGの同じbase64を、プレビュー、個別PNG取得、HTML、ZIPへ使用する。
- ZIP作成時にPNG実bytesからSHA-256を再計算し、API申告hashとの不一致を拒否する。
- ZIPへdeck spec、台本、source info、全prompt、全validation、全PNG、montage、manifest、HTMLを格納する。
- 選択モデル、provider snapshot、quality、QAモデルをprompt記録とmanifestへ残す。
- 新工程は`PROCESS_PARITY_PIPELINE_ENABLED=1`のときだけ動作する。

## 3. 3視点の敵対検証

### プロダクト・工程

- 合格: 手動キャンバス編集、自由配置、プロパティパネルは追加していない。
- 合格: 画像モデルは生成ごとの必須選択で、既定値はない。
- 修正済み: feature flag無視、任意教材JSONの画像化、完成PNG同一性の未検証。
- 未完: 永続job、リロード再開、別端末履歴、耐久stage ledger。

### API・費用・安全性

- 修正済み: timeoutと429時の画像API自動再送。現在は結果不明時に停止する。
- 修正済み: Gemini requestの余計なfield、レスポンスの過剰再帰探索、実MIME未検査。
- 修正済み: OpenAI alias利用。現在は固定snapshotとqualityを記録する。
- 残課題: 公開費用上限を強制する認証付き分散rate limitは永続job Phaseで実装する。

### QA・納品

- 合格: 単体39件、desktop/mobile E2E 3件、build、smoke、typecheck、lint、依存監査。
- 合格: E2EでZIPを展開し、全7 PNGの寸法、実bytes hash、manifest、個別PNGとの一致を検査した。
- 合格: montageを実PNGとして生成・格納する。
- 未完: montageを入力にした全体統一感のAI判定と、失敗ページだけの再生成。

## 4. 公開前ゲート

1. `GEMINI_API_KEY`を利用者がVercelへ直接登録する。値はエージェントへ渡さない。
2. `PROCESS_PARITY_PIPELINE_ENABLED=1`をproductionへ設定する。
3. 3候補を同じfixtureで実モデルforward-testし、文字・構造・費用・P95時間を記録する。
4. 認証付き分散rate limitと月額費用停止flagを接続する。
5. montage全体QA、永続job、再開、final artifact storageを実装する。
6. 全ゲート合格後にDraftを解除し、本番URLで3モデルの成功・拒否・ZIPを確認する。

## 5. 判定

モデル固定の誤りは解消した。モデル選択、1枚単位生成、実画像QA、ページ単位再生成、完成PNG同一利用、
納品hash検証の細い縦断は実装済みである。ただし、正本Skillと同等の耐久実行・永続履歴・montage全体QAは
未完成であるため、このPhaseを公開完成とは判定しない。
