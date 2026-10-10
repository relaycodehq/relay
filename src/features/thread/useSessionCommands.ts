import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentName, agentInfo } from "../../../shared/agents";
import {
  sideAgentsText,
  type RelayCommand,
} from "../../../shared/commands";
import { latestContext } from "../../../shared/context-usage";
import type { ChatMessage } from "../../../shared/projects";
import { api } from "../../lib/api";
import type { ThreadHandle } from "./useThreadHandle";

export type SessionCommands = ReturnType<typeof useSessionCommands>;

/**
 * The agent session behind the open conversation: how full its context is,
 * compacting it, and the slash commands about it. Commands for the rest of
 * the workspace go on to `onCommand`.
 */
export function useSessionCommands({
  handle: { chat, busy, run, refetch },
  shown,
  root,
  running,
  onCommand,
}: {
  handle: ThreadHandle;
  /** The open conversation's messages. */
  shown: ChatMessage[];
  /** The side conversation's first message, while one is open; it compacts its own session. */
  root?: ChatMessage;
  running: boolean;
  onCommand: (command: RelayCommand, args: string) => boolean | string;
}) {
  const qc = useQueryClient();
  const context = latestContext(shown);
  const compacting = shown.some(
    (m) => m.compaction && m.status === "streaming",
  );
  /** Bumped by `/context` to open the meter. */
  const [showContext, setShowContext] = useState(0);
  function compact(instructions?: string) {
    if (!chat) return;
    // Through the write gate, so a double click or a send racing it waits its turn.
    void run(async () => {
      await api.compactProjectChat(chat.id, root?.id ?? null, instructions);
      await refetch();
    });
  }
  // Session commands need this thread; the rest belong to the workspace.
  function runCommand(command: RelayCommand, args: string): boolean | string {
    if (command === "compact") {
      if (!chat || !context) return "There is no agent session to compact yet.";
      if (running || busy || compacting)
        return "Wait for the current answer before compacting.";
      if (args && !agentInfo(context.provider).compactInstructions)
        return `${agentName(context.provider)} compacts without custom instructions.`;
      compact(args || undefined);
      return true;
    }
    if (command === "reload") {
      if (!chat) return "There is no agent session to reload yet.";
      if (running || busy || compacting)
        return "Wait for the current answer before reloading the session.";
      void run(async () => {
        await api.reloadProjectChatSession(chat.id);
        void qc.invalidateQueries({ queryKey: ["provider-commands"] });
        await refetch();
      });
      return true;
    }
    // With a question and an agent picked, the composer sends it itself.
    if (command === "btw")
      return args
        ? `Pick ${sideAgentsText} to ask a side question.`
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
