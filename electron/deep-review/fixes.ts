// Where a deep review's fixes land: on the reviewed branch, wherever it's
// checked out now, and only for findings about the code the thread works on.
import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import { workingReview, type DeepReviewState } from "../../shared/deep-review";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import { followReviewedBranch, needsCheckout } from "./checkout";
import { fixesFit, roundsOfFindings } from "./rounds";

export interface FixesHost {
  root(projectId: string): Promise<string>;
  worktrees: string;
  close(chatId: string): void;
  touch(chat: ProjectChat, messageId: string): Promise<void>;
}

export async function followFixes(
  host: FixesHost,
  chat: ProjectChat,
  input: ProjectChatSend,
) {
  const state = workingReview(chat);
  const fixing = !!input.fixes?.length;
  if (fixing) fixesHere(chat, input.fixes!, state);
  const checkout = state?.scope.checkout;
  if (!state?.scope.head || !checkout) return;
  const next = await followReviewedBranch(
    await host.root(chat.projectId),
    checkout,
    {
      head: state.scope.head,
      dir: host.worktrees,
      chatId: chat.id,
      fixing,
    },
  ).catch((e: unknown) => {
    console.warn("Could not follow the reviewed branch:", e);
    if (!fixing) return checkout;
    const branch = checkout.branch ?? checkout.pr?.head;
    throw new Error(
      `Relay couldn't check out ${branch ?? "the reviewed branch"} for the fix. Check it out in a folder of your own and ask again; the review follows it there.`,
    );
  });
  if (next === checkout) return;
  state.scope.checkout = next;
  if (next.path !== checkout.path) {
    noteWorkspaceMove(chat, {
      how: "switched",
      to: next.path,
      ...(next.branch ? { branch: next.branch } : {}),
    });
    // The lead's session hears it too: its first turn wasn't one that
    // notes what it heard. A session not told of an earlier move yet
    // still works where that one started.
    const pending = chat.movedIn;
    chat.movedIn = {
      from: pending?.from ?? checkout.path,
      to: next.path,
      owed: [
        ...new Set([
          ...(pending?.owed ?? []),
          ...Object.keys(chat.scopeHeard ?? {}),
          `${state.lead.provider}:main`,
          ...(input.provider ? [`${input.provider}:main`] : []),
        ]),
      ],
      selected: true,
    };
    // Its session started in the old folder.
    host.close(chat.id);
  }
  await host.touch(chat, state.request);
}

/**
 * Refuses fixes that would land on other code than the findings are
 * about: the round's reviewers read it from Git, as it wasn't checked out
 * where the thread works, or a later round moved the thread on to other
 * code, or the thread itself moved to another branch.
 */
function fixesHere(
  chat: ProjectChat,
  ids: string[],
  working: DeepReviewState | undefined,
) {
  const rounds = roundsOfFindings(chat, ids);
  const away = rounds.find((r) => !r.scope.checkout && needsCheckout(r.scope));
  if (away)
    throw new Error(
      `Those findings are from the review of ${away.scope.label}, which isn't checked out where this thread works. Review it from a deep review thread to fix them there.`,
    );
  const elsewhere = rounds.find((r) => !fixesFit(chat, r, working));
  if (elsewhere)
    throw new Error(
      `Those findings are from the review of ${elsewhere.scope.label}, and this thread works on ${working?.scope.label ?? chat.branch ?? "other code"} now. Review ${elsewhere.scope.label} again to fix them there.`,
    );
}
