import type { AskAgentRequest } from "../../../shared/agent-modes";
import type { SessionCall } from "./client";
import type { PermissionRequest, QuestionRequest } from "./events";
import {
  askPermission,
  askQuestions,
  readOnlyReply,
  unattendedReject,
  type PermissionAnswer,
  type PermissionGrants,
} from "./permissions";

/** Answers what OpenCode asks during a turn: the user where someone can, a rule where not. */
export class OpenCodeAsks {
  /** The permissions refused, to name when the turn ends without an answer. */
  readonly denied = new Set<string>();
  /** Requests answered or being answered, so one listed again isn't asked twice. */
  private answering = new Set<string>();

  constructor(
    private readonly turn: {
      call: SessionCall;
      sessionID: string;
      signal: AbortSignal;
      /** Who to ask; left out, nobody can answer. */
      ask?: AskAgentRequest;
      grants?: PermissionGrants;
      readOnly?: boolean;
      /** The user cancelled from an ask: the turn stops. */
      cancelled: () => void;
    },
  ) {}

  permission(request: PermissionRequest) {
    if (this.answering.has(request.id)) return;
    this.answering.add(request.id);
    const { call, ask, signal, grants, readOnly } = this.turn;
    void (async () => {
      const answer: PermissionAnswer = grants?.covers(request)
        ? { reply: "once" }
        : ask
          ? await askPermission(request, ask, signal, grants).catch(() => ({
              reply: "reject" as const,
            }))
          : readOnly
            ? readOnlyReply(request)
            : unattendedReject(request);
      if (answer.reply === "reject") this.denied.add(request.permission);
      await call("POST", `/permission/${request.id}/reply`, {
        reply: answer.reply,
        ...(answer.message ? { message: answer.message } : {}),
      });
      // Cancel stops the turn, as Claude's interrupt does.
      if (answer.stop) {
        await call("POST", `/session/${this.turn.sessionID}/abort`).catch(
          () => {},
        );
        this.turn.cancelled();
      }
    })().catch((error) =>
      console.warn("OpenCode permission reply failed:", error),
    );
  }

  question(request: QuestionRequest) {
    if (this.answering.has(request.id)) return;
    this.answering.add(request.id);
    const { call, ask, signal } = this.turn;
    void (async () => {
      if (!ask) return call("POST", `/question/${request.id}/reject`, {});
      try {
        const answers = await askQuestions(request, ask, signal);
        await call("POST", `/question/${request.id}/reply`, { answers });
      } catch {
        await call("POST", `/question/${request.id}/reject`, {});
      }
    })().catch((error) =>
      console.warn("OpenCode question reply failed:", error),
    );
  }
}
