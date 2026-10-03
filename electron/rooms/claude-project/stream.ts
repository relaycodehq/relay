// Who reads a session's stream: the turn Relay is running, a turn Claude
// started by itself, or nobody, between turns.
import { AsyncQueue } from "../../util/async-queue";
import type { HookFrame } from "../../agent-host/protocol";
import type { SDKMessage } from "./sdk";
import type { ClaudeSession } from "./session";
import { pendingChanged } from "./pending";

/** Frames read off the stream, waiting for the turn they belong to. */
export class ClaudeFrames extends AsyncQueue<SDKMessage> {
  /** Why the stream ended early, when it failed rather than closed. */
  failure?: string;
  end(failure?: unknown) {
    if (failure)
      this.failure =
        failure instanceof Error ? failure.message : String(failure);
    super.end();
  }
}
/**
 * A turn in flight. Claude starts unprompted ones itself, e.g. when a
 * background task ends; `from` is where one began in the host's log.
 */
export type ClaudeTurn = {
  unprompted: boolean;
  adopted?: boolean;
  from?: number;
};
/** Reads the stream for the session's lifetime, not only while a turn is waiting. */
export async function pump(
  session: ClaudeSession,
  iterator: AsyncIterator<SDKMessage>,
) {
  let failure: unknown;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      // Here rather than in receive(): frames a turn leaves unread pass through that twice.
      session.agents.observe(next.value);
      // Replayed after a restart, turns already shown only rebuild what's running.
      const seq = session.hosted?.seqOf(next.value);
      if (seq !== undefined && seq < session.hosted!.split)
        restore(session, next.value);
      else receive(session, next.value);
    }
  } catch (error) {
    // The turn reading the frames reports the stop.
    failure = error;
  } finally {
    session.agents.close();
    session.frames.end(failure);
    pendingChanged();
  }
}
function restore(session: ClaudeSession, message: SDKMessage) {
  const hook = message as unknown as HookFrame;
  if (hook.type === "relay_hook") {
    if (hook.event === "Stop") session.work.schedule(hook.input);
  } else if (
    message.type === "system" &&
    message.subtype === "background_tasks_changed"
  )
    session.work.track(message.tasks);
}
function receive(session: ClaudeSession, message: SDKMessage) {
  // The host logs the end-of-turn hook as a frame of its own.
  if ((message as unknown as HookFrame).type === "relay_hook")
    return restore(session, message);
  if (
    message.type === "system" &&
    message.subtype === "background_tasks_changed"
  )
    session.work.track(message.tasks);
  if (session.turn) return session.frames.push(message);
  // Between turns, only Claude's own output matters. Init, status and late
  // results have nothing to show, and subagents report through their parent.
  const output =
    (message.type === "stream_event" || message.type === "assistant") &&
    !message.parent_tool_use_id;
  if (!output) return;
  const turn: ClaudeTurn = {
    unprompted: true,
    from: session.hosted?.seqOf(message),
  };
  session.turn = turn;
  session.frames.push(message);
  const show = session.options.session?.onUnprompted;
  const done = Promise.resolve()
    .then(() => show?.())
    .catch(() => {})
    // Nobody showed it: read it to the end so the next prompt starts clean.
    .then(async () => {
      if (session.turn !== turn || turn.adopted) return;
      let frame: SDKMessage | undefined;
      while ((frame = await session.frames.next()) && frame.type !== "result");
      const seq = frame && session.hosted?.seqOf(frame);
      session.hosted?.mark("end", seq === undefined ? undefined : seq + 1);
      release(session);
    })
    .finally(() => {
      if (session.unprompted === done) session.unprompted = undefined;
    });
  session.unprompted = done;
}
/** Ends the current turn. Frames it didn't consume belong to whatever Claude does next. */
export function release(session: ClaudeSession) {
  session.turn = undefined;
  session.released?.();
  session.released = undefined;
  for (const frame of session.frames.take()) receive(session, frame);
}
/** The turn Claude started by itself, for an `adopt` turn to show. */
export function adopt(session: ClaudeSession | undefined) {
  if (!session?.turn?.unprompted || session.turn.adopted)
    throw new Error("Claude has no turn of its own to show.");
  const turn = session.turn;
  turn.adopted = true;
  return turn;
}
/** A turn cut off by a restart is waiting to be shown. */
export function holdOpen(session: ClaudeSession, from?: number) {
  session.turn = { unprompted: true, from };
  // A prompt sent meanwhile waits for it, as for any turn Claude began itself.
  const done: Promise<void> = new Promise<void>(
    (r) => (session.released = r),
  ).finally(() => {
    if (session.unprompted === done) session.unprompted = undefined;
  });
  session.unprompted = done;
}
/** Settles with `done`, or fails once the turn waiting on it is cancelled. */
export function settled(done: Promise<void>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => reject(new Error("Cancelled by you."));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    void done.finally(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    });
  });
}
