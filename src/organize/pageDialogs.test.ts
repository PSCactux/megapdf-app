import { describe, expect, it } from "vitest";
import { describePages } from "./PageDialogs";

describe("describePages", () => {
  it("agrupa páginas consecutivas en rangos, numeradas desde 1", () => {
    expect(describePages([0, 1, 2, 4])).toBe("1-3, 5");
    expect(describePages([6, 2, 3])).toBe("3-4, 7");
    expect(describePages([0])).toBe("1");
    expect(describePages([])).toBe("");
  });
});
