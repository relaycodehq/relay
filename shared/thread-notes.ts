// What the user keeps at hand in a thread: a list from an answer, a snippet,
// a decision. Notes live on the thread; a list note's items tick off.
import { z } from "zod";
import type { AgentProvider } from "./agents";

/** The most notes one thread keeps. */
export const NOTES_LIMIT = 50;
export const NOTE_MAX_CHARS = 20000;

export interface ThreadNote {
  /** `n1`, `n2`…, short so an agent can name one. */
  id: string;
  /** Markdown, as kept. */
  text: string;
  /** A list note's ticked items, by their index in `noteList(text).items`. */
  done?: number[];
  /** The message it was kept from, to jump back to. */
  from?: string;
  /** The agent that kept it, at the user's ask; left out when the user did. */
  by?: AgentProvider;
  created: number;
  updated: number;
}

export const noteTextSchema = z.string().trim().min(1).max(NOTE_MAX_CHARS);
export const noteIdSchema = z
  .string()
  .regex(/^n\d{1,6}$/, "A note id is like n3.");

export interface NoteItem {
  /** `3.` for a numbered item, empty for a bullet. */
  number: string;
  /** The item's markdown, its marker left out; nested lines stay indented. */
  text: string;
}

/** A note that is a list, after whatever leads into it. */
export interface NoteList {
  lead: string;
  items: NoteItem[];
}

