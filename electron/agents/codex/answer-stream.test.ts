import { expect, it } from "vitest";
import { CodexAnswerStream } from "./answer-stream";

it("keeps live commentary separate from the terminal answer as tools run", () => {
  const bodies: string[] = [];
  const commentary = new Map<string, string>();
  const stream = new CodexAnswerStream(
    (body) => bodies.push(body),
    (id, text) =>
      text === null ? commentary.delete(id) : commentary.set(id, text),
  );
  stream.update("item/started", {
    item: { id: "intro", type: "agentMessage", phase: "commentary" },
  });
  stream.update("item/agentMessage/delta", {
    itemId: "intro",
    delta: "Checking the repo.",
  });
  expect(stream.answer).toBe("");
  expect(commentary.get("intro")).toBe("Checking the repo.");
  stream.update("item/started", {
    item: { id: "final", type: "agentMessage", phase: "final_answer" },
  });
  stream.update("item/agentMessage/delta", {
    itemId: "final",
    delta: "The result",
  });
  stream.update("item/completed", {
    item: {
      id: "final",
      type: "agentMessage",
      phase: "final_answer",
      text: "The result is clear.",
    },
  });
  expect(stream.answer).toBe("The result is clear.");
  expect(bodies).toEqual(["The result", "The result is clear."]);
  expect(commentary.get("intro")).toBe("Checking the repo.");
});

it("treats an unphased last message as the answer and moves earlier prose into commentary", () => {
  const commentary = new Map<string, string>();
  const stream = new CodexAnswerStream(
    () => {},
    (id, text) =>
      text === null ? commentary.delete(id) : commentary.set(id, text),
  );
  stream.update("item/agentMessage/delta", {
    itemId: "first",
    delta: "I will inspect it.",
  });
  expect(stream.answer).toBe("I will inspect it.");
  stream.update("item/completed", {
    item: { id: "second", type: "agentMessage", text: "Done." },
  });
  expect(stream.answer).toBe("Done.");
  expect(commentary.get("first")).toBe("I will inspect it.");
});

it("lets a long turn write any number of progress notes", () => {
  const commentary = new Map<string, string>();
  const stream = new CodexAnswerStream(
    () => {},
    (id, text) =>
      text === null ? commentary.delete(id) : commentary.set(id, text),
  );
  // A long Codex turn writes a note before most tool calls.
  for (let i = 0; i < 150; i++) {
    const item = { id: `note-${i}`, type: "agentMessage", phase: "commentary" };
    stream.update("item/started", { item });
    stream.update("item/agentMessage/delta", {
      itemId: item.id,
      delta: `Checking step ${i}.`,
    });
    stream.update("item/completed", {
      item: { ...item, text: `Checking step ${i}.` },
    });
  }
  stream.update("item/completed", {
    item: {
      id: "final",
      type: "agentMessage",
      phase: "final_answer",
      text: "Done.",
    },
  });
  expect(stream.answer).toBe("Done.");
  expect(commentary.size).toBe(150);
  expect(commentary.get("note-149")).toBe("Checking step 149.");
});

it("keeps each goal turn's answer above as a note once Codex goes on", () => {
  const bodies: string[] = [];
  const commentary = new Map<string, string>();
  const stream = new CodexAnswerStream(
    (body) => bodies.push(body),
    (id, text) =>
      text === null ? commentary.delete(id) : commentary.set(id, text),
  );
  const answer = (id: string, text: string) =>
    stream.update("item/completed", {
      item: { id, type: "agentMessage", phase: "final_answer", text },
    });
  answer("first", "Created one.txt.");
  stream.nextTurn();
  expect(commentary.get("first")).toBe("Created one.txt.");
  expect(stream.answer).toBe("");
  answer("second", "Created two.txt.");
  expect(stream.answer).toBe("Created two.txt.");
  expect(bodies).toEqual(["Created one.txt.", "", "Created two.txt."]);
  // Forgotten: a long goal never fills the stream's message limit.
  for (let turn = 0; turn < 150; turn++) {
    answer(`turn-${turn}`, "Done.");
    stream.nextTurn();
  }
  answer("last", "All three files exist.");
  expect(stream.answer).toBe("All three files exist.");
});
