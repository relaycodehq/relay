// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { copiedPills, pillMarks } from "./pill-clipboard";

it("carries pills through copied HTML, whatever their text holds", () => {
  const pills = {
    skills: { $commit: 'Commit "all" <changes>' },
    quotes: ['He said "no" & <left>\n\nthen came back'],
    files: ["src/a & b.ts", "docs/"],
  };
  expect(copiedPills(`<div>hi</div>${pillMarks(pills)}`)).toEqual(pills);
});

it("finds nothing in HTML from elsewhere", () => {
  expect(copiedPills("<p>plain <b>text</b></p>")).toBeUndefined();
  expect(copiedPills('<p data-relay-image="1">only a screenshot</p>')).toEqual({
    skills: {},
    quotes: [],
    files: [],
  });
});
