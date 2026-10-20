import { JsonRpcConnection, isRecord, type RpcId } from "../json-rpc";

/** A request the agent answered with a JSON-RPC error. */
export class AcpRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data: unknown,
    readonly method: string,
  ) {
    super(message);
    this.name = "AcpRequestError";
  }
}

/** ACP's requests, session updates and errors over the shared process transport. */
export class AcpConnection extends JsonRpcConnection {
  busy = false;
  private listeners = new Map<string, (update: unknown) => void>();
  onRequest?: (method: string, params: unknown) => Promise<unknown>;
  onUpdate?: (update: unknown) => void;

  protected requestError(error: Record<string, unknown>, method: string) {
    return new AcpRequestError(
      typeof error.code === "number" ? error.code : -32603,
      typeof error.message === "string"
        ? error.message
        : `${this.name} failed.`,
      error.data,
      method,
    );
  }

  protected notification(method: string, params: unknown) {
    if (method !== "session/update" || !isRecord(params)) return;
    this.onUpdate?.(params.update);
    if (typeof params.sessionId === "string")
      this.listeners.get(params.sessionId)?.(params.update);
  }

  listen(session: string, handler: (update: unknown) => void) {
    this.listeners.set(session, handler);
  }
  unlisten(session: string) {
    this.listeners.delete(session);
  }

  protected override async answer(id: RpcId, method: string, params: unknown) {
    let reply: object;
    try {
      // Between turns nobody can answer; a permission asked then is declined.
      if (!this.onRequest && method === "session/request_permission")
        return void this.write({
          id,
          result: { outcome: { outcome: "cancelled" } },
        });
      if (!this.onRequest)
        throw new AcpRequestError(
          -32601,
          `Unsupported: ${method}`,
          null,
          method,
        );
      reply = { id, result: (await this.onRequest(method, params)) ?? null };
    } catch (error) {
      reply = {
        id,
        error: {
          code: error instanceof AcpRequestError ? error.code : -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    this.write(reply);
  }
}
