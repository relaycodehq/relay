import { randomUUID } from "node:crypto";
import {
  agentResponseSchema,
  type AgentRequest,
  type AgentResponse,
  type AskAgentRequest,
} from "../shared/agent-modes";
/** Pending provider requests are local, transient, and bound to the active turn. */
export class AgentRequests {
  private closed = false;
  private pending = new Map<
    string,
    {
      request: AgentRequest;
      resolve: (response: AgentResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  /** `changed` hears each request asked, answered or dropped. */
  constructor(
    private signal: AbortSignal,
    private changed: () => void = () => {},
  ) {}
  list() {
    return structuredClone([...this.pending.values()].map((p) => p.request));
  }
  ask: AskAgentRequest = async (request, providerSignal) => {
    if (this.closed) throw new Error("The agent turn ended.");
    const signal = providerSignal
      ? AbortSignal.any([this.signal, providerSignal])
      : this.signal;
    signal.throwIfAborted();
    if (this.pending.size >= 8)
      throw new Error("Too many pending agent requests.");
    const id = randomUUID();
    return new Promise<AgentResponse>((resolve, reject) => {
      const clear = () => {
        if (this.pending.delete(id)) this.changed();
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        clear();
        reject(new Error("Request cancelled."));
      };
      this.pending.set(id, {
        request: { ...request, id },
        resolve: (response) => {
          clear();
          resolve(response);
        },
        reject: (error) => {
          clear();
          reject(error);
        },
      });
      this.changed();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  };
  respond(id: string, value: AgentResponse) {
    const entry = this.pending.get(id);
    if (!entry)
      throw new Error("This request is no longer waiting for a response.");
    const response = agentResponseSchema.parse(value);
    if (response.kind !== entry.request.kind)
      throw new Error("Invalid response type.");
    if (
      response.kind === "approval" &&
      !entry.request.decisions?.includes(response.decision)
    )
      throw new Error("This decision is not offered by the provider.");
    if (response.kind === "question") {
      const questions = entry.request.questions ?? [];
      if (
        Object.keys(response.answers).some(
          (id) => !questions.some((q) => q.id === id),
        )
      )
        throw new Error("Unknown question.");
      if (questions.some((q) => !response.answers[q.id]?.some((a) => a.trim())))
        throw new Error("Answer each question before continuing.");
    }
    entry.resolve(response);
  }
  close() {
    this.closed = true;
    for (const entry of [...this.pending.values()])
      entry.reject(new Error("The agent turn ended."));
  }
}
