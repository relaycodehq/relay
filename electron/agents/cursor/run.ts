import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AgentOptions } from "../types";
import {
  cursorActivity,
  cursorEdits,
  cursorPlan,
  TurnText,
  type CursorCall,
} from "./activity";
import { expandCursorCommand } from "./commands";
import {
  acquireCursorConnection,
  CursorError,
  type CursorConnection,
} from "./connection";
import type { CursorRun, CursorRunResult, CursorUpdate } from "./protocol";
import { currentSdk, ensureSdk } from "./sdk";

/** What Cursor may do in a turn, from Relay's approval mode. Its SDK can't ask, only limit. */
export function cursorPolicy(
  options: Pick<AgentOptions, "runtimeMode" | "readOnly">,
): Pick<CursorRun, "sandbox" | "autoReview" | "tools"> {
  if (options.readOnly)
    return {
      sandbox: true,
      autoReview: false,
      tools: [
        "read",
        "grep",
        "glob",
        "ls",
        "semSearch",
        "readLints",
        "readTodos",
        "updateTodos",
        "webSearch",
        "webFetch",
      ],
    };
  switch (options.runtimeMode) {
    case "approval-required":
      return { sandbox: true, autoReview: true };
    case "auto-accept-edits":
      return { sandbox: true, autoReview: false };
    case "auto":
      return { sandbox: false, autoReview: true };
    default:
      return { sandbox: false, autoReview: false };
  }
}

/** Says what to do about an error the worker reported, where there's something to do. */
export function explainCursorError(error: unknown): Error {
  if (
    error instanceof CursorError &&
    (error.name === "AuthenticationError" ||
      error.name === "ConfigurationError" ||
      /api key|log ?in|sign ?in/i.test(error.message))
  )
    return new Error(
      "Cursor isn't signed in. Sign in under Settings → Agents, then send again.",
    );
  return error instanceof Error ? error : new Error(String(error));
}

