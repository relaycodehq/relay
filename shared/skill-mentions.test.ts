import { expect, it } from "vitest";
import { pickedSkills } from "./skill-mentions";

it("keeps the picked skills the text still mentions, once each", () => {
  const labels = {
    $commit: "Commit changes",
    $review: "Review",
    "/skill:plan": "Plan",
    $blank: " ",
  };
  expect(
    pickedSkills("$commit it, then $commit again; $blank and $other", labels),
  ).toEqual([
    { name: "commit", label: "Commit changes" },
    { name: "blank", label: "blank" },
  ]);
});
