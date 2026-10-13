import type { AgentDecision, AgentRequest } from "../../../shared/agent-modes";
import type { AgentOptions } from "../types";
import type { MuseConnection } from "./connection";
import {
  approvalRequestSchema,
  approvalUpdatedSchema,
  commandId,
  userInputRequestSchema,
  type MuseApproval,
  type MuseChoice,
  type MuseUserInput,
} from "./protocol";

/** Which of Muse's decisions each of Relay's answers picks, in order of preference. */
const decisionChoices: Record<AgentDecision, string[]> = {
  accept: ["approved"],
  // Relay's Always holds for the thread, as Muse's session scope does; a
  // policy amendment can outlive the thread, so it is never picked for it.
  acceptForSession: ["approvedForSession"],
  decline: ["denied"],
  cancel: ["abort", "denied"],
};

const choiceFor = (choices: MuseChoice[], decision: AgentDecision) =>
  decisionChoices[decision]
    .map((wanted) => choices.find((choice) => choice.decision === wanted))
    .find(Boolean);

/** What the user sees of an approval: what it would run, write or reach. */
export function approvalPrompt(request: Pick<MuseApproval, "subject" | "toolName" | "subagentOrigin">) {
  const { subject } = request;
  const who = request.subagentOrigin ? "A Muse Code subagent" : "Muse Code";
  const where = [subject.host, subject.port].filter((v) => v != null).join(":");
  switch (subject.kind) {
    case "shell":
    case "process":
      return { title: `${who} wants to run a command`, detail: subject.command ?? subject.target };
    case "fileAccess":
      return {
        title: `${who} wants to ${subject.access === "read" ? "read" : "write"} a file`,
        detail: subject.path ?? subject.target,
      };
    case "network":
      return { title: `${who} wants to reach the network`, detail: where || subject.target };
    case "unixSocket":
      return { title: `${who} wants to use a socket`, detail: subject.path ?? subject.target };
    default:
      return {
        title: `${who} wants to use ${subject.toolName ?? request.toolName ?? "a tool"}`,
        detail: subject.command ?? subject.path ?? subject.target,
      };
  }
}

type Open = { abort: AbortController };

/**
 * A turn's approvals and questions: Muse asks with view notifications and
 * Relay answers with commands. A request settled meanwhile (Muse's own
 * reviewer, a time-out, another client) closes the prompt it opened.
 */
export class MuseRequests {
  private open = new Map<string, Open>();

  constructor(
    private connection: MuseConnection,
    private options: AgentOptions,
    /** Called with every request this turn can't put to anyone. */
    private turnSignal: AbortSignal,
  ) {}

  notification(method: string, params: unknown) {
    switch (method) {
      case "approval/requested": {
        const request = approvalRequestSchema.safeParse(params);
        if (request.success) void this.approval(request.data);
        return true;
      }
      case "approval/updated": {
        // A further stage of the same approval, with choices of its own.
        const update = approvalUpdatedSchema.safeParse(params);
        if (update.success) {
          this.settle(update.data.approvalId);
          void this.approval(update.data);
        }
        return true;
      }
      case "approval/resolved":
        this.settle((params as { approvalId?: string } | null)?.approvalId);
        return true;
      case "userInput/requested": {
        const request = userInputRequestSchema.safeParse(params);
        if (request.success) void this.question(request.data);
        return true;
      }
      case "userInput/settled":
        this.settle((params as { userInputId?: string } | null)?.userInputId);
        return true;
    }
    return false;
  }

  /** Closes every prompt still open: the turn is over. */
  dispose() {
    for (const id of [...this.open.keys()]) this.settle(id);
  }

  private settle(id: string | undefined) {
    if (!id) return;
    this.open.get(id)?.abort.abort();
    this.open.delete(id);
  }

  private track(id: string) {
    this.settle(id);
    const abort = new AbortController();
    this.turnSignal.addEventListener("abort", () => abort.abort(), { once: true });
    this.open.set(id, { abort });
    return abort.signal;
  }

  private async decide(request: Pick<MuseApproval, "approvalId" | "sessionId" | "availableChoices" | "currentRequirementId">, decision: AgentDecision) {
    const choice =
      choiceFor(request.availableChoices, decision) ??
      // Nothing like what Relay meant: refuse, which every approval offers.
      choiceFor(request.availableChoices, "decline");
    if (!choice) return;
    await this.connection
      .request("approval/decide", {
        commandId: commandId(),
        sessionId: request.sessionId,
        approvalId: request.approvalId,
        choiceId: choice.choiceId,
        requirementId: request.currentRequirementId,
      })
      .catch((error) => console.warn("Muse Code didn't take the approval answer:", error));
  }

  private async approval(request: Pick<MuseApproval, "approvalId" | "sessionId" | "availableChoices" | "currentRequirementId" | "subject"> & Partial<MuseApproval>) {
    const { options } = this;
    const signal = this.track(request.approvalId);
    // Helpers and reviewers act alone, and nobody waits on a closed turn.
    if (options.job.kind === "helper" || options.readOnly || !options.onRequest || signal.aborted)
      return this.decide(request, "decline");
    const decisions = (["accept", "acceptForSession", "decline"] as const).filter(
      (decision) => decision === "decline" || choiceFor(request.availableChoices, decision),
    );
    const prompt: Omit<AgentRequest, "id"> = {
      kind: "approval",
      ...approvalPrompt(request),
      decisions,
    };
    const response = await options.onRequest(prompt, signal).catch(() => undefined);
    if (signal.aborted) return;
    this.open.delete(request.approvalId);
    await this.decide(
      request,
      response?.kind === "approval" ? response.decision : "decline",
    );
  }

  private async question(request: MuseUserInput) {
    const { options } = this;
    const signal = this.track(request.userInputId);
    const cancel = () =>
      this.connection
        .request("userInput/cancel", {
          commandId: commandId(),
          sessionId: request.sessionId,
          userInputId: request.userInputId,
        })
        .catch(() => {});
    if (options.job.kind === "helper" || !options.onRequest) return cancel();
    const response = await options
      .onRequest(
        {
          kind: "question",
          title: "Muse Code has a question",
          questions: request.questions.map((q) => ({
            id: q.id,
            header: q.header,
            question: q.question,
            multiple: q.selection?.mode === "multiple",
            options: q.options.map((o) => ({ label: o.label, description: o.description })),
          })),
        },
        signal,
      )
      .catch(() => undefined);
    if (signal.aborted) return;
    this.open.delete(request.userInputId);
    if (response?.kind !== "question") return cancel();
    await this.connection
      .request("userInput/answer", {
        commandId: commandId(),
        sessionId: request.sessionId,
        userInputId: request.userInputId,
        answers: request.questions.map((q) => {
          const given = response.answers[q.id] ?? [];
          const labels = given.filter((a) => q.options.some((o) => o.label === a));
          const free = given.filter((a) => !labels.includes(a)).join("\n");
          return {
            questionId: q.id,
            ...(q.selection?.mode === "multiple"
              ? labels.length ? { selectedLabels: labels } : {}
              : labels[0] ? { selectedLabel: labels[0] } : {}),
            ...(free && { freeText: free }),
          };
        }),
      })
      .catch((error) => console.warn("Muse Code didn't take the answer:", error));
  }
}
