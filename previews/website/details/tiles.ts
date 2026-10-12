// The tiles, in the order they sit in the carousel. Titles and sentences are
// the section's whole copy; the drawings are in agents.tsx, threads.tsx,
// code.tsx, code-more.tsx and phone.tsx.
import type { ReactNode } from "react";
import type { Category, Loop } from "./kit";
import * as agents from "./agents";
import * as threads from "./threads";
import * as code from "./code";
import * as more from "./code-more";
import * as phone from "./phone-tiles";

export interface TileDef {
  id: string;
  category: Category;
  title: string;
  text: string;
  loop: Loop;
  Tile: (props: { s: number }) => ReactNode;
}

export const tiles: TileDef[] = [
  {
    id: "limit",
    category: "agents",
    title: "A limit doesn't end the answer",
    text: "When an agent hits its usage limit, Relay waits for the reset and has it carry on.",
    loop: agents.limitLoop,
    Tile: agents.LimitTile,
  },
  {
    id: "switch",
    category: "agents",
    title: "Switch agent when one runs dry",
    text: "The first agent writes a handoff note and the second picks up from it.",
    loop: agents.switchLoop,
    Tile: agents.SwitchTile,
  },
  {
    id: "fan",
    category: "agents",
    title: "Agents can start more threads",
    text: "Threads an agent starts sit under the one that asked, with a line on how they're doing.",
    loop: agents.fanLoop,
    Tile: agents.FanTile,
  },
  {
    id: "steer",
    category: "agents",
    title: "Steer in the middle of an answer",
    text: "Send a correction while the agent works, without stopping it.",
    loop: agents.steerLoop,
    Tile: agents.SteerTile,
  },
  {
    id: "ask",
    category: "agents",
    title: "Agents can ask with a page",
    text: "Instead of a wall of questions, the agent shows a small page and you answer on it.",
    loop: agents.askLoop,
    Tile: agents.AskTile,
  },
  {
    id: "know",
    category: "agents",
    title: "A note on what you'd miss",
    text: "Turn on Flag what I'd miss, and after a turn Relay can add a line about something you would likely not notice.",
    loop: agents.knowLoop,
    Tile: agents.KnowTile,
  },
  {
    id: "btw",
    category: "agents",
    title: "Ask a side question",
    text: "Type /btw and the question gets its own small thread while the main one keeps working.",
    loop: agents.btwLoop,
    Tile: agents.BtwTile,
  },
  {
    id: "snooze",
    category: "threads",
    title: "Snooze a thread",
    text: "Hide it until this evening, tomorrow or a time you pick, and it comes back when it's due.",
    loop: threads.snoozeLoop,
    Tile: threads.SnoozeTile,
  },
  {
    id: "later",
    category: "threads",
    title: "Send a message later",
    text: "Right-click Send, pick a time, and it waits in the thread until then.",
    loop: threads.laterLoop,
    Tile: threads.LaterTile,
  },
  {
    id: "settle",
    category: "threads",
    title: "Threads settle on their own",
    text: "After a few quiet days, or once its pull request merges, a thread moves out of your way.",
    loop: threads.settleLoop,
    Tile: threads.SettleTile,
  },
  {
    id: "notes",
    category: "threads",
    title: "Keep a list as a checklist",
    text: "Pin a list or a whole answer to the thread's notes, then tick items off as you go.",
    loop: threads.notesLoop,
    Tile: threads.NotesTile,
  },
  {
    id: "queue",
    category: "threads",
    title: "Queue messages, reorder them",
    text: "Line up what comes next while the agent works, and drag it into the order you want.",
    loop: threads.queueLoop,
    Tile: threads.QueueTile,
  },
  {
    id: "quote",
    category: "threads",
    title: "Quote part of an answer",
    text: "Select a few words and add them to your reply, or keep them in the notes.",
    loop: threads.quoteLoop,
    Tile: threads.QuoteTile,
  },
  {
    id: "split",
    category: "code",
    title: "Split one pile into commits",
    text: "Relay groups your edits into separate commits you can tick, edit and make one by one.",
    loop: code.splitLoop,
    Tile: code.SplitTile,
  },
  {
    id: "message",
    category: "code",
    title: "Commit messages that sound like you",
    text: "The message is drafted from the change, with a count so the subject stays short.",
    loop: code.messageLoop,
    Tile: code.MessageTile,
  },
  {
    id: "rollback",
    category: "code",
    title: "Roll back one turn, or one file",
    text: "Undo what an agent did in a turn, and redo it if you change your mind.",
    loop: code.rollbackLoop,
    Tile: code.RollbackTile,
  },
  {
    id: "refresh",
    category: "code",
    title: "The open file follows the agent",
    text: "A file you have open updates when the agent edits it, and warns you if you have unsaved changes.",
    loop: code.refreshLoop,
    Tile: code.RefreshTile,
  },
  {
    id: "image",
    category: "code",
    title: "See images change side by side",
    text: "A changed image shows before and after next to each other, not as a binary blob.",
    loop: code.imageLoop,
    Tile: code.ImageTile,
  },
  {
    id: "sync",
    category: "code",
    title: "Rebase from one button",
    text: "See what's behind and ahead, rebase in one click, and hand a conflict to a new thread.",
    loop: code.syncLoop,
    Tile: code.SyncTile,
  },
  {
    id: "grey",
    category: "code",
    title: "A greyed button says why",
    text: "Hover a greyed-out item in the Git menu and it says why it can't run.",
    loop: more.greyLoop,
    Tile: more.GreyTile,
  },
  {
    id: "worktree",
    category: "code",
    title: "Move a thread to a worktree mid-conversation",
    text: "Start in the project folder, and when you need it free, move the thread and its edits to a new branch.",
    loop: more.worktreeLoop,
    Tile: more.WorktreeTile,
  },
  {
    id: "draw",
    category: "code",
    title: "Draw on a screenshot",
    text: "Circle what matters and pause: wobbly shapes snap clean. The blur brush hides a secret before you send.",
    loop: more.drawLoop,
    Tile: more.DrawTile,
  },
  {
    id: "table",
    category: "code",
    title: "Tables paste into Sheets as cells",
    text: "Copy a table from an answer and it lands in a spreadsheet as a grid, not a block of text.",
    loop: more.tableLoop,
    Tile: more.TableTile,
  },
  {
    id: "pop",
    category: "code",
    title: "Pop a thread into its own window",
    text: "Give a thread a window of its own, and bring it back with one click.",
    loop: more.popLoop,
    Tile: more.PopTile,
  },
  {
    id: "swipe",
    category: "phone",
    title: "Swipe to settle or snooze",
    text: "Clear your Activity list from the couch: one swipe settles a thread, the other snoozes it.",
    loop: phone.swipeLoop,
    Tile: phone.SwipeTile,
  },
  {
    id: "banner",
    category: "phone",
    title: "A banner when a thread needs you",
    text: "If a thread you're not looking at asks a question, it drops in from the top.",
    loop: phone.bannerLoop,
    Tile: phone.BannerTile,
  },
  {
    id: "hold",
    category: "phone",
    title: "Hold Send to send later",
    text: "Press and hold the send button, pick a time, and the message waits for it.",
    loop: phone.holdLoop,
    Tile: phone.HoldTile,
  },
  {
    id: "clip",
    category: "agents",
    title: "A paperclip that gives you hints",
    text: "While an agent thinks, Clip peeks over the edge with a tip. It's easy to send away.",
    loop: more.clipLoop,
    Tile: more.ClipTile,
  },
];
