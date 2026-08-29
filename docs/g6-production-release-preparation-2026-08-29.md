# G6準備: 5 fixture blind比較・由来証明・Production再開チェックリスト

制定: 2026-08-29  
状態: **準備のみ。G1がactiveの間は実装・fixture実行・Gate状態の変更をしない。**  
親Gate: G1（`shared/kyozai-parity-goal.json`）  
ゴールへの寄与: G1--G5の実証が揃った後、5入力のSkill／APP同等性とProduction再開を、再検証可能な外部証拠で判定できるようにする。  
G6合格証拠: `five_fixture_blind_evidence`、`production_pc_mobile_e2e`、`production_url_and_commit_sha`。

これは実行正本[`skill-app-parity-execution-plan-2026-08-26.md`](skill-app-parity-execution-plan-2026-08-26.md)と、既存の[`evidence-protocol.md`](evidence-protocol.md)を実行可能な判定順へ展開する。実案件本文、原典PDF、字幕、参考画像、生成package、Accessトークン、provider keyはここにもリポジトリにも保存しない。

## 0. G6を開始できる条件

G6の作業PRを作る前に、下表の全てが外部事実として存在することを確認する。不足が1つでもあれば`productionGeneration`は`locked_404`のままとし、先行Gateを完了扱いにしない。

| 前提Gate | 再確認する実証 | 必要な外部証拠 |
| --- | --- | --- |
| G1 | direct text の実Provider縦断、停止回復、二重課金なし、usage突合 | Preview run、D1/R2 readback hash、provider usage、CI URL、commit SHA |
| G2 | 長文PDFとMarkdownの原典／chunk／ZIP整合 | 各Preview run、原典・manifest・ZIPの相互hash、CI URL、commit SHA |
| G3 | 字幕付きYouTubeと参考デザイン | 実字幕／原本画像・design profileの由来hash、各Preview run、CI URL、commit SHA |
| G4 | 3自然言語revision、対象外差分ゼロ、旧版とrestore | revisionごとの差分記録、旧版／復元readback、provider usage、CI URL、commit SHA |
| G5 | 期限切れ、削除、rehash、provider故障のfail-closed | Cron記録、D1 lease記録、R2 object不存在readback、SLO report、CI URL、commit SHA |

この再確認はG6の代替証拠ではない。各行のGate statusが`completed`であり、そのGateのevidenceが実runを指して初めて次へ進める。

## 1. package採取と由来attestation

fixtureごとに、同一の正規化済み入力をSkillとAPPへ一回ずつ与える。5 fixtureは目標正本の`direct_text`、`long_pdf`、`youtube_captioned`、`reference_design`、`natural_language_revision`で固定する。

1. Skill／APP双方の最終packageを、CI実行環境または認可済み一時保管領域へ取得する。packageをGit、Issue、PR、attestation metadataへ入れない。
2. 各packageを展開した一時領域で、normal modeの`node scripts/validate-blind-parity.mjs --skill <path> --app <path> --out <path>`を実行する。`--allow-contract-fixture`は使用しない。fixture ID、source hash、工程契約、manifest、PNG hash、stage ledgerが一致しなければ、そのfixtureは不合格である。
3. SkillとAPPを別々に、`kyozai-real-package-evidence@1.0.0`として記録する。各recordは`node scripts/validate-real-package-evidence.mjs <evidence.json>`に通し、`fixtureId`、producer、package digest、検証時刻、commit SHA、CI run URL、GitHub Attestation URL、`contentIncluded: false`を全て持つ。
4. Attestationは実際に検証したpackage bytesを対象にし、閲覧者がGitHub上で検証できるURLを指す。ローカル出力、`evidenceMode: real`、自己申告のdigestだけは不合格である。

必要件数は最低10 record（5 fixture × Skill／APP）である。1入力について片方だけのattestation、異なるcommitの無関係なattestation、正常系だけを選択したpackageは認めない。

### G6-EVID-001: 現行evidence schemaの実装前確認

現行の`kyozai-real-package-evidence` schemaは個別packageの由来を検証できる。一方、`kyozai-blind-semantic-evidence` schemaはscoreと全体のcandidate mappingだけを持ち、採点対象を上の10個のdigestへ機械的に結び付けない。またmappingは全fixture共通であり、fixtureごとの独立した無作為割当を表せない。

従ってG6実装PRでは、次のどちらかを**実装前に**決定し、schema／validator／テストとevidence protocolを一緒に更新する必要がある。

- fixtureごとの候補割当と、各candidateのpackage digest・attestation URLを記録できるversioned evidence formatへ拡張する。
- 全fixtureに適用する一度だけの無作為割当を、採点開始前に封印し、既存schemaの全体mappingと一対一に対応させる。その封印記録と10 recordの対応表を、内容を含まない外部evidence indexへ残す。

いずれも採点結果を後からproducerへ合わせて編集できないことを示すための条件である。G6実装までこの文書だけで同問題を「解決済み」にしてはならない。

## 2. blind内容評価の運用