const ITEM = /^ {0,3}(?:[-*+]|(\d{1,9})[.)])[ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The note as a list to tick off, when it is one: optional lines leading
 * into a single top-level list with nothing after it. Anything else, like a
 * list followed by more prose, is a plain note.
 */
export function noteList(text: string): NoteList | undefined {
  const lines = text.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  let fence: string | undefined;
  let start = -1;
  for (const [index, line] of lines.entries()) {
    const opening = FENCE.exec(line)?.[1];
    if (fence) {
      if (opening && opening[0] === fence[0] && opening.length >= fence.length)
        fence = undefined;
      continue;
    }
    if (opening) {
      fence = opening;
      continue;
    }
    if (ITEM.test(line)) {
      start = index;
      break;
    }
  }
  if (start < 0) return undefined;
  const items: NoteItem[] = [];
  // Where the current item's text starts; lines indented that far are its own.
  let column = 0;
  let blank = false;
  for (const raw of lines.slice(start)) {
    const line = raw.replace(/\t/g, "    ");
    const indent = /^ */.exec(line)![0].length;
    const item = ITEM.exec(line);
    if (!line.trim()) blank = true;
    else if (items.length && indent >= column) {
      items.at(-1)!.text += `\n${blank ? "\n" : ""}${line.slice(column)}`;
      blank = false;
    } else if (item) {
      items.push({ number: item[1] ? `${item[1]}.` : "", text: item[2]! });
      column = line.length - item[2]!.length;
      blank = false;
    } else if (!blank) {
      // A lazy line right under an item still belongs to it.
      items.at(-1)!.text += `\n${line.trim()}`;
    } else return undefined;
  }
  if (items.length < 2) return undefined;
  return { lead: lines.slice(0, start).join("\n").trim(), items };
}

/** Markdown for the draft: only unfinished work, or one unfinished item. */
export function noteQuote(note: ThreadNote, index?: number): string {
  const list = noteList(note.text);
  if (!list) return index === undefined ? note.text : "";
  const done = new Set(note.done);
  const remaining = list.items.filter(
    (_, i) => !done.has(i) && (index === undefined || index === i),
  );
  if (!remaining.length) return "";
  // Preserve the original formatting when nothing has been crossed out.
  if (index === undefined && remaining.length === list.items.length)
    return note.text;
  const items = remaining.map((item) => itemMarkdown(item, item.number));
  return [index === undefined ? list.lead : "", ...items]
    .filter(Boolean)
    .join("\n\n");
}

/** `item` back as markdown behind `number`, or a bullet without one. */
function itemMarkdown(item: NoteItem, number: string) {
  const marker = `${number || "-"} `;
  return item.text
    .split("\n")
    .map((line, i) =>
      i === 0 ? marker + line : line ? " ".repeat(marker.length) + line : "",
    )
    .join("\n");
}

/** Changes whenever the thread's notes do, so a window or phone knows to fetch them. */
export function notesMark(notes: ThreadNote[] | undefined) {
  if (!notes?.length) return undefined;
  return `${notes.length}.${Math.max(...notes.map((n) => n.updated))}`;
}

export interface NewNote {
  text: string;
  from?: string;
  by?: AgentProvider;
}

/** `notes` with `input` kept at the end, unless the same text is kept already. */
export function addNote(
  notes: ThreadNote[] = [],
  input: NewNote,
  now = Date.now(),
): { notes: ThreadNote[]; note: ThreadNote } {
  const text = input.text.trim();
  const same = notes.find((n) => n.text === text);
  if (same) return { notes, note: same };
  if (notes.length >= NOTES_LIMIT)
    throw new Error(
      `A thread keeps at most ${NOTES_LIMIT} notes; remove one first.`,
    );
  const next = Math.max(0, ...notes.map((n) => Number(n.id.slice(1)) || 0)) + 1;
  const note: ThreadNote = {
    id: `n${next}`,
    text,
    ...(input.from ? { from: input.from } : {}),
    ...(input.by ? { by: input.by } : {}),
    created: now,
    updated: now,
  };
  return { notes: [...notes, note], note };
}

function find(notes: ThreadNote[] | undefined, id: string) {
  const note = notes?.find((n) => n.id === id);
  if (!note) throw new Error(`There's no note ${id} in that thread.`);
  return note;
}

/** Ticks a list note's item, numbered from 1 as the user sees it, or unticks it. */
export function tickNote(
  notes: ThreadNote[] | undefined,
  id: string,
  item: number,
  done: boolean,
  now = Date.now(),
): ThreadNote[] {
  const note = find(notes, id);
  const list = noteList(note.text);
  if (!list) throw new Error(`Note ${id} isn't a list.`);
  if (item < 1 || item > list.items.length)
    throw new Error(`Note ${id} has items 1 to ${list.items.length}.`);
  const ticked = new Set(note.done);
  if (done) ticked.add(item - 1);
  else ticked.delete(item - 1);
  const sorted = [...ticked].sort((a, b) => a - b);
  return notes!.map((n) =>
    n === note
      ? {
          ...n,
          ...(sorted.length ? { done: sorted } : { done: undefined }),
          updated: now,
        }
      : n,
  );
}

/**
 * A list note with its items in a new `order`, numbered from 1 as the user
 * sees them; items left out are dropped. Numbers count up again from where
 * the list started and ticks go with their items. Dropping every item drops
 * the note, and one left over makes it a plain note.
 */
export function arrangeNote(
  notes: ThreadNote[] | undefined,
  id: string,
  order: number[],
  now = Date.now(),
): ThreadNote[] {
  const note = find(notes, id);
  const list = noteList(note.text);
  if (!list) throw new Error(`Note ${id} isn't a list.`);
  const count = list.items.length;
  if (order.some((item) => !Number.isInteger(item) || item < 1 || item > count))
    throw new Error(`Note ${id} has items 1 to ${count}.`);
  if (new Set(order).size !== order.length)
    throw new Error("Each item goes in the order once.");
  if (!order.length) return removeNote(notes, id);
  let next = Number.parseInt(list.items[0]!.number, 10) || 1;
  const items = order.map((item) => {
    const kept = list.items[item - 1]!;
    return itemMarkdown(kept, kept.number && `${next++}.`);
  });
  // Items of several paragraphs need the blank lines between them.
  const loose = list.items.some((item) => item.text.includes("\n\n"));
  const body = items.join(loose ? "\n\n" : "\n");
  const text = list.lead ? `${list.lead}\n\n${body}` : body;
  const was = new Set(note.done);
  const done = noteList(text)
    ? order.flatMap((item, index) => (was.has(item - 1) ? [index] : []))
    : [];
  return notes!.map((n) =>
    n === note
      ? {
          ...n,
          text,
          ...(done.length ? { done } : { done: undefined }),
          updated: now,
        }
      : n,
  );
}

export function removeNote(notes: ThreadNote[] | undefined, id: string) {
  find(notes, id);
  return notes!.filter((n) => n.id !== id);
}

/** A note as an agent reads it: list items numbered, ticked ones marked. */
export function noteForAgent(note: ThreadNote) {
  const list = noteList(note.text);
  return {
    id: note.id,
    ...(note.by ? { keptBy: note.by } : {}),
    ...(list
      ? {
          ...(list.lead ? { lead: list.lead } : {}),
          items: list.items.map((item, index) => ({
            item: index + 1,
            text: item.text,
            ...(note.done?.includes(index) ? { done: true } : {}),
          })),
        }
      : { text: note.text }),
  };
}
