import { expect, it } from "vitest";
import { hearCommands, heardCommands } from "./commands";

it("hears `$name` commands as skills and the rest as commands, once per name", () => {
  hearCommands("acp:fixture", {
    sessionUpdate: "available_commands_update",
    availableCommands: [
      {
        name: "review",
        description: "Review changes",
        input: { hint: "<branch>" },
      },
      { name: "$explain", description: "Explain code" },
      { name: "Review", description: "a duplicate" },
      { name: "$", description: "no name" },
    ],
  });
  expect(heardCommands("acp:fixture")).toEqual([
    {
      name: "review",
      description: "Review changes",
      source: "other",
      argumentHint: "<branch>",
    },
    {
      name: "explain",
      skill: true,
      source: "other",
      description: "Explain code",
    },
  ]);
});