採点の独立性を守るため、実行者、候補を無名化する担当者、採点者を分離する。最低3名の採点者は全員、mapping公開前に採点を確定する。採点者には`candidateA`と`candidateB`、fixtureの原典を確認するために必要な認可済み表示だけを渡し、producer、commit、PR、provider、attestation URLを渡さない。

各fixture・各candidateについて、以下の5軸を1--5点で記録する。

- `source_fidelity`
- `learning_sequence`
- `speaker_script_usability`
- `visual_legibility`
- `delivery_completeness`

重大な原典逸脱は採点者ごとに`severeSourceDeviationCount`へ記録する。全採点を確定してからmappingを公開し、`node scripts/validate-blind-semantic-evidence.mjs <evidence.json>`を実行する。機械合格は、5 fixtureすべて、各fixtureに異なるaliasの採点者3名以上、重大逸脱0件、かつ各軸のAPP中央値がSkill中央値より0.5点を超えて低くないことである。

採点記録には本名や案件内容を残さない。外部evidence indexには採点者alias、採点確定時刻、mapping公開時刻、validator結果、10個のprovenance recordへの参照だけを残す。

## 3. Production再開用のE2E設計

現在のProduction E2Eと`.github/workflows/prod-smoke.yml`は、公開portfolioと全生成入口の404を正しく検査する。これを先に緩めない。G6最終PRで、全前提・section 1・section 2の結果をreviewできる状態になってから、認証済みProduction向けの専用E2Eを追加／置換する。

Production E2Eは既存のlocal `KYOZAI_E2E_MODE`や固定Preview値を使わず、実Production URLを対象にする。Accessの認証情報とfixture入力は利用者がVercel／Cloudflare／認可済み実行環境へ直接設定し、コード、ログ、artifact、PR本文へ出さない。

| 観点 | PC（desktop） | mobile（Pixel 5相当） | 必須結果 |
| --- | --- | --- | --- |
| 未認証境界 | API／job URL／artifact URLへ直接アクセス | 同左 | Access外と所有者違いは同じ404。存在／所有者を漏らさない。 |
| 認証済み作成 | 予算上限内のdirect-text jobを1件だけ作成 | 作成済みjobを表示する | idempotency再送でprovider二重呼出し0。 |
| 実行と回復 | dispatch停止境界を含む既定の実行／回復を観測 | terminal statusを再読込して表示 | D1 stage ledger、usage、R2 readback hash、final ZIP hashが一致。 |
| 納品 | 自身のfinal artifactを取得してpackage validatorを通す | 自身のjob／artifact表示と横スクロールなしを確認 | 他者artifactは404、本人artifactのみhash一致。 |

PCとmobileで同一jobを共有するときは、PCが作成したownerとmobileの認証済みactorが同一であることを明示的に確認する。mobileで別jobを作って費用を二重に使わない。PCとmobileのどちらかが失敗したらProduction解錠は不合格である。

Productionの安全回帰として、`VERCEL_ENV=production`で`KYOZAI_E2E_MODE=1`でもE2E convenienceが有効にならないこと、無認証・別所有者の各入口が非存在応答になること、rate／quota超過がprovider呼出し前にfail-closedとなることをCIで維持する。Production E2Eの成功だけでこれらを置き換えない。

## 4. 解錠の順序と最終evidence index

1. G1--G5のcompleted statusと外部evidenceを確認する。
2. section 1の10 provenance recordとsection 2のblind semantic evidenceを検証する。
3. G6 PRのCI（typecheck、lint、unit／contract、build、smoke、PC／mobile E2E、依存監査）を同一commitで成功させる。build、smoke、E2Eは同じ`.next`を競合して使わないため直列とする。
4. Productionへそのcommitが配備されたことを`/api/health`のcommit SHAで確認する。
5. section 3の認証済み実Production E2Eを実施し、同一commit、Production URL、CI URL、D1/R2 readback hash、provider usage突合を外部evidence indexへ記録する。
6. ここまで全て成功したときだけ、`shared/kyozai-parity-goal.json`を`status: completed`、`activeGate: null`、`productionGeneration: authenticated_enabled`へ更新し、G6のgapsを空にして上記外部evidenceを列挙する。

途中で失敗・証拠欠落・attestation不一致・所有者境界漏れ・想定外provider呼出しが起きたら、解錠を行わず404 lockを維持する。既に解錠後に検知した場合は生成を再びfail-closedにし、事実、影響、復旧確認を`docs/failures.md`へappend-onlyで記録する。

最終evidence indexは内容を含めず、少なくとも次の参照だけを記録する。

- 5 fixture × Skill／APPのprovenance evidenceとattestation URL
- normal-mode parity validatorの結果とpackage digest
- blind semantic evidence、採点確定／mapping公開時刻、validator結果
- G1--G5の必要evidenceへの参照
- 解錠commit SHA、G6 CI run URL、Production URL、health確認時刻
- PC／mobile実Production E2E、D1/R2 readback、provider usage突合への参照

これらは「実装した」という自己申告の代わりに、第三者が期限後にも辿れる合格根拠である。