/** Runs one turn on a Cursor agent, starting or resuming it in the thread's worker. */
export async function runCursor(options: AgentOptions): Promise<string> {
  const { signal } = options;
  signal.throwIfAborted();
  if (options.compact)
    throw new Error(
      "Cursor summarizes a long thread on its own; there is nothing to compact by hand.",
    );
  const key = options.session?.key;

  let sdk = await currentSdk();
  if (!sdk) {
    options.onCommentary?.("cursor-sdk", "Downloading Cursor's SDK…");
    try {
      sdk = await ensureSdk();
    } finally {
      options.onCommentary?.("cursor-sdk", null);
    }
  }
  signal.throwIfAborted();
  const connection = await acquireCursorConnection(key, options.cwd, sdk);

  const adopted = options.adopt ? connection.inflight : undefined;
  if (options.adopt && !adopted) {
    connection.busy = false;
    throw new Error("There is no Cursor turn to pick up.");
  }
  const run = adopted?.run ?? randomUUID();
  const turn = new TurnText(options.onText, options.onCommentary);
  /** Steering messages sent, until Cursor says it read one. */
  const steers: (string | undefined)[] = [];
  let agentId = options.session?.id;

  const handle = (update: CursorUpdate) => {
    switch (update.type) {
      case "agent": {
        const id = String(update.agentId ?? "");
        if (id && id !== agentId) {
          agentId = id;
          void options.session?.onId(id);
        }
        return;
      }
      case "text-delta":
        turn.add(String(update.text ?? ""));
        return;
      case "tool-call-started":
      case "tool-call-completed": {
        const done = update.type === "tool-call-completed";
        const call = update.toolCall as CursorCall | undefined;
        if (!call) return;
        if (!done) turn.toCommentary();
        const activity = cursorActivity(
          String(update.callId ?? ""),
          call,
          done,
        );
        if (activity) options.onActivity?.(activity);
        const edits = cursorEdits(call);
        if (edits.length) options.onEdit?.(edits);
        const plan = done ? cursorPlan(call) : undefined;
        if (plan) options.onPlan?.(plan);
        return;
      }
      case "summary-started":
        options.onCommentary?.(
          "cursor-summary",
          "Summarizing the conversation…",
        );
        return;
      case "summary-completed":
        options.onCommentary?.("cursor-summary", null);
        return;
      case "user-message-appended": {
        // Cursor read the oldest steering message; the rest of the turn answers it.
        if (!steers.length) return;
        const id = steers.shift();
        turn.reset();
        if (id) options.onSteered?.(id);
      }
    }
  };
  connection.listen(run, handle);

  let cancelTimer: NodeJS.Timeout | undefined;
  const abort = () => {
    void connection.request("cancel", { run }).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });

  try {
    connection.mark("start");
    let reply: Promise<CursorRunResult>;
    if (adopted) {
      reply = connection.wait(adopted.id) as Promise<CursorRunResult>;
      // What it said while Relay was away comes now, with a listener in place.
      connection.resume();
    } else {
      // A helper job (a thread title) is one bare question: no notes, no history, no tools.
      const helper = options.helper;
      const note = helper
        ? undefined
        : await options.context?.().catch(() => undefined);
      const images = await Promise.all(
        (options.images ?? []).map(async (image) => ({
          data: (await readFile(image.path)).toString("base64"),
          mimeType: image.mimeType,
        })),
      );
      signal.throwIfAborted();
      const prompt = await expandCursorCommand(options.prompt, options.cwd);
      const params: CursorRun = {
        run,
        agentId: helper ? undefined : options.session?.id,
        cwd: options.cwd,
        prompt: [note, prompt].filter(Boolean).join("\n\n"),
        images,
        model: options.choice.model || undefined,
        effort: options.choice.reasoningEffort || undefined,
        mode: options.interactionMode === "plan" ? "plan" : "agent",
        ...(helper
          ? {
              sandbox: true,
              autoReview: false,
              tools: [],
              systemPrompt: helper.instructions,
              ambient: false,
            }
          : { ...cursorPolicy(options), ambient: true }),
      };
      const id = connection.reserve();
      connection.keep({ agentId: options.session?.id, run: { run, id } });
      reply = connection.request("run", params, id);
    }
    void reply.catch(() => {});
    options.onControl?.({
      steer: async (text, id, images) => {
        if (signal.aborted || connection.closed)
          throw new Error(
            "This turn has finished. Send the queued message as a new turn.",
          );
        if (images?.length)
          throw new Error(
            "Cursor can't take images while it works. Send the queued message as a new turn.",
          );
        steers.push(id);
        try {
          await connection.request("steer", { run, text });
        } catch (error) {
          steers.pop();
          throw error;
        }
      },
    });
    if (signal.aborted) abort();
    // The worker reports the cancel; if it doesn't, stop waiting anyway.
    const cancelled = new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          cancelTimer = setTimeout(
            () => reject(new Error("Cancelled by you.")),
            5000,
          );
          cancelTimer.unref();
        },
        { once: true },
      );
    });
    const result = await Promise.race([reply, cancelled]).catch((error) => {
      throw explainCursorError(error);
    });
    if (result.status === "cancelled") throw new Error("Cancelled by you.");
    if (result.status === "error")
      throw explainCursorError(
        new CursorError("Error", result.error || "Cursor failed to answer."),
      );
    if (result.agentId !== agentId) await options.session?.onId(result.agentId);
    const answer = turn.answer() || result.text;
    if (answer !== turn.answer()) options.onText(answer);
    if (options.interactionMode === "plan" && answer.trim())
      options.onPlan?.(answer);
    return answer;
  } finally {
    clearTimeout(cancelTimer);
    signal.removeEventListener("abort", abort);
    connection.unlisten(run);
    settle(connection, agentId, !!key);
  }
}

/** The turn is over: the worker keeps its agent for the next, unless it was a private one. */
function settle(
  connection: CursorConnection,
  agentId: string | undefined,
  kept: boolean,
) {
  connection.inflight = undefined;
  connection.busy = false;
  if (!kept) return connection.close();
  connection.mark("end");
  connection.keep({ agentId });
}
