import { afterEach, describe, expect, it, vi } from "vitest";
import { clickedLine, selectedSpan } from "./diff-selection";

describe("selectedSpan", () => {
  it("orders a backwards selection and defaults to the new side", () => {
    expect(selectedSpan({ start: 9, end: 4 })).toEqual({
      side: "additions",
      start: 4,
      end: 9,
    });
  });

  it("keeps the side the selection is on", () => {
    expect(selectedSpan({ start: 2, end: 3, side: "deletions" })).toEqual({
      side: "deletions",
      start: 2,
      end: 3,
    });
  });

  it("refuses a selection that crosses sides", () => {
    expect(
      selectedSpan({
        start: 2,
        end: 3,
        side: "deletions",
        endSide: "additions",
      }),
    ).toEqual({ error: "two-sides" });
  });

  it("allows 200 lines and refuses more", () => {
    expect(selectedSpan({ start: 1, end: 200 })).toMatchObject({ end: 200 });
    expect(selectedSpan({ start: 1, end: 201 })).toEqual({ error: "too-long" });
  });
});

describe("clickedLine", () => {
  afterEach(() => vi.unstubAllGlobals());
  const click = (
    over: Record<string, unknown> = {},
    event: Record<string, unknown> = {},
  ) => ({
    event: {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      defaultPrevented: false,
      ...event,
    } as MouseEvent,
    numberColumn: false,
    lineNumber: 12,
    ...over,
  });
  const noSelection = () =>
    vi.stubGlobal("window", { getSelection: () => ({ isCollapsed: true }) });

  it("picks the clicked line on the side it was on", () => {
    noSelection();
    expect(clickedLine(click({ annotationSide: "deletions" }))).toEqual({
      start: 12,
      end: 12,
      side: "deletions",
    });
    expect(clickedLine(click())).toMatchObject({ side: "additions" });
  });

  it("ignores gutter clicks, modifier clicks and the end of a text selection", () => {
    noSelection();
    expect(clickedLine(click({ numberColumn: true }))).toBeNull();
    expect(clickedLine(click({}, { shiftKey: true }))).toBeNull();
    expect(clickedLine(click({}, { defaultPrevented: true }))).toBeNull();
    vi.stubGlobal("window", { getSelection: () => ({ isCollapsed: false }) });
    expect(clickedLine(click())).toBeNull();
  });
});
