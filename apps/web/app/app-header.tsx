import Image from "next/image";
import { CircleHelp, Menu, X } from "lucide-react";

export function DevBadge() { return <span className="dev-badge">開発中</span>; }

export function AppHeader({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  return (
    <header className="topbar">
      <a className="brand" href="#top" aria-label="KYOZAI ホーム">
        <Image src="/brand/kyozai-logo.jpg" alt="KYOZAI 資料を、教えられる教材へ。" width={485} height={197} priority />
      </a>
      <nav aria-label="メインナビゲーション">
        <a className="active" href="#create">教材を作る</a>
        <button disabled>履歴 <DevBadge /></button>
        <button disabled>テンプレート <DevBadge /></button>
      </nav>
      <div className="top-actions"><button className="icon-button" title="ヘルプ（開発中）" disabled><CircleHelp size={20} /><span className="sr-only">ヘルプ（開発中）</span></button><span className="trial-label">TRIAL</span></div>
      <button className="menu-button icon-button" onClick={onMenu} aria-expanded={menuOpen} aria-label="メニューを開く">{menuOpen ? <X /> : <Menu />}</button>
    </header>
  );
}
