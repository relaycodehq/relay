import { expect, it } from "vitest";
import type { ChatMessage } from "../../shared/projects";
import type { RemoteEvent, ServerFrame } from "../../shared/remote";
import { LinkSender } from "./link-sender";

const answer = (
  body: string,
  status: ChatMessage["status"] = "streaming",
): RemoteEvent => ({
  kind: "message",
  chatId: "c",
  message: { id: "m", role: "assistant", body, status, created: 1, provider: "claude", version: 1 },
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
    event: { kind: "messagePatch", patch: { body: { from: 3, text: " two three" } } },
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
