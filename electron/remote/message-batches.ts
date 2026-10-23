import {
  batchableMessage,
  maxBatchedMessageBytes,
  messageBatchBytes,
  type MessageBatchFrame,
} from "../../shared/remote-batches";
import type { ClientFrame } from "../../shared/remote";

type Call = Extract<ClientFrame, { t: "call" }>;
const idleMs = 120_000;

/** Owned by one authenticated socket; incomplete uploads never dispatch a send. */
export class MessageBatches {
  private held = new Map<
    number,
    { chunks: Buffer[]; bytes: number; timer: ReturnType<typeof setTimeout> }
  >();
  private bytes = 0;

  accept(frame: MessageBatchFrame): Call | null {
    const { batch, n, data, last } = frame;
    try {
      if (
        !Number.isSafeInteger(batch) ||
        batch < 1 ||
        !Number.isSafeInteger(n) ||
        n < 0 ||
        typeof last !== "boolean" ||
        typeof data !== "string" ||
        !data.length ||
        data.length > Math.ceil((messageBatchBytes * 4) / 3) ||
        !/^[A-Za-z0-9_-]+$/.test(data)
      )
        throw new Error("Invalid message batch.");
      const chunk = Buffer.from(data, "base64url");
      if (chunk.toString("base64url") !== data)
        throw new Error("Invalid message batch.");
      if (!last && chunk.length !== messageBatchBytes)
        throw new Error("Incomplete message batch.");
      let upload = this.held.get(batch);
      if (!upload) {
        if (n !== 0 || this.held.size >= 2)
          throw new Error("Message upload expired. Send it again.");
        upload = {
          chunks: [],
          bytes: 0,
          timer: setTimeout(() => this.cancel(batch), idleMs),
        };
        this.held.set(batch, upload);
      }
      if (n !== upload.chunks.length)
        throw new Error("Message batches arrived out of order. Send it again.");
      if (this.bytes + chunk.length > maxBatchedMessageBytes)
        throw new Error(
          "This message is too large to send. Remove some attachments and try again.",
        );
      upload.chunks.push(chunk);
      upload.bytes += chunk.length;
      this.bytes += chunk.length;
      upload.timer.refresh();
      if (!last) return null;
      this.cancel(batch);
      const call = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(upload.chunks, upload.bytes),
        ),
      ) as Call;
      if (
        !call ||
        call.t !== "call" ||
        !Array.isArray(call.args) ||
        !batchableMessage(call.method, call.args)
      )
        throw new Error("Only messages can use upload batches.");
      // The last batch's result is the original send's result.
      return { ...call, id: frame.id };
    } catch (error) {
      this.cancel(batch);
      throw error;
    }
  }

  cancel(batch: number) {
    const upload = this.held.get(batch);
    if (!upload) return;
    clearTimeout(upload.timer);
    this.bytes -= upload.bytes;
    this.held.delete(batch);
  }

  close() {
    for (const batch of this.held.keys()) this.cancel(batch);
  }
}
