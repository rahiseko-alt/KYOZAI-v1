# KYOZAI parity evidence protocol

この文書は実packageの由来とG6のblind内容評価を、自己申告ではなく第三者が再検証できる
外部証拠として残すための手順である。案件本文、原典、画像、字幕をリポジトリへ保存しない。

## 実package由来

1. 実Providerで生成したpackageを、CI実行環境または保存先から一時作業領域へ取得する。
2. `scripts/validate-blind-parity.mjs`をnormal modeで実行し、package digestを得る。
3. package本体を含めず、fixture ID、producer、digest、commit SHA、CI run URL、GitHub Attestation URLだけを
   `kyozai-real-package-evidence@1.0.0`に記録する。
4. `node scripts/validate-real-package-evidence.mjs <evidence.json>`で形式を検証する。

`attestationUrl`がないmetadata、ローカル一時領域だけの出力、または`evidenceMode: real`という自己申告だけは、
由来証明でもG6合格証拠でもない。G0で記録済みの検証結果も、この手順によるattestationが付くまで
破損検出の証拠に限定する。

## G6 blind内容評価

1. 各fixtureのSkill/APP packageを`candidateA`／`candidateB`へ無作為に割り当て、採点者へproducerを開示しない。
2. 各fixtureを独立した3名以上が、原典忠実性、学習順、台本実用性、視認性、納品完全性の5軸で1〜5点評価する。
3. 採点完了後にmappingを開示し、5fixtureすべての記録を
   `kyozai-blind-semantic-evidence@1.0.0`として保存する。
4. `node scripts/validate-blind-semantic-evidence.mjs <evidence.json>`で、重大な原典逸脱0件と、
   各軸のAPP中央値がSkillより0.5点を超えて低くないことを検査する。

このscriptは採点内容を生成しない。外部のblind採点記録を、機械的な合格条件へ照合するだけである。
