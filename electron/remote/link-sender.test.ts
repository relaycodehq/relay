import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../shared/projects";
import type { RemoteEvent, ServerFrame } from "../../shared/remote";
import { backgroundBatchMs, LinkSender } from "./link-sender";

const answer = (
  body: string,
  status: ChatMessage["status"] = "streaming",
): RemoteEvent => ({
  kind: "message",
  chatId: "c",
  message: {
    id: "m",
    role: "assistant",
    body,
    status,
    created: 1,
    provider: "claude",
    version: 1,
  },
});

/** A link where every frame costs `bytes`, as EDGE would make a big one feel. */
function slowLink(bytes: number) {
  const frames: ServerFrame[] = [];
  let now = 0;
  const link = new LinkSender(
    (f) => (frames.push(f), bytes),
    () => now,
  );
  return { link, frames, wait: (ms: number) => (now += ms) };
}

const s = (f: ServerFrame | undefined) => (f?.t === "event" ? f.s! : NaN);

it("sends only the newest snapshot once a slow link has room again", () => {
  const { link, frames } = slowLink(20_000);
  link.event(answer("One"));
  // The window is full until the phone has the first one.
  link.event(answer("One two"));
  link.event(answer("One two three"));
  expect(frames).toHaveLength(1);

  link.got(s(frames[0]));
  expect(frames).toHaveLength(2);
  expect(frames[1]).toMatchObject({
    event: {
      kind: "messagePatch",
      patch: { body: { from: 3, text: " two three" } },
    },
  });
});

it("never holds back the finished answer or other events", () => {
  const { link, frames } = slowLink(20_000);
  link.event(answer("One"));
  link.event(answer("One two"));
  link.event({ kind: "appearance", appearance: { scheme: "dark" } as never });
  link.event(answer("One two three.", "complete"));
  expect(frames.map((f) => f.t === "event" && f.event.kind)).toEqual([
    "message",
    "appearance",
    "message",
  ]);
  // The held snapshot went with it; an ack late for the first sends nothing stale.
  link.got(s(frames[0]));
  expect(frames).toHaveLength(3);
});

it("stops waiting for an acknowledgement that never comes", () => {
  const { link, frames, wait } = slowLink(20_000);
  link.event(answer("One"));
  link.event(answer("One two"));
  wait(19_000);
  link.event(answer("One two three"));
  expect(frames).toHaveLength(1);
  wait(2_000);
  link.event(answer("One two three four"));
  expect(frames).toHaveLength(2);
});

it("patches against what went out, even when the answer it sent keeps changing", () => {
  const { link, frames } = slowLink(100);
  // A turn's first emit can be the live answer the recorder goes on writing into.
  const first = answer("");
  link.event(first);
  if (first.kind === "message") first.message.body = "Hello ";
  link.event(answer("Hello world"));
  expect(frames[1]).toMatchObject({
    event: { kind: "messagePatch", patch: { body: { from: 0, text: "Hello world" } } },
  });
});

const kinds = (frames: ServerFrame[]) =>
  frames.map((f) => (f.t === "event" ? f.event.kind : f.t));
const appearance: RemoteEvent = {
  kind: "appearance",
  appearance: { scheme: "dark" } as never,
};

afterEach(() => void vi.useRealTimers());

it("sends a phone in the background its events in batches, and no streaming at all", () => {
  vi.useFakeTimers();
  const { link, frames } = slowLink(100);
  link.setBackground(true);
  link.event(answer("One"));
  link.event(appearance);
  link.event(answer("One two"));
  vi.advanceTimersByTime(backgroundBatchMs - 1);
  expect(frames).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(kinds(frames)).toEqual(["appearance"]);

  // The finished answer is what a notification shows, so it goes with the next batch.
  link.event(answer("One two three.", "complete"));
  vi.advanceTimersByTime(backgroundBatchMs);
  expect(kinds(frames)).toEqual(["appearance", "message"]);
  // Nothing new, no batch.
  vi.advanceTimersByTime(backgroundBatchMs * 4);
  expect(frames).toHaveLength(2);
});

it("back from the background, sends what waited and the newest streaming snapshot at once", () => {
  vi.useFakeTimers();
  const { link, frames } = slowLink(100);
  link.event(answer("One"));
  link.setBackground(true);
  link.event(appearance);
  link.event(answer("One two"));
  link.event(answer("One two three"));
  link.setBackground(false);
  expect(kinds(frames)).toEqual(["message", "appearance", "messagePatch"]);
  expect(frames[2]).toMatchObject({
    event: { patch: { body: { from: 3, text: " two three" } } },
  });
  // The batch's timer went with it.
  vi.advanceTimersByTime(backgroundBatchMs);
  expect(frames).toHaveLength(3);
  link.event(answer("One two three four"));
  expect(frames).toHaveLength(4);
});
