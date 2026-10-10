import { expect, it } from "vitest";
import {
  addNote,
  noteForAgent,
  noteList,
  notesMark,
  removeNote,
  tickNote,
} from "./thread-notes";

it("reads a list with the line that leads into it", () => {
  expect(
    noteList(
      "Ideas, cheapest first:\n\n1. Cache **threads**\n2. Skip the heartbeat",
    ),
  ).toEqual({
    lead: "Ideas, cheapest first:",
    items: [
      { number: "1.", text: "Cache **threads**" },
      { number: "2.", text: "Skip the heartbeat" },
    ],
  });
  expect(noteList("- a\n- b")?.items.map((i) => i.number)).toEqual(["", ""]);
});

it("keeps nested lines and code inside their item", () => {
  const list = noteList(
    "3. Outbox\n   - retry after 30 s\n\n   ```ts\n   send()\n   ```\n4. Images",
  );
  expect(list?.items).toEqual([
    {
      number: "3.",
      text: "Outbox\n- retry after 30 s\n\n```ts\nsend()\n```",
    },
    { number: "4.", text: "Images" },
  ]);
});

it("leaves notes that aren't only a list as text", () => {
  expect(noteList("Just a thought")).toBeUndefined();
  expect(noteList("- only one")).toBeUndefined();
  expect(noteList("- a\n- b\n\nAnd then prose after it.")).toBeUndefined();
  // A list inside a code fence is code.
  expect(noteList("```\n- a\n- b\n```")).toBeUndefined();
});

it("keeps, ticks and removes notes, with ids an agent can name", () => {
  let { notes, note } = addNote([], { text: "- a\n- b", from: "m1" }, 1);
  expect(note).toMatchObject({ id: "n1", from: "m1", created: 1 });
  ({ notes } = addNote(notes, { text: "keep `this`", by: "claude" }, 2));
  expect(notes.map((n) => n.id)).toEqual(["n1", "n2"]);
  // The same text again is the note already kept.
  expect(addNote(notes, { text: " - a\n- b " }, 3).notes).toBe(notes);

  notes = tickNote(notes, "n1", 2, true, 4);
  expect(notes[0]).toMatchObject({ done: [1], updated: 4 });
  expect(noteForAgent(notes[0]!)).toEqual({
    id: "n1",
    items: [
      { item: 1, text: "a" },
      { item: 2, text: "b", done: true },
    ],
  });
  expect(() => tickNote(notes, "n1", 3, true)).toThrow("items 1 to 2");
  expect(() => tickNote(notes, "n2", 1, true)).toThrow("isn't a list");
  expect(tickNote(notes, "n1", 2, false)[0]!.done).toBeUndefined();

  expect(notesMark(notes)).toBe("2.4");
  notes = removeNote(notes, "n1");
  expect(addNote(notes, { text: "new" }).note.id).toBe("n3");
  expect(() => removeNote(notes, "n9")).toThrow("no note n9");
  expect(notesMark([])).toBeUndefined();
});
