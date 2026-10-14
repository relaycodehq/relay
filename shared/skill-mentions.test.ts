import { expect, it } from "vitest";
import { mayMentionSkill, pickedSkills, skillMentions } from "./skill-mentions";

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

it("reads mentions as T3 does: any currency sign, no amounts, whitespace after", () => {
  const skills = new Set(["review", "2spec", "20k", "pdf:extract"]);
  const names = (text: string) =>
    skillMentions(text, skills).map((m) => m.name);
  expect(names("€review it, then $2spec and $pdf:extract")).toEqual([
    "review",
    "2spec",
    "pdf:extract",
  ]);
  // Amounts, glued text and trailing punctuation stay prose.
  expect(names("pay $20k, a$review, $review. $HOME")).toEqual([]);
  expect(skillMentions("so $review", skills)).toEqual([
    { name: "review", start: 3, end: 10 },
  ]);
  expect(mayMentionSkill("costs $20")).toBe(false);
  expect(mayMentionSkill("run £review")).toBe(true);
});
