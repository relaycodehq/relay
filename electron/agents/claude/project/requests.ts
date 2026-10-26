import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { HostedHandlers } from "../../../agent-host/client";
import {
  SKIPPED_QUESTIONS,
  type AgentQuestion,
  type AskAgentRequest,
} from "../../../../shared/agent-modes";
import { RELAY_SERVER, type ClaudeRunOptions } from "./config";
import { ANSWER_LIMIT } from "../../turn-kit";

/** The session a request comes from, as answering it needs. */
type Asker = {
  options: ClaudeRunOptions;
  /** Set while a session picked up after a restart waits for a turn's options. */
  ready?: { promise: Promise<void> };
  plan: string;
};

/** What Claude Code asks of Relay while a session runs, answered with the current turn's options. */
export function sessionCallbacks(holder: Asker) {
  const promptSubmit = async () => {
    // Claude Code holds the prompt until this returns; a slow scan just skips the note.
    const note = await Promise.race([
      holder.options.context?.().catch(() => undefined),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
    ]);
    return note
      ? {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit" as const,
            additionalContext: note,
          },
        }
      : {};
  };
  const canUseTool: NonNullable<Options["canUseTool"]> = async (
    tool,
    input,
    callback,
  ) => {
    await holder.ready?.promise;
    const options = holder.options;
    // A reviewer or a Read only thread leaves the checkout as it found it, unattended.
    if (options.readOnly) {
      if (tool === "AskUserQuestion" || tool === "ExitPlanMode")
        return {
          behavior: "deny",
          message:
            "Nobody can answer this here. Decide on your own and keep going; ask in your answer if you must.",
        };
      // Claude Code runs the commands it knows only read without asking,
      // so a command that gets here might change files.
      if (tool === "Bash")
        return {
          behavior: "deny",
          message:
            "This thread only reads the code. Run only commands that read, and report what should change instead of changing files.",
        };
      return { behavior: "allow", updatedInput: input };
    }
    // Relay's own tools ask the user themselves where it matters (starting threads).
    if (tool.startsWith(`mcp__${RELAY_SERVER}__`))
      return { behavior: "allow", updatedInput: input };
    if (!options.onRequest)
      return {
        behavior: "deny",
        message: "This caller cannot answer permission requests.",
      };
    if (tool === "AskUserQuestion")
      return askQuestions(input, options.onRequest, callback.signal);
    if (tool === "ExitPlanMode") {
      if (typeof input.plan === "string") {
        holder.plan = input.plan.slice(0, ANSWER_LIMIT);
        options.onPlan?.(holder.plan);
        options.onText(holder.plan);
      }
      return {
        behavior: "deny",
        message:
          "Your plan is shown in Relay. Wait for the user's feedback or implementation request in a later turn.",
      };
    }
    if (options.runtimeMode === "full-access")
      return { behavior: "allow", updatedInput: input };
    const canRemember = !!callback.suggestions?.length;
    const response = await options.onRequest(
      {
        kind: "approval",
        title: `Allow ${tool}?`,
        detail: JSON.stringify(input, null, 2),
        decisions: canRemember
          ? ["accept", "acceptForSession", "decline", "cancel"]
          : ["accept", "decline", "cancel"],
      },
      callback.signal,
    );
    if (response.kind !== "approval")
      return { behavior: "deny", message: "Invalid response." };
    if (
      response.decision === "accept" ||
      response.decision === "acceptForSession"
    )
      return {
        behavior: "allow",
        updatedInput: input,
        ...(response.decision === "acceptForSession"
          ? {
              updatedPermissions: callback.suggestions!.map((s) => ({
                ...s,
                destination: "session" as const,
              })),
            }
          : {}),
      };
    return {
      behavior: "deny",
      message: "Denied by the user.",
      interrupt: response.decision === "cancel",
    };
  };
  // MCP servers ask again on every call (Computer Use twice per action),
  // so remembering a yes is the client's job.
  const allowed = new Set<string>();
  const onElicitation: NonNullable<Options["onElicitation"]> = async (
    request,
    { signal },
  ) => {
    await holder.ready?.promise;
    const { readOnly, onRequest } = holder.options;
    // An approval card answers yes or no, not a form or a sign-in page.
    const fields = Object.keys(
      (request.requestedSchema?.properties as object | undefined) ?? {},
    );
    if (readOnly || !onRequest || request.mode === "url" || fields.length)
      return { action: "decline" };
    const asked = `${request.serverName}\n${request.message}`;
    if (allowed.has(asked)) return { action: "accept", content: {} };
    const response = await onRequest(
      {
        kind: "approval",
        title: request.title ?? request.message,
        detail: `${request.title ? `${request.message}\n\n` : ""}Asked by the ${request.serverName} MCP server.`,
        decisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
      signal,
    );
    if (response.kind !== "approval") return { action: "decline" };
    if (response.decision === "acceptForSession") allowed.add(asked);
    return response.decision === "accept" ||
      response.decision === "acceptForSession"
      ? { action: "accept", content: {} }
      : { action: response.decision };
  };
  return { promptSubmit, canUseTool, onElicitation };
}

export function hostedHandlers(holder: Asker): HostedHandlers {
  const { promptSubmit, canUseTool, onElicitation } = sessionCallbacks(holder);
  return {
    canUseTool,
    onElicitation,
    hooks: { UserPromptSubmit: promptSubmit },
  };
}

/** AskUserQuestion on Relay's card; Claude gets the answers keyed by question. */
async function askQuestions(
  input: Record<string, unknown>,
  ask: AskAgentRequest,
  signal: AbortSignal,
) {
  const questions = ((input.questions as any[]) ?? []).map(
    (q, i): AgentQuestion => ({
      id: String(i),
      header: q.header,
      question: q.question,
      multiple: !!q.multiSelect,
      options: q.options,
    }),
  );
  const response = await ask(
    { kind: "question", title: "Claude needs your input", questions },
    signal,
  );
  if (response.kind !== "question")
    return { behavior: "deny" as const, message: "No answers provided." };
  const answers = response.answers;
  if (!answers)
    return { behavior: "deny" as const, message: SKIPPED_QUESTIONS };
  return {
    behavior: "allow" as const,
    updatedInput: {
      ...input,
      answers: Object.fromEntries(
        questions.map((q) => [q.question, answers[q.id]?.join(", ") ?? ""]),
      ),
    },
  };
}
