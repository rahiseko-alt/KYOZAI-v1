import { describe, expect, it } from "vitest";
import { planRevision } from "../lib/kyozai/revision-plan";

describe("revision scope planning", () => {
  it("keeps a visual-only slide edit local", () => {
    expect(planRevision("スライド2の画像配置だけ直して", [1, 2, 3])).toMatchObject({ operation: "visual.relayout-slide", impactScope: "visual_only", targetSlides: [2] });
  });
  it("expands structural instructions instead of pretending they are local", () => {
    expect(planRevision("全体の順番を変更して", [1, 2, 3])).toMatchObject({ operation: "slide.move", impactScope: "structural", targetSlides: [1, 2, 3] });
  });
});
