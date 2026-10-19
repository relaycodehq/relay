import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadSetup as Setup } from "../../../shared/handoff";
import type { ChatMessage, ChatSummary } from "../../../shared/projects";
import { elapsedLabel } from "../../../shared/chat-activity";
import { api } from "../../lib/api";
import { LineDivider } from "../../ui/LineDivider";
import { Message } from "./ProjectMessage";
import "./thread-setup.css";

const noop = () => {};
const noRewind = async () => ({ conflicts: [] });

/** What the setup's divider says, as it goes and once it's over. */
function setupLine(setup: Setup, cloning?: { step: string; progress: number | null }) {
  const { computer, project, folder } = setup;
  const took = setup.ended ? ` · ${elapsedLabel(setup.at, setup.ended)}` : "";
  const where = folder ? ` into ${folder}` : "";
  switch (setup.state) {
    case "cloning":
      return `Cloning ${project} on ${computer}${
        !cloning
          ? "…"
          : cloning.progress == null
            ? ` · ${cloning.step}`
            : ` · ${cloning.step} ${Math.round(cloning.progress * 100)}%`
      }`;
    case "agent":
      return `Setting up ${computer} · Relay couldn't clone ${project} there`;
    case "done":
      return setup.messages.length
        ? `Set up ${computer} · cloned ${project}${where}${took}`
        : `Cloned ${project} on ${computer}${where}${took}`;
    case "dropped":
      return setup.messages.length
        ? `Setup on ${computer} stopped`
        : `Couldn't clone ${project} on ${computer}`;
  }
}

/**
 * How the computer a thread went to was readied for it, where the thread
 * left: Relay's clone there, and when that failed, the agent there that set
 * it up, answered from this thread. Open while that agent works, one line
 * once it's done.
 */
export function ThreadSetup({
  chat,
  setup,
}: {
  chat: ChatSummary;
  setup: Setup;
}) {
  const working = setup.state === "cloning" || setup.state === "agent";
  const [open, setOpen] = useState<boolean>();
  const [asked, setAsked] = useState(false);
  const view = useQuery({
    queryKey: ["handoff-view", chat.id],
    queryFn: () => api.handoffView(chat.id),
    enabled: setup.state === "cloning",
    refetchInterval: 1000,
  });
  const shown = open ?? setup.state === "agent";
  // Relay's own request opens the setup's thread there; it's shown on asking.
  const [request, ...said] = setup.messages;
  const messages: ChatMessage[] =
    request?.role === "user" ? (asked ? setup.messages : said) : setup.messages;
  return (
    <div className="thread-setup" role="status">
      {working && (
        <p className="thread-setup-held">
          Starts on {setup.computer} once it's set up
        </p>
      )}
      <LineDivider tone={setup.state === "dropped" ? "danger" : undefined}>
        <span title={setup.error}>
          {setupLine(setup, view.data?.cloning)}
        </span>
        {setup.messages.length > 0 && (
          <button
            type="button"
            className="text-button"
            aria-expanded={shown}
            onClick={() => setOpen(!shown)}
          >
            {shown ? "Hide setup" : "Show setup"}
          </button>
        )}
      </LineDivider>
      {shown && setup.messages.length > 0 && (
        <div className="setup-phase">
          {request?.role === "user" && (
            <button
              type="button"
              className="text-button setup-asked"
              aria-expanded={asked}
              onClick={() => setAsked((v) => !v)}
            >
              {asked ? "Hide what Relay asked" : "Show what Relay asked"}
            </button>
          )}
          {messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              chatId={chat.id}
              // Its files are on that computer.
              projectRoot=""
              onOpenFile={noop}
              onReply={noop}
              onChanges={noop}
              onTurnDiff={noop}
              onRewind={noRewind}
            />
          ))}
        </div>
      )}
    </div>
  );
}
