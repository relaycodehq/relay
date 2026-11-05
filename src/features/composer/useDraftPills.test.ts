// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { mount } from "../../../tests/unit/hook-harness";
import { draftChips } from "../../lib/thread-storage";
import { setDraftBody } from "./drafts";
import { useDraftPills } from "./useDraftPills";

const key = "chat-draft:t1";

beforeEach(() => localStorage.clear());

const pillTypes = (pills: ReturnType<typeof useDraftPills>, text: string) =>
  pills.content(text).content![0].content!.map((node) => node.type);

it("shows pills a phone added while the composer is open", () => {
  const pills = mount(() => useDraftPills(key));
  // The phone's edit arrives through draft sync, pills and all.
  setDraftBody(key, {
    text: "use $deploy on `src/app.ts`",
    skills: { $deploy: "Deploy" },
    quotes: [],
    files: ["src/app.ts"],
  });
  expect(pillTypes(pills(), "use $deploy on `src/app.ts`")).toEqual([
    "text",
    "relaySkill",
    "text",
    "relayFile",
  ]);
});

it("keeps another screen's pills when adding one here", () => {
  const pills = mount(() => useDraftPills(key));
  setDraftBody(key, {
    text: "use $deploy",
    skills: { $deploy: "Deploy" },
    quotes: ["a passage"],
    files: [],
  });
  pills().addFiles(["src/app.ts"]);
  pills().addSkill("$review", "Review");
  expect(draftChips(key).skills.load()).toEqual({
    $deploy: "Deploy",
    $review: "Review",
  });
  expect(draftChips(key).quotes.load()).toEqual(["a passage"]);
  expect(draftChips(key).files.load()).toEqual(["src/app.ts"]);
});
