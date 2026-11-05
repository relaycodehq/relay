import { serialize } from "node:v8";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ChatPushReceiver,
  ChatPushSender,
  type ProjectChatPush,
} from "../../shared/chat-pushes";
import type { ProjectChatEvent } from "../../shared/events";
import type { ChatMessage } from "../../shared/projects";
import { serveChatPushes } from "./chat-pushes";
import type { AppWindow } from "./window";

const ipc = vi.hoisted(() => ({
  resync: (_event: { sender: unknown }) => {},
}));

vi.mock("electron", () => ({
  ipcMain: {
    on: (_channel: string, listener: typeof ipc.resync) =>
      (ipc.resync = listener),
  },
}));

/** A window whose page reads every push the way IPC hands it over: as a copy. */
function page() {
  const got: ProjectChatPush[] = [];
  const webContents = {
    send: (_channel: string, push: ProjectChatPush) =>
      got.push(structuredClone(push)),
  };
  return { got, win: { isDestroyed: () => false, webContents } };
}

let pages: ReturnType<typeof page>[];
let push: (event: ProjectChatEvent) => void;

beforeEach(() => {
  pages = [page(), page()];
  push = serveChatPushes({
    all: () => pages.map((p) => p.win),
    trusts: () => true,
  } as unknown as AppWindow);
});

/**
 * A 50KB answer as its recorder publishes it, a copy every 40ms: about 120
 * new characters a tick, and every 20 ticks a command that prints 1.5KB and
 * finishes 5 ticks later. The last copy is the settled answer.
 */
function* longAnswer(): Generator<ChatMessage> {
  const answer: ChatMessage = {
    id: "a",
    role: "assistant",
    body: "",
    status: "streaming",
    provider: "claude",
    created: 1,
    version: 1,
    trace: [],
    context: { usedTokens: 1000 },
  };
  for (let tick = 1; answer.body.length < 50_000; tick++) {
    answer.body += `Tick ${tick} writes a little more of the answer, the way an agent streams it word by word into the window. `;
    answer.context = { usedTokens: 1000 + tick * 30 };
    if (tick % 20 === 0)
      answer.trace!.push({
        kind: "activity",
        id: `call-${tick}`,
        activity: {
          id: `call-${tick}`,
          kind: "command",
          label: `npm test -- ${tick}`,
          status: "running",
          detail: "ok ".repeat(500),
        },
      });
    for (const entry of answer.trace!)
      if (entry.kind === "activity" && entry.id === `call-${tick - 5}`)
        entry.activity.status = "complete";
    answer.version++;
    yield structuredClone(answer);
  }
  answer.status = "complete";
  answer.version++;
  yield structuredClone(answer);
}

const event = (message: ChatMessage): ProjectChatEvent => ({
  chatId: "t",
  message,
});

it("sends a long streaming answer's new words, not the whole answer every tick", () => {
  const whole: number[] = [];
  const pushed: number[] = [];
  for (const message of longAnswer()) {
    const before = pages[0].got.length;
    push(event(message));
    whole.push(serialize(event(message)).length);
    pushed.push(
      pages[0].got
        .slice(before)
        .reduce((sum, p) => sum + serialize(p).length, 0),
    );
  }
  const sum = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0);
  const streamingTicks = pushed.slice(1, -1).sort((a, b) => a - b);
  // Whole, the last streaming tick took 89KB and the answer 21.7MB in all;
  // as patches a tick took 220 bytes typically, 1.9KB with a call's output,
  // and the answer 276KB.
  expect(streamingTicks[streamingTicks.length >> 1]).toBeLessThan(300);
  expect(streamingTicks.at(-1)).toBeLessThan(2_000);
  expect(sum(pushed)).toBeLessThan(sum(whole) / 70);
});

it("leaves the window holding exactly what whole pushes would", () => {
  const resync = vi.fn();
  const window = new ChatPushReceiver(resync);
  const placed: ChatMessage[] = [];
  for (const message of longAnswer()) {
    const before = pages[0].got.length;
    push(event(message));
    for (const p of pages[0].got.slice(before)) {
      const e = window.take(p);
      if (e) placed.push(e.message);
    }
    expect(placed.at(-1)).toEqual(message);
  }
  expect(pages[0].got.filter((p) => "patch" in p).length).toBeGreaterThan(400);
  expect(resync).not.toHaveBeenCalled();
});

it("sends a page that asked for a resync every streaming answer whole again", () => {
  const stream = longAnswer();
  const first = stream.next().value as ChatMessage;
  const second = stream.next().value as ChatMessage;
  const third = stream.next().value as ChatMessage;
  push(event(first));
  push(event(second));
  // The second window reloaded; its new page starts listening.
  ipc.resync({ sender: pages[1].win.webContents });
  push(event(third));
  expect(pages[0].got.map((p) => "patch" in p)).toEqual([false, true, true]);
  expect(pages[1].got.map((p) => "patch" in p)).toEqual([false, true, false]);
  expect(pages[1].got.at(-1)).toEqual(event(third));
});

it("sends a settled answer whole and starts the next stream of it afresh", () => {
  const stream = [...longAnswer()];
  const settled = stream.at(-1)!;
  push(event(stream[0]));
  push(event(stream[1]));
  push(event(settled));
  // Asked to carry on, the same answer streams again.
  push(
    event({ ...settled, status: "streaming", version: settled.version + 1 }),
  );
  expect(pages[0].got.map((p) => "patch" in p)).toEqual([
    false,
    true,
    false,
    false,
  ]);
});

it("copies only what changed of a streaming answer, and serializes nothing to compare", () => {
  let copied = 0;
  let whole = 0;
  const sender = new ChatPushSender<object>((value) => {
    copied += serialize(value).length;
    return structuredClone(value);
  });
  const window = {};
  const stringify = vi.spyOn(JSON, "stringify");
  for (const message of longAnswer()) {
    sender.pushes(event(message), [window]);
    whole += serialize(message).length;
  }
  expect(stringify).not.toHaveBeenCalled();
  stringify.mockRestore();
  // Copied whole each tick, the answer took 21.6MB; patch by patch 170KB.
  expect(copied).toBeLessThan(whole / 50);
});

it("forgets an answer that stopped streaming unannounced once the turn's answer settles", () => {
  const resync = vi.fn();
  const window = new ChatPushReceiver(resync);
  const placed = new Map<string, ChatMessage>();
  const send = (message: ChatMessage) => {
    const before = pages[0].got.length;
    push(event(message));
    for (const p of pages[0].got.slice(before)) {
      const e = window.take(p);
      if (e) placed.set(e.message.id, e.message);
    }
    return pages[0].got.at(-1)!;
  };
  const streaming = (id: string, body: string, version: number) => ({
    id,
    role: "assistant" as const,
    body,
    status: "streaming" as const,
    provider: "claude" as const,
    created: 1,
    version,
  });
  // The line of a reload that failed, then the next answer.
  send(streaming("dropped", "", 1));
  send(streaming("below", "One", 1));
  expect("patch" in send(streaming("below", "One two", 2))).toBe(true);
  send({ ...streaming("below", "One two.", 3), status: "complete" });
  // Neither end holds the dropped answer now: were it to stream again, it comes whole.
  const again = streaming("dropped", "Back", 2);
  expect("patch" in send(again)).toBe(false);
  expect(placed.get("dropped")).toEqual(again);
  expect(resync).not.toHaveBeenCalled();
});
