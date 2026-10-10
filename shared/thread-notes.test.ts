import { expect, it } from "vitest";
import {
  addNote,
  arrangeNote,
  noteForAgent,
  noteList,
  noteQuote,
  notesMark,
  removeNote,
  tickNote,
  type ThreadNote,
} from "./thread-notes";

const note = (text: string, done?: number[]): ThreadNote => ({
  id: "n1",
  text,
  done,
  created: 1,
  updated: 1,
});

it("quotes only unfinished items, keeping the lead and original item numbers", () => {
  const text =
    "Next:\n\n1. Already fixed\n2. Still needed\n3. Also fixed\n4. Last job";
  expect(noteQuote(note(text, [0, 2]))).toBe(
    "Next:\n\n2. Still needed\n\n4. Last job",
  );
  expect(noteQuote(note(text, [0, 1, 2, 3]))).toBe("");
  expect(noteQuote(note(text, [0]), 0)).toBe("");
  expect(noteQuote(note(text, [0]), 1)).toBe("2. Still needed");
  expect(noteQuote(note(text), 9)).toBe("");
});

it("preserves nested lists, paragraphs and code in bulk and individual quotes", () => {
  const text =
    "Jobs:\n\n9. Finished\n10. **Remaining**\n    - child\n\n    More context.\n\n    ```ts\n    run()\n    ```";
  const expected =
    "10. **Remaining**\n    - child\n\n    More context.\n\n    ```ts\n    run()\n    ```";
  expect(noteQuote(note(text, [0]))).toBe(`Jobs:\n\n${expected}`);
  expect(noteQuote(note(text), 1)).toBe(expected);
  expect(noteQuote(note("- done\n- remaining\n  - child", [0]))).toBe(
    "- remaining\n  - child",
  );
});

it("leaves plain notes and untouched lists intact, and restores unchecked work", () => {
  for (const text of [
    "A **decision**",
    "```ts\nrun()\n```",
    "Ideas:\n\n* a\n* b",
  ]) {
    expect(noteQuote(note(text))).toBe(text);
    expect(noteQuote(note(text, [99]))).toBe(text);
  }
  const original = note("- a\n- b", [0, 1]);
  const restored = tickNote([original], "n1", 1, false)[0]!;
  expect(noteQuote(restored)).toBe("- a");
  expect(original.done).toEqual([0, 1]);
});

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

it("reorders and drops list items, numbering them again and keeping their ticks", () => {
  const text =
    "Next:\n\n1. First\n2. **Second**\n   - child\n3. Third\n4. Fourth";
  const [moved] = arrangeNote([note(text, [0, 2])], "n1", [3, 2, 1], 5);
  expect(moved!.text).toBe(
    "Next:\n\n1. Third\n2. **Second**\n   - child\n3. First",
  );
  expect(moved!.done).toEqual([0, 2]);
  expect(moved!.updated).toBe(5);
  expect(noteList(moved!.text)!.items.map((item) => item.text)).toEqual([
    "Third",
    "**Second**\n- child",
    "First",
  ]);
  // A list that started at 9 still does, and a wider number re-indents its lines.
  const [late] = arrangeNote(
    [note("9. a\n10. b\n    more")],
    "n1",
    [2, 1],
  );
  expect(late!.text).toBe("9. b\n   more\n10. a");
  expect(arrangeNote([note("- a\n- b\n- c")], "n1", [3, 1])[0]!.text).toBe(
    "- c\n- a",
  );
});

it("turns a list arranged down to one item into a plain note, and none into no note", () => {
  const [one] = arrangeNote([note("1. a\n2. b", [1])], "n1", [2]);
  expect(one!.text).toBe("1. b");
  expect(one!.done).toBeUndefined();
  expect(arrangeNote([note("1. a\n2. b")], "n1", [])).toEqual([]);
  expect(() => arrangeNote([note("1. a\n2. b")], "n1", [1, 1])).toThrow();
  expect(() => arrangeNote([note("1. a\n2. b")], "n1", [3])).toThrow();
  expect(() => arrangeNote([note("just text")], "n1", [1])).toThrow();
});
