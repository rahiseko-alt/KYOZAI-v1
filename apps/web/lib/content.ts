// 共通の文言・値の置き場所（AGENTS.md「結合を増やさない」1）。
// 2箇所以上で使う文言・値はここに1つ書いて参照する。
//
// HOME_HEADING はトップページの見出しであると同時に、CI の起動スモーク
// （scripts/smoke.sh の MARKER）が本文から探すマーカーでもある。変えるときは
// 両方を同時に直す（詳細は AGENTS.md「コマンド」節の「注意（値が結合している箇所）」）。
export const HOME_HEADING = "テンプレート起動確認";

/**
 * 見出しの下に添えるひとことを組み立てる。
 *
 * この関数自体に意味のある機能は無い。渡し方とチェックが本当に動いているかを
 * 確かめるための取っ掛かり（setup skill 手順2）で、tests/content.test.ts が
 * 実際に呼んで戻り値を検証する。
 */
export function buildHomeSubheading(now: Date): string {
  const year = now.getFullYear();
  return `${HOME_HEADING} — ${year}`;
}
