import { expect, it } from "vitest";
import { parseWorkspaceId, workspaceId, workspaceIdSchema } from "./workspaces";

it("carries the explicit worktree identity in a validated workspace address", () => {
  const project = "11111111-1111-1111-1111-111111111111";
  const chat = "22222222-2222-2222-2222-222222222222";
  const worktree = "/repo/worktree with spaces?and&characters";
  const address = workspaceId(project, chat, worktree);
  expect(workspaceIdSchema.parse(address)).toBe(address);
  expect(parseWorkspaceId(address)).toEqual({
    projectId: project,
    chatId: chat,
    worktree,
  });
  expect(workspaceIdSchema.safeParse(`${project}?worktree=other`).success).toBe(
    false,
  );
  expect(
    workspaceIdSchema.safeParse(`${project}/${chat}?worktree=%bad`).success,
  ).toBe(false);
});
