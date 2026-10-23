import { afterEach, expect, it, vi } from "vitest";
import { MessageBatches } from "./message-batches";
import {
  maxBatchedMessageBytes,
  messageBatchBytes,
  type MessageBatchFrame,
} from "../../shared/remote-batches";

const receivers: MessageBatches[] = [];
afterEach(() => {
  for (const receiver of receivers.splice(0)) receiver.close();
  vi.useRealTimers();
});
const receiver = () => {
  const result = new MessageBatches();
  receivers.push(result);
  return result;
};
const first = (batch = 1): MessageBatchFrame => ({
  t: "batch",
  id: 2,
  batch,
  n: 0,
  data: Buffer.alloc(messageBatchBytes, 32).toString("base64url"),
  last: false,
});
const last = (
  batch = 1,
  method = "desktop",
  args: unknown[] = ["sendProjectChat", ["chat", { body: "čau 🌍" }]],
): MessageBatchFrame => ({
  t: "batch",
  id: 3,
  batch,
  n: 1,
  data: Buffer.from(
    JSON.stringify({ t: "call", id: 1, method, args }),
  ).toString("base64url"),
  last: true,
});

it("holds every piece until the last and returns the original request under the final call id", () => {
  const batches = receiver();
  expect(batches.accept(first())).toBeNull();
  expect(batches.accept(last())).toEqual({
    t: "call",
    id: 3,
    method: "desktop",
    args: ["sendProjectChat", ["chat", { body: "čau 🌍" }]],
  });
  expect(() => batches.accept(last())).toThrow(/expired/);
});

it("also assembles shared-draft sends through the same path", () => {
  const batches = receiver();
  batches.accept(first());
  expect(
    batches.accept(last(1, "sendDraft", ["draft", null, { body: "hi" }]))
      ?.method,
  ).toBe("sendDraft");
});

it("discards an out-of-order upload before allowing a fresh retry", () => {
  const batches = receiver();
  batches.accept(first());
  expect(() => batches.accept({ ...last(), n: 2 })).toThrow(/out of order/);
  expect(() => batches.accept(last())).toThrow(/expired/);
  batches.accept(first());
  expect(batches.accept(last())).not.toBeNull();
});

it("releases cancelled, idle and disconnected uploads", () => {
  vi.useFakeTimers();
  const batches = receiver();
  batches.accept(first());
  batches.cancel(1);
  expect(() => batches.accept(last())).toThrow(/expired/);
  batches.accept(first());
  vi.advanceTimersByTime(120_000);
  expect(() => batches.accept(last())).toThrow(/expired/);
  batches.accept(first());
  batches.close();
  expect(() => batches.accept(last())).toThrow(/expired/);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds parallel uploads and refuses malformed or tiny intermediate pieces", () => {
  const batches = receiver();
  batches.accept(first(1));
  batches.accept(first(2));
  expect(() => batches.accept(first(3))).toThrow(/expired/);
  expect(() => batches.accept({ ...first(3), data: "!" })).toThrow(/Invalid/);
  expect(() => batches.accept({ ...first(3), data: "YQ" })).toThrow(
    /Incomplete/,
  );
});

it("never uses batches to bypass the normal method allowlist", () => {
  const batches = receiver();
  batches.accept(first());
  expect(() =>
    batches.accept(last(1, "desktop", ["projectGitAction", []])),
  ).toThrow(/Only messages/);
  batches.accept(first());
  expect(() => batches.accept({ ...last(), data: "_w" })).toThrow();
});

it("enforces the byte budget and frees the rejected upload immediately", () => {
  const batches = receiver();
  const part = first();
  const count = Math.floor(maxBatchedMessageBytes / messageBatchBytes);
  for (let n = 0; n < count; n++)
    expect(batches.accept({ ...part, n })).toBeNull();
  expect(() => batches.accept({ ...part, n: count })).toThrow(/too large/);
  expect(() => batches.accept(last())).toThrow(/expired/);
  expect(batches.accept(first())).toBeNull();
});
