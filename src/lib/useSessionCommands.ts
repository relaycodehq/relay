import { useState } from "react";
import { agentName, agentProviders, agents } from "../../shared/agents";
import type { RelayCommand } from "../../shared/commands";
import type { ChatMessage } from "../../shared/projects";
import { latestContext } from "../components/ContextWindowMeter";
import { api } from "./api";
import type { ThreadHandle } from "./useThreadHandle";

export type SessionCommands = ReturnType<typeof useSessionCommands>;

/**
 * The agent session behind the open conversation: how full its context is,
 * compacting it, and the slash commands about it. Commands for the rest of
 * the workspace go on to `onCommand`.
 */
export function useSessionCommands({
  handle: { chat, busy, setError, refetch },
  shown,
  root,
  running,
  onCommand,
}: {
  handle: ThreadHandle;
  /** The open conversation's messages. */
  shown: ChatMessage[];
  /** The side conversation open, if any; it compacts its own session. */
  root: string | null;
  running: boolean;
  onCommand: (command: RelayCommand, args: string) => boolean | string;
}) {
  const context = latestContext(shown);
  const compacting = shown.some(
    (m) => m.compaction && m.status === "streaming",
  );
  /** Bumped by `/context` to open the meter. */
  const [showContext, setShowContext] = useState(0);
  function compact(instructions?: string) {
    if (!chat) return;
    setError(undefined);
    void api
      .compactProjectChat(chat.id, root, instructions)
      .then(() => refetch())
      .catch(setError);
  }
  // Session commands need this thread; the rest belong to the workspace.
  function runCommand(command: RelayCommand, args: string): boolean | string {
    if (command === "compact") {
      if (!chat || !context) return "There is no agent session to compact yet.";
      if (running || busy || compacting)
        return "Wait for the current answer before compacting.";
      if (args && !agents[context.provider].compactInstructions)
        return `${agentName(context.provider)} compacts without custom instructions.`;
      compact(args || undefined);
      return true;
    }
    // With a question and an agent picked, the composer sends it itself.
    if (command === "btw")
      return args
        ? `Pick ${agentProviders.map(agentName).join(" or ")} to ask a side question.`
        : "Type your question after /btw.";
    if (command === "context") {
      if (!chat || !context)
        return "Context usage appears after the first answer.";
      setShowContext((n) => n + 1);
      return true;
    }
    return onCommand(command, args);
  }
  return { context, compacting, showContext, compact, runCommand };
}
