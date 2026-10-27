import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import type { DeepReviewState } from "../../../shared/deep-review";
import { FoundBy } from "./FoundBy";

const agent = (provider: "claude" | "codex" | "cursor") => ({
  provider,
  choice: { model: "m", reasoningEffort: "high" as const, fast: false },
});

const reviewers = (passes?: number): DeepReviewState["reviewers"] => {
  const three = [agent("codex"), agent("cursor"), agent("claude")];
  if (passes === undefined)
    return three.map((r, i) => ({ ...r, chatId: `r${i}` }));
  return [...Array(passes).keys()].flatMap((pass) =>
    three.map((r, i) => ({ ...r, chatId: `r${pass}-${i}`, pass })),
  );
};

const labels = ["1. Codex", "2. Cursor", "3. Claude"];

const render = (numbers: number[], passes?: number) =>
  renderToStaticMarkup(
    <FoundBy numbers={numbers} reviewers={reviewers(passes)} labels={labels} />,
  );

it("counts a split review's reviewers, not its threads", () => {
  const html = render([3, 9], 3);
  expect(html).toContain("1/3");
  expect(html).toContain("3. Claude · passes 1, 3");
});

it("credits different reviewers across passes once each", () => {
  const html = render([1, 5, 9], 3);
  expect(html).toContain("3/3");
  expect(html).toContain("1. Codex · pass 1");
  expect(html).toContain("2. Cursor · pass 2");
});

it("leaves a review in one pass as it was", () => {
  const html = render([1, 3]);
  expect(html).toContain("2/3");
  expect(html).toContain("Found by\n1. Codex\n3. Claude");
});
