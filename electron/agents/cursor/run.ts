import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { withTimeout } from "../../util/timeout";
import type { AgentOptions } from "../types";
import {
  cursorActivity,
  cursorEdits,
  cursorPlan,
  TurnText,
  type CursorCall,
} from "./activity";
import { expandCursorCommand } from "./commands";
import { cursorErrorName } from "./error-codes";
import {
  acquireCursorConnection,
  CursorError,
  type CursorConnection,
} from "./connection";
import type { CursorRun, CursorRunResult, CursorUpdate } from "./protocol";
import { currentSdk, ensureSdk } from "./sdk";
import { signedOutError, usageLimitError } from "../errors";
import { answerLimitError, guardSteer } from "../turn-kit";

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
        // Subagents get the same tools, so Bugbot can run for a deep review.
        "task",
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

const signInFirst =
  "Cursor isn't signed in. Sign in under Settings → Agents, then send again.";
const noSandbox =
  "Cursor can't sandbox on this system (its sandbox needs features this OS doesn't allow), so it can't run in Supervised or Auto-accept edits. Switch to Auto or Full access, or use another agent.";

/** The SDK's refusal to start a sandboxed turn where it can't sandbox, e.g. Linux without user namespaces. */
const sandboxRefused = (error: unknown) =>
  error instanceof CursorError &&
  error.name === "ConfigurationError" &&
  error.message.includes("sandboxing is not supported in this environment");

/** Set once the SDK refused to sandbox; that doesn't change while Relay runs. */
let cannotSandbox = false;

/** Says what to do about an error the worker reported, where there's something to do. */
async function explainCursorError(
  error: unknown,
  connection: CursorConnection,
): Promise<Error> {
  if (!(error instanceof CursorError))
    return error instanceof Error ? error : new Error(String(error));
  if (sandboxRefused(error)) return new Error(noSandbox);
  if (error.name === "AuthenticationError")
    return signedOutError("cursor", signInFirst);
  // The SDK's 429: too many requests, or the plan's usage limit. It sends no reset time.
  if (error.name === "RateLimitError")
    return usageLimitError(
      "cursor",
      `Cursor hit a rate or usage limit: ${error.message.slice(0, 300)}`,
    );
  // Sounds like a sign-in problem: only say so when Cursor agrees.
  if (
    /api key|log ?in|sign ?in/i.test(error.message) &&
    (await signedOut(connection))
  )
    return signedOutError("cursor", signInFirst);
  return error;
}

async function signedOut(connection: CursorConnection) {
  try {
    const auth = await withTimeout(
      connection.request("auth.status", {}),
      10_000,
      "Cursor didn't say who is signed in.",
    );
    return auth.status === "logged-out";
  } catch {
    return false;
  }
}

/** Runs one turn on a Cursor agent, starting or resuming it in the thread's worker. */
export async function runCursor(options: AgentOptions): Promise<string> {
  const { signal, job } = options;
  signal.throwIfAborted();
  if (job.kind === "compact")
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
  const connection = await acquireCursorConnection(
    key,
    options.cwd,
    sdk,
    options.env,
  );

  const adopted = job.kind === "adopt" ? connection.inflight : undefined;
  if (job.kind === "adopt" && !adopted) {
    connection.busy = false;
    throw new Error("There is no Cursor turn to pick up.");
  }
  const run = adopted?.run ?? randomUUID();
  const turn = new TurnText(options.onText, options.onCommentary);
  /** Steering messages sent, until Cursor says it read one. */
  const steers: (string | undefined)[] = [];
  let agentId = options.session?.id;

  let overflow!: (error: Error) => void;
  let capped = false;
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
      case "text-delta": {
        turn.add(String(update.text ?? ""));
        const over = answerLimitError(turn.size);
        if (over && !capped) {
          capped = true;
          overflow(over);
          abort();
        }
        return;
      }
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
  const overflowed = new Promise<never>((_, reject) => (overflow = reject));
  void overflowed.catch(() => {});
  connection.listen(run, handle);

  let cancelTimer: NodeJS.Timeout | undefined;
  const abort = () => {
    void connection.request("cancel", { run }).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });

  // Without tools that change anything, a turn needs no sandbox to stay safe.
  const mayGoUnsandboxed = job.kind === "helper" || !!options.readOnly;
  const unsandboxed = (params: CursorRun): CursorRun => {
    if (job.kind !== "helper")
      options.onCommentary?.(
        "cursor-sandbox",
        "Cursor can't sandbox on this system, so it runs with read-only tools only.",
      );
    return { ...params, sandbox: false };
  };
  const send = (params: CursorRun) => {
    const id = connection.reserve();
    connection.keep({ agentId: options.session?.id, run: { run, id } });
    const reply = connection.request("run", params, id);
    void reply.catch(() => {});
    return reply;
  };

  try {
    connection.mark("start");
    let reply: Promise<CursorRunResult>;
    let params: CursorRun | undefined;
    if (adopted) {
      reply = connection.wait(adopted.id) as Promise<CursorRunResult>;
      void reply.catch(() => {});
      // What it said while Relay was away comes now, with a listener in place.
      connection.resume();
    } else {
      // A helper job (a thread title) is one bare question: no notes, no history, no tools.
      const helper = job.kind === "helper" ? job : undefined;
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
      params = {
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
      if (params.sandbox && cannotSandbox && mayGoUnsandboxed)
        params = unsandboxed(params);
      reply = send(params);
    }
    options.onControl?.({
      steer: (text, id, images) =>
        guardSteer(
          () => !signal.aborted && !connection.closed,
          () => {
            if (images?.length)
              throw new Error(
                "Cursor can't take images while it works. Send the queued message as a new turn.",
              );
          },
          async () => {
            steers.push(id);
            try {
              await connection.request("steer", { run, text });
            } catch (error) {
              steers.pop();
              throw error;
            }
          },
        ),
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
    let result: CursorRunResult;
    try {
      result = await Promise.race([reply, cancelled, overflowed]);
    } catch (error) {
      if (
        !params?.sandbox ||
        !mayGoUnsandboxed ||
        !sandboxRefused(error) ||
        signal.aborted
      )
        throw await explainCursorError(error, connection);
      // Refused before the turn began; the worker names an agent only once one runs.
      cannotSandbox = true;
      turn.reset();
      params = unsandboxed(params);
      result = await Promise.race([send(params), cancelled, overflowed]).catch(
        async (error) => {
          throw await explainCursorError(error, connection);
        },
      );
    }
    if (result.status === "cancelled") throw new Error("Cancelled by you.");
    if (result.status === "error")
      throw await explainCursorError(
        new CursorError(
          cursorErrorName(result.errorCode),
          result.error || "Cursor failed to answer.",
        ),
        connection,
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
    // What the last Relay's steers and cancels were answered with, in the replay.
    if (adopted) connection.dropOrphans();
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
