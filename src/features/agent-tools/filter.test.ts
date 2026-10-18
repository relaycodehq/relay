import { expect, it } from "vitest";
import type { AgentTool } from "../../../shared/agent-tools";
import { filterAgentTools } from "./filter";
const items: AgentTool[] = [
  {
    id: "review",
    name: "review-branch",
    description: "Review the branch",
    path: "/repo/skills/review/SKILL.md",
    source: "repo",
    state: "enabled",
  },
  {
    id: "release",
    name: "release",
    description: "Publish the branch",
    source: "personal",
    state: "disabled",
  },
];
it("combines word, source and status filters while keeping disabled tools discoverable", () => {
  expect(filterAgentTools(items, "branch REVIEW", "repo", "enabled")).toEqual([
    items[0],
  ]);
  expect(filterAgentTools(items, "SKILL.md", "all", "all")).toEqual([items[0]]);
  expect(filterAgentTools(items, "", "all", "disabled")).toEqual([items[1]]);
  expect(filterAgentTools(items, "release", "repo", "all")).toEqual([]);
});
