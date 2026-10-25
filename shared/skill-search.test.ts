import { expect, it } from "vitest";
import type { ProviderCommand } from "./commands";
import {
  agentSkills,
  agentSlashCommands,
  searchSkills,
  searchSlashItems,
  skillLabel,
} from "./skill-search";

const skill = (
  name: string,
  description = "",
  extra = {},
): ProviderCommand => ({
  name,
  description,
  skill: true,
  ...extra,
});

const commands: ProviderCommand[] = [
  { name: "review", description: "Built-in review" },
  { name: "init", description: "Write AGENTS.md" },
  skill("review", "Review the diff"),
  skill("Review", "A second copy, other case"),
  skill("pdf-tools", "Read PDFs", { source: "personal" }),
  skill("commit", "Split commits", { displayName: "Commit changes" }),
];

it("offers each skill once, and the commands not named like one", () => {
  expect(agentSkills(commands).map((s) => s.name)).toEqual([
    "review",
    "pdf-tools",
    "commit",
  ]);
  expect(agentSlashCommands(commands).map((c) => c.name)).toEqual(["init"]);
});

it("ranks `$` matches by name, then label, then description, and lists all for nothing typed", () => {
  const skills = agentSkills(commands);
  expect(searchSkills(skills, "").length).toBe(3);
  expect(searchSkills(skills, "$co").map((s) => s.name)).toEqual(["commit"]);
  expect(searchSkills(skills, "pdf").map((s) => s.name)).toEqual(["pdf-tools"]);
  // Fuzzy on the name, and description words as a last resort.
  expect(searchSkills(skills, "pt").map((s) => s.name)).toEqual(["pdf-tools"]);
  expect(searchSkills(skills, "diff").map((s) => s.name)).toEqual(["review"]);
  expect(skillLabel(skills[1])).toBe("Pdf Tools");
  expect(skillLabel(skills[2])).toBe("Commit changes");
});

it("puts `/skill:` rows after commands, and `/skill` alone lists every skill", () => {
  const items = [
    { kind: "relay" as const, name: "review-local", description: "" },
    { kind: "command" as const, name: "init", description: "" },
    ...agentSkills(commands).map((s) => ({
      kind: "skill" as const,
      name: s.name,
      description: s.description,
      skill: s,
    })),
  ];
  expect(searchSlashItems(items, "/rev").map((i) => i.name)).toEqual([
    "review",
    "review-local",
  ]);
  expect(searchSlashItems(items, "skill").map((i) => i.name)).toEqual([
    "commit",
    "pdf-tools",
    "review",
  ]);
  expect(searchSlashItems(items, "skill:pd").map((i) => i.name)).toEqual([
    "pdf-tools",
  ]);
});
