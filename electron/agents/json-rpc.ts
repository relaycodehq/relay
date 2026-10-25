import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { terminate } from "../platform/terminate";
import { LineConnection, type RpcId } from "./line-connection";
import { isRecord } from "../../shared/records";

export type { RpcId } from "./line-connection";

const isId = (value: unknown): value is RpcId =>
  typeof value === "string" || typeof value === "number";

/** JSON-RPC over the lines of a hosted process, for ACP and MSP. */
export abstract class JsonRpcConnection extends LineConnection {
  protected read(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // Some agents log to stdout before they start speaking JSON.
      return;
    }
    if (!isRecord(message)) return;
    const { id, method } = message;
    if (typeof method === "string" && isId(id))
      return void this.answer(id, method, message.params);
    if (typeof method === "string")
      return this.notification(method, message.params);
    if (!isId(id)) return;
    const error = isRecord(message.error) ? message.error : undefined;
    this.settle(
      id,
      error
        ? { error: this.requestError(error, this.methodOf(id)) }
        : { result: message.result },
    );
  }

  protected abstract requestError(
    error: Record<string, unknown>,
    method: string,
  ): Error;

  protected abstract notification(method: string, params: unknown): void;

  protected answer(id: RpcId, method: string, _params: unknown) {
    this.write({
      id,
      error: { code: -32601, message: `Relay doesn't offer ${method}.` },
    });
  }

  protected write(message: object) {
    this.send(JSON.stringify({ jsonrpc: "2.0", ...message }));
  }

  protected endError(reason: string) {
    const log = this.log;
    return new Error(log ? `${reason}\n\n${log.slice(-2000)}` : reason);
  }

  request<T = unknown>(
    method: string,
    params: unknown = {},
    id: number = this.reserve(),
  ): Promise<T> {
    if (this.closed) return Promise.reject(this.stopped());
    const reply = this.wait(id, method) as Promise<T>;
    this.write({ id, method, params });
    return reply;
  }

  notify(method: string, params: unknown = {}) {
    this.write({ method, params });
  }

  protected stop(child: ChildProcessWithoutNullStreams) {
    // Its own group, so the tools it started stop with it.
    terminate(child, { group: true });
  }
}
