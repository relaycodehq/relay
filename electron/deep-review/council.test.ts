import { expect, it } from "vitest";
import { halted, unfinishedSlots } from "./council";
import type { ChatMessage, ProjectChat } from "../../shared/projects";

const answer = (
  body: string,
  status: ChatMessage["status"] = "complete",
): ChatMessage => ({
  id: "answer",
  role: "assistant",
  provider: "opencode",
  body,
  status,
  created: 0,
  version: 1,
});

it("keeps empty completed reports resumable, including old saved runs", async () => {
  const reports = [
    answer(""),
    answer("  \n"),
    answer("No findings."),
    answer("Partial report", "failed"),
  ];
  const host = {
    load: async (id: string): Promise<ProjectChat> => ({
      id,
      projectId: "p",
      scope: { kind: "review" },
      title: "Review",
      created: 0,
      updated: 0,
      messages: [reports[Number(id)]!],
    }),
  };
  expect(
    await unfinishedSlots(
      host,
      reports.map((_, i) => ({ chatId: String(i) })),
    ),
  ).toEqual([0, 1, 3]);
  expect(halted(reports.slice(0, 2))).toBe("failed");
  expect(halted(reports)).toBeUndefined();
  expect(halted([answer("", "cancelled")])).toBe("stopped");
});
