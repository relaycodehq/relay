// The threads a turn's agent started with Relay's tools, as their agents'
// marks: beside the call that started them and in place of the folded turn's
// icon. A badge says where each stands, and the card on hover gives its
// latest line and opens it. The composer keeps its chip (StartedChip).
import { inputBlocksThread } from "../../../shared/thread-state";
import { createContext, useContext, type ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import { plural } from "../../../shared/activity-labels";
import { chatSettled } from "../../../shared/chat-activity";
import { byStanding } from "../../../shared/started-families";
import { took } from "../../../shared/subagents";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { useNow } from "../../lib/useNow";
import { AgentMarks, AgentMarksRow, type MarkState } from "./AgentMarks";
import "./started-threads.css";

/** The open thread, every project's threads and how to open one; absent where nothing can open. */
export interface StartedThreadsView {
  lead: string | undefined;
  threads: ChatSummary[];
  open: (chat: ChatSummary) => void;
}
export const StartedThreadsContext = createContext<
  StartedThreadsView | undefined
>(undefined);
export const useStartedThreads = () => useContext(StartedThreadsContext);

const markState = (chat: ChatSummary): MarkState =>
  inputBlocksThread(chat) ? "asks" : chat.running ? "working" : "done";

/**
 * The lead's threads, asking first, then working, then done; settled ones
 * are put away. `ids` narrows them to one call's; `live` wants any working
 * or asking, or nothing.
 */
export function useStarted(ids: string[] | undefined, live = false) {
  const view = useStartedThreads();
  const lead = view?.lead;
  // Without a lead (a new thread's draft) undefined would match every thread.
  const started = (view && lead ? view.threads : [])
    .filter(
      (c) =>
        c.startedBy?.chatId === lead &&
        // A deep review's reviewers show in its council instead.
        !c.reviewer &&
        (!ids || ids.includes(c.id)) &&
        !chatSettled(c),
    )
    .sort(byStanding);
  if (live && !started.some((c) => markState(c) !== "done")) return [];
  return started;
}

function StartedMarks({ started }: { started: ChatSummary[] }) {
  const view = useStartedThreads()!;
  const done = started.filter((c) => markState(c) === "done").length;
  return (
    <AgentMarks
      marks={started.map((c) => ({
        id: c.id,
        provider: c.provider ?? "claude",
        state: markState(c),
      }))}
      label={`${plural(started.length, "started thread")}: ${done} done`}
      cardLabel="Started threads"
      card={(close) => (
        <StartedCard
          started={started}
          onOpen={(c) => {
            close();
            view.open(c);
          }}
        />
      )}
    />
  );
}

/** Beside a start_threads call. */
export function StartedThreadMarks({ ids }: { ids: string[] | undefined }) {
  const started = useStarted(ids);
  if (!started.length) return null;
  return <StartedMarks started={started} />;
}

/**
 * A folded, finished turn's icon and label, the threads it started in their
 * place while any isn't settled, and what needs you after the label.
 */
export function StartedHeading({
  ids,
  label,
  children,
}: {
  ids: string[] | undefined;
  label: ReactNode;
  /** The heading as it would be without them. */
  children: ReactNode;
}) {
  const started = useStarted(ids);
  if (!started.length) return children;
  const asks = started.filter((c) => markState(c) === "asks").length;
  const working = started.filter((c) => markState(c) === "working").length;
  return (
    <>
      <StartedMarks started={started} />
      {label}
      {asks ? (
        <span className="started-heading-state asks">· {asks} needs you</span>
      ) : working ? (
        <span className="started-heading-state">· {working} working</span>
      ) : null}
    </>
  );
}

/** Mounted only while open, so it loads the threads and ticks just then. */
function StartedCard({
  started,
  onOpen,
}: {
  started: ChatSummary[];
  onOpen: (chat: ChatSummary) => void;
}) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const threads = useQueries({
    queries: started.map((c) => ({
      queryKey: chatKey(c.id),
      queryFn: () => fetchChat(qc, c.id),
    })),
  });
  const done = started.filter((c) => markState(c) === "done").length;
  return (
    <>
      <div className="agent-marks-head">
        <b>Started threads</b>
        <span>
          {done} of {started.length} done
        </span>
      </div>
      {started.map((chat, i) => {
        const state = markState(chat);
        const thread = threads[i]?.data;
        const main = thread?.messages.filter((m) => !m.parentId) ?? [];
        const last = [...main].reverse().find((m) => m.role === "assistant");
        const line =
          state === "asks"
            ? (thread?.requests?.[0]?.title ?? "Needs your input")
            : last?.body.trim()
              ? last.body.trim().split("\n").filter(Boolean).at(-1)
              : chat.running
                ? "Starting…"
                : "No answer yet";
        return (
          <AgentMarksRow
            key={chat.id}
            provider={chat.provider ?? "claude"}
            state={state}
            name={chat.title}
            meta={
              state === "asks" ? (
                <span className="started-marks-asks">
                  <b>Asks</b> {line}
                </span>
              ) : (
                line
              )
            }
            aside={
              state === "asks" ? (
                <span className="started-marks-answer">
                  Answer <ChevronRight size={12} />
                </span>
              ) : state === "working" && chat.runningSince ? (
                `working ${took(now - chat.runningSince)}`
              ) : state === "working" ? (
                "working"
              ) : (
                "done"
              )
            }
            onClick={() => onOpen(chat)}
          />
        );
      })}
    </>
  );
}
