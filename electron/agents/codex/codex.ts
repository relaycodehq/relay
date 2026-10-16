import {
  codexPolicy,
  codexReviewerPolicy,
  sandboxPolicyFor,
} from "./codex-policy";
import { acquireCodexConnection } from "./codex-connection";
import { codexHelperSandbox } from "./codex-helper-sandbox";
import { codexTurnWatcher } from "./codex-watch";
import { findExecutable } from "../../platform/executables";
import { runAccount } from "../accounts";
import { codexGoals, codexGoalCommand } from "./codex-goal";
import type { AgentOptions } from "../types";
import { codexRequestFailure } from "./codex-limits";
import { turnStartedSchema } from "./codex-schemas";
import { withWorktreeEnv } from "../worktree-env";
import { CodexTurn, codexMentions } from "./codex-turn";
import {
  appServerArgs,
  openCodexThread,
  RELAY_TOKEN_ENV,
} from "./codex-thread";

/** Security and turn policy live here; the wire protocol is in codex-transport. */
export async function runCodex(options: AgentOptions): Promise<string> {
  const { job } = options;
  // Helper jobs are one-offs in a sandbox of Relay's own; a turn that names
  // no mode asks, rather than getting the run of the machine.
  const oneOff = job.kind === "helper";
  const executable = await findExecutable("codex");
  options.signal.throwIfAborted();
  const helper = oneOff
    ? await codexHelperSandbox(executable, options.cwd, options.images)
    : undefined;
  options.signal.throwIfAborted();
  const policy = oneOff
    ? undefined
    : options.readOnly
      ? codexReviewerPolicy
      : codexPolicy(options.runtimeMode ?? "approval-required");
  const sessionKey = policy ? options.session?.key : undefined;
  const account = await runAccount("codex", options.account);
  const connection = await acquireCodexConnection(
    sessionKey,
    executable,
    appServerArgs(options, helper),
    options.cwd,
    {
      ...account,
      env: withWorktreeEnv(account.env, {
        ...options.env,
        ...(options.relayTools
          ? { [RELAY_TOKEN_ENV]: options.relayTools.token }
          : {}),
      }),
    },
  );
  // A thread's goal keeps its run open across the turns Codex starts for it.
  const holds =
    !!policy &&
    !!options.session &&
    (job.kind === "prompt" || job.kind === "adopt" || job.kind === "goal");
  const turn = new CodexTurn(options, connection, sessionKey, holds);
  const { finish, abort } = turn;
  const result = turn.end.promise;
  options.signal.addEventListener("abort", abort, { once: true });
  // Project chats can be stopped by hand; titles and helper jobs run with nobody watching.
  const deadline = policy
    ? undefined
    : setTimeout(
        () =>
          finish(
            new Error(
              "Codex reached the 10-minute question limit. The partial answer was kept.",
            ),
          ),
        600000,
      );
  let succeeded = false;
  connection.onNotification = turn.notification;
  connection.onError = finish;
  connection.onRequest = policy && options.onRequest ? turn.request : undefined;
  try {
    const transport = await connection.ready;
    turn.wire = transport;
    turn.watcher = codexTurnWatcher(connection, transport, options);
    // Relay turns a new goal on behind its first turn; a pause waits for that.
    let activation: Promise<unknown> = Promise.resolve();
    const goalControl = holds
      ? async (command: "pause" | "clear") => {
          await activation.catch(() => {});
          const goal = codexGoals(transport, turn.threadId);
          if (command === "pause")
            turn.goals.seen(await goal.set({ status: "paused" }));
          else {
            await goal.clear();
            turn.goals.seen(null);
          }
        }
      : undefined;
    const steerable = () =>
      options.onControl?.({
        ...(goalControl ? { goal: goalControl } : {}),
        steer: (text, id, images) => turn.steer(text, id, images, !!policy),
      });
    const start = async () => {
      // A turn a restart cut off: the server picked up again holds what it said meanwhile.
      if (job.kind === "adopt") {
        if (!connection.started)
          throw new Error("Codex has no turn of its own to show.");
        turn.threadId = connection.started.thread.id;
        steerable();
        connection.resume();
        if (options.signal.aborted) abort();
        return result;
      }
      const started = await openCodexThread(
        transport,
        connection,
        options,
        policy,
        holds ? turn.goals : undefined,
      );
      const threadId = (turn.threadId = started.thread.id);
      await options.session?.onId(threadId);
      options.signal.throwIfAborted();
      // A goal's own turn: its text, and the goal goes active once it runs.
      let goalTurn: string | undefined;
      if (job.kind === "goal") {
        const next = await codexGoalCommand(
          transport,
          threadId,
          job.command,
          turn.goals,
        );
        if ("reply" in next) {
          turn.said = next.reply;
          options.onText(next.reply);
          finish();
          return result;
        }
        goalTurn = next.turn;
      }
      if (job.kind === "compact") {
        if (!options.session?.id)
          throw new Error("There is no Codex session to compact yet.");
        // Compaction runs as its own turn; turn/started and turn/completed settle it.
        connection.mark("start");
        await transport.request("thread/compact/start", { threadId });
        if (options.signal.aborted) abort();
        return result;
      }
      if (job.kind === "review") {
        connection.mark("start");
        const review = await transport.call(
          "review/start",
          { threadId, target: job.target, delivery: "inline" },
          turnStartedSchema,
        );
        turn.turnId = review.turn.id;
        if (options.signal.aborted) abort();
        return result;
      }
      const note = await options.context?.().catch(() => undefined);
      connection.mark("start");
      const begun = await transport.call(
        "turn/start",
        {
          threadId,
          cwd: options.cwd,
          input: [
            ...(note ? [{ type: "text", text: note, text_elements: [] }] : []),
            ...((goalTurn ?? options.prompt)
              ? [
                  {
                    type: "text",
                    text: codexMentions(goalTurn ?? options.prompt),
                    text_elements: [],
                  },
                ]
              : []),
            ...(options.images ?? []).map((image) => ({
              type: "localImage",
              path: image.path,
            })),
          ],
          model: options.choice.model || null,
          effort: options.choice.reasoningEffort || null,
          serviceTier: options.choice.fast ? "fast" : "default",
          ...(policy
            ? {
                approvalPolicy: policy.approvalPolicy,
                approvalsReviewer: policy.approvalsReviewer,
                sandboxPolicy: sandboxPolicyFor(policy, options.links),
                collaborationMode: {
                  mode: options.interactionMode ?? "default",
                  settings: {
                    // These win over `model` and `effort`; unset, keep what
                    // Codex chose for the thread from its own config.
                    model: options.choice.model || started.model,
                    reasoning_effort:
                      options.choice.reasoningEffort || started.reasoningEffort,
                    developer_instructions: null,
                  },
                },
              }
            : { approvalPolicy: "never", permissions: "relay-one-off" }),
        },
        turnStartedSchema,
      );
      turn.turnId ||= begun.turn.id;
      options.session?.onPoint?.(turn.turnId);
      // Before the goal is on, so a pause can't miss the turn pursuing it.
      steerable();
      if (goalTurn) {
        activation = (async () => {
          try {
            // A turn that already failed leaves the goal off: no run would show it.
            if (!options.signal.aborted && !turn.settled)
              turn.goals.seen(
                await codexGoals(transport, threadId).set({ status: "active" }),
              );
          } finally {
            // The first turn may have ended already; the hold kept the run for it.
            turn.goals.activated();
          }
        })();
        await activation;
      }
      if (options.signal.aborted) abort();
      return result;
    };
    // Stop also needs to interrupt initialization, not wait for its RPC timeout.
    const answer = await Promise.race([start(), result]).catch(
      async (error) => {
        throw codexRequestFailure(await connection.failure(error));
      },
    );
    succeeded = true;
    return answer;
  } finally {
    turn.dispose();
    clearTimeout(deadline);
    options.signal.removeEventListener("abort", abort);
    connection.onNotification = undefined;
    connection.onRequest = undefined;
    connection.onError = undefined;
    connection.busy = false;
    if (!sessionKey || !succeeded || options.signal.aborted)
      await connection.close();
    else connection.mark("end");
  }
}
