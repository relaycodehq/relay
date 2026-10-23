/** Upload large sends in acknowledged pieces, then run the original call once. */
export const messageBatchBytes = 3 * 1024 * 1024;
/** Bound incomplete uploads by bytes, independently of attachment count. */
export const maxBatchedMessageBytes = 128 * 1024 * 1024;

export function batchableMessage(method: string, args: unknown[]): boolean {
  return (
    method === "sendDraft" ||
    (method === "desktop" && args[0] === "sendProjectChat")
  );
}

export interface MessageBatchFrame {
  t: "batch";
  id: number;
  batch: number;
  n: number;
  data: string;
  last: boolean;
}
