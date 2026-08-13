import type { Slide } from "@/lib/kyozai/types";
import { layoutClass, splitItems } from "@/lib/kyozai/design";

function BulletList({ items }: { items: string[] }) {
  return <ul className="kz-bullets">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function SlideBody({ slide }: { slide: Slide }) {
  if (slide.layoutFamily === "cover") {
    return <div className="kz-cover-body"><p className="kz-key-message">{slide.keyMessage}</p><div className="kz-cover-points">{slide.bullets.map((item, index) => <span key={item}><b>{String(index + 1).padStart(2, "0")}</b>{item}</span>)}</div></div>;
  }
  if (slide.layoutFamily === "compare") {
    const [left, right] = splitItems(slide.bullets);
    return <div className="kz-compare"><section><span>{slide.labels[0]}</span><BulletList items={left} /></section><section><span>{slide.labels[1]}</span><BulletList items={right} /></section></div>;
  }
  if (slide.layoutFamily === "sequence") {
    return <ol className="kz-sequence">{slide.bullets.map((item, index) => <li key={item}><b>{index + 1}</b><span>{item}</span></li>)}</ol>;
  }
  if (slide.layoutFamily === "evidence") {
    return <div className="kz-evidence"><strong>{slide.keyMessage}</strong><BulletList items={slide.bullets} /></div>;
  }
  if (slide.layoutFamily === "checklist") {
    return <div className="kz-checklist">{slide.bullets.map((item) => <p key={item}><span>✓</span>{item}</p>)}</div>;
  }
  if (slide.layoutFamily === "action") {
    return <div className="kz-action"><p>{slide.keyMessage}</p><ol>{slide.bullets.map((item, index) => <li key={item}><b>{index + 1}</b>{item}</li>)}</ol></div>;
  }
  return <div className="kz-focus"><strong>{slide.keyMessage}</strong><BulletList items={slide.bullets} /></div>;
}

export function SlideArtwork({ slide, total }: { slide: Slide; total: number }) {
  return (
    <div className={`kz-slide ${layoutClass(slide.layoutFamily)}`} data-layout={slide.layoutFamily}>
      <div className="kz-slide-header"><span aria-hidden="true" /><span>{String(slide.number).padStart(2, "0")} / {String(total).padStart(2, "0")}</span></div>
      <h2>{slide.title}</h2>
      <div className="kz-title-rule" />
      <SlideBody slide={slide} />
    </div>
  );
}
