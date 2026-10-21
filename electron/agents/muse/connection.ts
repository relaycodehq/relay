import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { HostedChild } from "../../agent-host/child";
import { JsonRpcConnection } from "../json-rpc";
import { isRecord } from "../../../shared/records";

/** A request `muse serve` answered with a JSON-RPC error. */
export class MuseRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    /** MSP's stable error category (`error.data.kind`), what Relay branches on. */
    readonly kind: string | undefined,
    readonly data: unknown,
    readonly method: string,
  ) {
    super(message);
    this.name = "MuseRequestError";
  }
}

/** MSP's view notifications and categorized errors over the shared process transport. */
export class MuseConnection extends JsonRpcConnection {
  onNotification?: (method: string, params: unknown) => void;

  constructor(child: ChildProcessWithoutNullStreams | HostedChild) {
    super(child, "Muse Code");
  }

  protected requestError(error: Record<string, unknown>, method: string) {
    return new MuseRequestError(
      typeof error.code === "number" ? error.code : -32603,
      typeof error.message === "string" ? error.message : "Muse Code failed.",
      isRecord(error.data) && typeof error.data.kind === "string"
        ? error.data.kind
        : undefined,
      error.data,
      method,
    );
  }

  protected notification(method: string, params: unknown) {
    this.onNotification?.(method, params);
  }
}
