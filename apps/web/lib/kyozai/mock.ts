import type { TeachingPackage } from "./types";

export const mockPackage: TeachingPackage = {
  designProfile: "kyozai-standard@1.0.0",
  title: "情報セキュリティ入門",
  targetAudience: "新入社員",
  durationMinutes: 5,
  sourceSummary: "日常業務で守るべき情報管理の基本と、迷ったときの初動を整理した教材です。",
  learningObjectives: ["情報の取り扱いルールを説明できる", "事故につながる行動を見分けられる", "異常時に適切な報告ができる"],
  slides: [
    { number: 1, layoutFamily: "cover", labels: [], theme: "情報管理の基本", role: "introduction", title: "情報セキュリティ入門", keyMessage: "日々の小さな判断で、会社と顧客の信頼を守る", bullets: ["情報の扱い方を知る", "異常時の初動を身につける"], speakerNotes: "今日は、情報セキュリティを専門部署だけの仕事ではなく、全員の日常動作として捉えます。身近な判断が会社と顧客の信頼につながることから始めます。" },
    { number: 2, layoutFamily: "compare", labels: ["守る共有", "避ける共有"], theme: "共有方法", role: "understanding", title: "共有は必要な相手と範囲に絞る", keyMessage: "便利さではなく、承認された方法を選びます。", bullets: ["承認済みの保存先を使う", "送信先と添付を確認する", "私物端末へ保存しない", "個人クラウドへ移さない"], speakerNotes: "左側を適切な共有、右側を避ける共有として比べます。送信前の一手間と、私物環境を使わない理由を具体的な業務場面で説明します。" },
    { number: 3, layoutFamily: "sequence", labels: [], theme: "不審連絡への初動", role: "practice", title: "怪しい連絡には三段階で対応する", keyMessage: "止まる、確認する、相談する。", bullets: ["リンクを開かず止まる", "送信元と内容を確認する", "指定窓口へ相談する"], speakerNotes: "急がせるメールほど、三つの順番を崩さないようにします。実際の受信場面を想像してもらい、最初のクリックを止めることが被害防止になると伝えます。" },
    { number: 4, layoutFamily: "focus", labels: [], theme: "情報管理の判断軸", role: "understanding", title: "判断の基準は承認されているかどうか", keyMessage: "迷ったら便利さより会社のルールを優先する", bullets: ["保存先を確認する", "共有相手を確認する", "不明点は担当者へ聞く"], speakerNotes: "日常業務では、早さや便利さを優先したくなる場面があります。そこで、会社が承認した方法かどうかを共通の判断軸にします。" },
    { number: 5, layoutFamily: "evidence", labels: [], theme: "早期報告の効果", role: "example", title: "早い報告ほど対応の選択肢が増える", keyMessage: "初動の速さが影響を小さくする", bullets: ["送信停止を依頼できる", "関係者へ早く連絡できる", "被害範囲を確認できる"], speakerNotes: "誤送信や不審な操作が起きたとき、報告が早ければ止められる処理が増えます。事実だけを整理し、速やかに共有する意味を説明します。" },
    { number: 6, layoutFamily: "checklist", labels: [], theme: "報告前の確認", role: "summary", title: "報告は三つの事実をそろえる", keyMessage: "推測より、分かっている事実を伝えます。", bullets: ["何が起きたか", "いつ気づいたか", "どこまで操作したか", "現在の端末状態"], speakerNotes: "報告時に詳しい原因分析は必要ありません。何が、いつ、どこまで起きたかを伝えることで、担当者が次の対応を判断しやすくなります。" },
    { number: 7, layoutFamily: "action", labels: [], theme: "受講後の行動", role: "action", title: "迷ったら、操作を止めてすぐ報告する", keyMessage: "今日から行うのは、自己判断で進めないこと。", bullets: ["端末操作を止める", "事実を整理する", "決められた窓口へ報告する"], speakerNotes: "最後に、受講後の具体的な一歩を確認します。責任追及を恐れて隠すより、早い報告が被害と影響を小さくすることを強調します。" },
  ],
  scenario: [
    { section: "導入", minutes: 1, guidance: "身近なヒヤリハットを問いかけ、今日の目的を共有します。" },
    { section: "基本ルール", minutes: 3, guidance: "各スライドを例とともに説明し、受講者に判断理由を尋ねます。" },
    { section: "確認とまとめ", minutes: 1, guidance: "ミニテストを実施し、報告先と初動を再確認します。" },
  ],
  faq: [
    { question: "判断に迷った場合はどうしますか？", answer: "操作を進めず、上司または指定窓口へ確認します。" },
    { question: "誤送信に気づいたらどうしますか？", answer: "自己判断で取り繕わず、直ちに指定窓口へ事実を報告します。" },
    { question: "私物端末で資料を確認できますか？", answer: "会社のルールで許可された端末と方法だけを使用します。" },
  ],
  quiz: [
    { question: "不審なリンクを受け取った最初の行動は？", options: ["すぐ開く", "同僚へ転送する", "送信元と内容を確認する"], answerIndex: 2, explanation: "リンクを開く前の確認が被害防止につながります。" },
    { question: "誤送信に気づいたとき優先することは？", options: ["削除して黙る", "すぐ報告する", "翌日相談する"], answerIndex: 1, explanation: "早い報告ほど対応の選択肢が増えます。" },
    { question: "業務資料の保存先として適切なのは？", options: ["個人クラウド", "私物USB", "会社が承認した保存先"], answerIndex: 2, explanation: "承認された環境だけを利用します。" },
  ],
};
