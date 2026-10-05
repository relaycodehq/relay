import { findExecutable } from "../../../platform/executables";
import { runAccount } from "../../accounts";
import { AsyncQueue } from "../../../util/async-queue";
import { withTimeout } from "../../../util/timeout";
import type { SessionTotals } from "../watch/spend";
import { sdk, type ClaudeInput, type ClaudeStream } from "./sdk";
import { sessions } from "./session";

/** An earlier question in a side thread, and what Claude said to it. */
export type SideExchange = { question: string; response: string };
type SideAsking = ClaudeStream & {
  askSideQuestion(
    question: string,
    options?: { history?: SideExchange[]; signal?: AbortSignal },
  ): Promise<{ response: string } | null>;
};
/**
 * Claude Code's `/btw`: one answer from the session's context, with no tools,
 * that never enters its transcript. A live session answers even mid-turn;
 * otherwise the saved one is resumed just for this. `history` is the side
 * thread so far; the SDK doesn't type `askSideQuestion` yet.
 */
export async function askClaudeSide(options: {
  key: string;
  thread: string;
  cwd: string;
  model: string;
  account?: string;
  question: string;
  history: SideExchange[];
  signal: AbortSignal;
}): Promise<string> {
  const ask = async (stream: ClaudeStream) => {
    const answer = await (stream as SideAsking).askSideQuestion(
      options.question,
      { history: options.history, signal: options.signal },
    );
    if (!answer?.response.trim())
      throw new Error("Claude had no answer. Try again.");
    return answer.response;
  };
  const live = sessions.get(options.key);
  if (live && !live.frames.ended) return ask(live.stream);
  const [{ query }, executable, { env }] = await Promise.all([
    sdk(),
    findExecutable("claude"),
    runAccount("claude", options.account),
  ]);
  options.signal.throwIfAborted();
  // No prompt ever goes in: the session only loads to answer beside it.
  const input: ClaudeInput = new AsyncQueue();
  const stream = query({
    prompt: input,
    options: {
      cwd: options.cwd,
      pathToClaudeCodeExecutable: executable,
      resume: options.thread,
      env,
      persistSession: false,
      settingSources: ["user", "project", "local"],
      strictMcpConfig: true,
      mcpServers: {},
      ...(options.model ? { model: options.model } : {}),
    },
  });
  void (async () => {
    for await (const _ of stream);
  })().catch(() => {});
  try {
    return await ask(stream);
  } finally {
    input.close();
    stream.close();
  }
}

/** A side question to a live session, mid-turn included; null with no answer. */
export async function askLive(
  stream: ClaudeStream,
  question: string,
  signal: AbortSignal,
): Promise<string | null> {
  const answer = await (stream as SideAsking).askSideQuestion(question, {
    signal,
  });
  return answer?.response.trim() || null;
}

/** What the session has spent so far, side questions included. */
export async function sessionTotals(
  stream: ClaudeStream,
): Promise<SessionTotals> {
  const { session } = await withTimeout(
    stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    }),
    5000,
    "Claude did not report usage.",
  );
  return { usd: session.total_cost_usd, models: session.model_usage };
}
