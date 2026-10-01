import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { findExecutable } from "../../executables";
import type { AgentOptions } from "../../agents/types";
import {
  sessionConfig,
  sessionSignature,
  type ClaudeRunOptions,
} from "./config";
import { ClaudeTurnReader } from "./reader";
import {
  closeSession,
  newSession,
  retune,
  sessions,
  setOptions,
  startSession,
} from "./session";
import {
  adopt,
  release,
  settled,
  type ClaudeFrames,
  type ClaudeTurn,
} from "./stream";

export async function runClaudeProject(
  options: ClaudeRunOptions,
): Promise<string> {
  const executable = await findExecutable("claude");
  options.signal.throwIfAborted();
  const key = options.session?.key;
  const signature = sessionSignature(options);
  let session = key ? sessions.get(key) : undefined;
  let turn: ClaudeTurn;
  if (options.adopt) {
    turn = adopt(session);
  } else {
    // A turn Claude started itself finishes first, so neither answer lands under the other.
    while (session?.unprompted) {
      await settled(session.unprompted, options.signal);
      session = key ? sessions.get(key) : undefined;
    }
    if (session?.busy)
      throw new Error("This Claude session is already running a turn.");
    // New settings mean a new session, unless Claude still has work running
    // in this one that a restart would end.
    const working = !!session && session.work.any;
    if (
      session &&
      !session.frames.ended &&
      session.signature !== signature &&
      working &&
      (await retune(session, options))
    )
      session.signature = signature;
    if (session && (session.signature !== signature || session.frames.ended)) {
      closeSession(session);
      sessions.delete(key!);
      session = undefined;
    }
    turn = { unprompted: false };
  }
  let succeeded = false;
  // Past the last frame this turn read from the host's log.
  let consumed: number | undefined;
  const controller = session?.controller ?? new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    if (!session) {
      // SDK callbacks outlive a turn. Resolve them against the current local request broker.
      const holder = newSession(options, signature, controller);
      const config = sessionConfig(
        options,
        executable,
        holder.skipsPermissions,
      );
      holder.turn = turn;
      await startSession(holder, config, key);
      session = holder;
      if (key) sessions.set(key, session);
    }
    const reader = new ClaudeTurnReader(options, session);
    setOptions(session, options);
    // The host's log marks the turn, so a restart knows what to show again.
    if (options.adopt) session.hosted?.mark("start", turn.from);
    session.plan = "";
    session.busy = true;
    const imageBlocks = (images: AgentOptions["images"]) =>
      Promise.all(
        (images ?? []).map(async (image) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: image.mimeType,
            data: (await readFile(image.path)).toString("base64"),
          },
        })),
      );
    const images = await imageBlocks(options.images);
    options.signal.throwIfAborted();
    if (options.compact && !session.threadId && !options.session?.id)
      throw new Error("There is no Claude session to compact yet.");
    if (!options.adopt) {
      // Claim the stream as the prompt goes out; a turn Claude began meanwhile
      // finishes first. Nothing may await between the check and the claim.
      while (session.unprompted)
        await settled(session.unprompted, options.signal);
      session.turn = turn;
      session.hosted?.mark("start");
      session.input.push({
        type: "user",
        uuid: reader.prompt.uuid,
        session_id: session.threadId ?? "",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: options.compact
            ? `/compact ${options.prompt}`.trim()
            : [
                // A screenshot sent alone has no text; the API refuses an empty block.
                ...(options.prompt
                  ? [{ type: "text" as const, text: options.prompt }]
                  : []),
                ...images,
              ],
        },
      });
    }
    if (!options.compact)
      options.onControl?.({
        steer: async (text, id, steerImages) => {
          if (!reader.steerable || options.signal.aborted)
            throw new Error(
              "This turn has finished. Send the queued message as a new turn.",
            );
          const attached = await imageBlocks(steerImages);
          const uuid = randomUUID();
          reader.track(uuid, id);
          // "next" folds the message into the running turn at its next step.
          session!.input.push({
            type: "user",
            uuid,
            session_id: session!.threadId ?? "",
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: attached.length
                ? [
                    ...(text ? [{ type: "text" as const, text }] : []),
                    ...attached,
                  ]
                : text,
            },
            priority: "next",
          });
        },
      });
    while (true) {
      const message = await session.frames.next();
      const seq = message && session.hosted?.seqOf(message);
      if (seq !== undefined) consumed = seq + 1;
      if (!message)
        throw new Error(
          session.frames.failure
            ? `Claude stopped before completing this turn: ${session.frames.failure.slice(0, 500)}`
            : "Claude stopped before completing this turn.",
        );
      if (
        "session_id" in message &&
        message.session_id &&
        message.session_id !== session.threadId
      ) {
        session.threadId = message.session_id;
        await options.session?.onId(message.session_id);
      }
      const verdict = reader.read(message);
      if (verdict === "more") continue;
      if (verdict === "follow-up") {
        if (await startsFollowUp(session.frames)) {
          reader.followUp();
          continue;
        }
        succeeded = true;
        return reader.text;
      }
      succeeded = true;
      return verdict.answer;
    }
  } finally {
    options.signal.removeEventListener("abort", abort);
    if (session) {
      session.busy = false;
      if (!key || !succeeded || options.signal.aborted) {
        closeSession(session);
        if (key) sessions.delete(key);
      } else if (session.turn === turn) {
        session.hosted?.mark("end", consumed);
        release(session);
      }
    }
  }
}

/**
 * For CLIs that don't report steering progress: a steer that arrives after
 * Claude's last step can't fold into the turn, so Claude runs it as its own
 * turn right after the result. That turn opens with an init frame at once; a
 * quiet stream means every steer was folded in. Anything else is left for
 * whatever Claude does next.
 */
async function startsFollowUp(frames: ClaudeFrames) {
  if (!(await frames.wait(2000))) return false;
  const first = frames.peek();
  return first?.type === "system" && first.subtype === "init";
}
