# Revision Contract

## Operation Types

| operation | 変更対象 | 必須の維持条件 |
|---|---|---|
| `text.replace` | 指定文字列 | 対象外文字列、layout、source |
| `text.rewrite` | 指定fieldまたはslide | 対象外slide、主張、source |
| `visual.replace-image` | 指定画像参照 | 表示文言、台本、layout |
| `visual.relayout-slide` | 指定slideの配置 | 表示文言、台本、source |
| `visual.restyle-deck` | 許可したdesign token | 内容、slide順、台本 |
| `slide.add` | 新規slide | 既存slide内容、source対応 |
| `slide.remove` | 指定slide | 残存slide内容、参照更新 |
| `slide.move` | slide順 | 各slide内容、参照更新 |
| `source.correct` | 主張、根拠、出典 | 無関係な主張、design |
| `version.restore` | 既存version全体 | 復元元のhash |

1つの依頼に複数operationがある場合は分割し、適用順と依存関係を記録する。

## Scope

各operationに次を必須とする。

- `targetSlides`: 対象slide。deck全体の場合も番号配列で明示する。
- `allowedFields`: 変更を許可するslide field map。
- `invariants`: 値の一致を要求するslide field map。
- `invariantChecks`: hash、根拠、artifact同期等の詳細な維持条件。
- `sourceConstraints`: 根拠の追加、維持、削除条件。
- `affectedArtifacts`: 台本、時間、Support、画像、manifest等の再検証対象。

`allowedFields`にない差分は不合格とする。対象slide内でも、許可されていないfieldは変えない。

## Versioning

- finalをimmutableとして扱う。
- 修正開始時に`base_version`とartifact hashを保存する。
- 出力を新しい`candidate_version`へ作る。
- 合格後だけ`current_version`参照をcandidateへ進める。
- 不合格時はcandidateをdraftに残し、currentを動かさない。
- restoreは既存versionを新しいcurrentとして参照し、過去ファイルを複製・上書きしない。

## Validation Order

1. JSON Schema
2. operationとscopeの整合
3. allowed/preserved field差分
4. sourceとartifact参照
5. 台本文字数と時間
6. 画像・レイアウト品質（該当時）
7. 指示達成の意味評価
8. final昇格条件

低い段階で不合格になった場合、後続生成や高価な評価を開始しない。

## Retry And Rollback

- 自動再試行は最大2回。
- 再試行でscopeを広げない。
- 不合格理由だけを次の試行へ渡す。
- 同じ不合格が続いたら旧finalを維持し、失敗理由を返す。
- rollback可能性は全試行前に確認する。
