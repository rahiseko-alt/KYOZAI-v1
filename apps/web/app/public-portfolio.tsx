import Image from "next/image";

import { HOME_HEADING } from "../lib/content";

const deliverables = ["教材スライド", "講師シナリオ", "FAQ", "確認テスト"];
const stages = ["資料分析", "構成設計", "内容凍結", "画像生成", "機械検証", "納品ZIP"];

export function PublicPortfolio() {
  return (
    <main className="app-shell public-portfolio" id="top">
      <header className="topbar public-topbar">
        <a className="brand" href="#top" aria-label="KYOZAI ホーム">
          <Image src="/brand/kyozai-logo.jpg" alt="KYOZAI 資料を、教えられる教材へ。" width={485} height={197} priority />
        </a>
        <span className="trial-label">PORTFOLIO</span>
      </header>
      <div className="beta-strip public-status"><span>限定公開</span>生成デモは安全性と費用保護の再検証中です。</div>
      <section className="workspace public-hero">
        <div className="intro">
          <p className="eyebrow">KYOZAI — AI教材制作パイプライン</p>
          <h1>{HOME_HEADING}</h1>
          <p>資料を分析し、教える順序・講師台本・スライド画像・検証証跡を一つの工程で組み立てる教材制作システムです。</p>
        </div>
        <div className="public-notice" role="status">
          <strong>生成機能は現在、一般公開していません</strong>
          <p>公開環境では入力資料の受付とAI生成を停止しています。認証された検証環境で安全性・費用上限・長時間処理を確認した後、公開可否を判断します。</p>
        </div>
        <section className="public-section" aria-labelledby="deliverables-heading">
          <p className="eyebrow">OUTPUT</p>
          <h2 id="deliverables-heading">一度の入力から、教えるための一式へ</h2>
          <div className="public-card-grid">
            {deliverables.map((item, index) => <article key={item}><span>0{index + 1}</span><h3>{item}</h3><p>{index === 0 ? "1枚1テーマの完成画像" : index === 1 ? "300文字/分で時間を算出" : index === 2 ? "想定質問と根拠付き回答" : "理解確認と解説"}</p></article>)}
          </div>
        </section>
        <section className="public-section public-process" aria-labelledby="process-heading">
          <p className="eyebrow">PROCESS</p>
          <h2 id="process-heading">生成しただけで終わらせない工程</h2>
          <ol>{stages.map((stage, index) => <li key={stage}><span>{index + 1}</span><strong>{stage}</strong></li>)}</ol>
          <p className="public-caption">工程、判断基準、停止条件、検証結果を成果物へ保存し、通過した段階だけを完了として扱います。</p>
        </section>
      </section>
    </main>
  );
}
