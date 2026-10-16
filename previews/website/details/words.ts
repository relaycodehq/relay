// The section's words, apart from its drawings so the build can put them in
// the page's no-script copy (vite.config.ts) without loading React.
import type { Category } from "./kit";

export const words = [
  {
    id: "handoff",
    category: "threads",
    title: "Hand a running thread to another computer",
    text: "Send it to your desktop at home mid-answer. You keep chatting from the laptop while it runs there, then bring it back.",
  },
  {
    id: "drive",
    category: "agents",
    title: "Ask the agent to run Relay",
    text: "Every thread gets Relay's own tools. Ask it to split work into threads and wait for them, add a project, check your limits or hand itself off.",
  },
  {
    id: "voice",
    category: "agents",
    title: "Voice that stays on your computer",
    text: "Dictate a prompt and hear answers read aloud, both with models running on your machine. The phone borrows them too.",
  },
  {
    id: "limit",
    category: "agents",
    title: "A limit doesn't end the answer",
    text: "When an agent hits its usage limit, Relay waits for the reset and has it carry on.",
  },
  {
    id: "switch",
    category: "agents",
    title: "Switch agent when one runs dry",
    text: "The first agent writes a handoff note and the second picks up from it.",
  },
  {
    id: "know",
    category: "agents",
    title: "A note on what you'd miss",
    text: "Turn on Flag what I'd miss, and after a turn Relay can add a line about something you would likely not notice.",
  },
  {
    id: "btw",
    category: "agents",
    title: "Ask a side question",
    text: "Type /btw and the question gets its own small thread while the main one keeps working.",
  },
  {
    id: "snooze",
    category: "threads",
    title: "Snooze a thread",
    text: "Hide it until this evening, tomorrow or a time you pick, and it comes back when it's due.",
  },
  {
    id: "later",
    category: "threads",
    title: "Send a message later",
    text: "Right-click Send, pick a time, and it waits in the thread until then.",
  },
  {
    id: "notes",
    category: "threads",
    title: "Keep a list as a checklist",
    text: "Pin a list or a whole answer to the thread's notes, then tick items off as you go.",
  },
  {
    id: "rollback",
    category: "code",
    title: "Roll back one turn, or one file",
    text: "Undo what an agent did in a turn, and redo it if you change your mind.",
  },
  {
    id: "sync",
    category: "code",
    title: "Rebase from one button",
    text: "See what's behind and ahead, rebase in one click, and hand a conflict to a new thread.",
  },
  {
    id: "worktree",
    category: "code",
    title: "Move a thread to a worktree mid-conversation",
    text: "Start in the project folder, and when you need it free, move the thread and its edits to a new branch.",
  },
  {
    id: "draw",
    category: "code",
    title: "Draw on a screenshot",
    text: "Circle what matters and pause: wobbly shapes snap clean. The blur brush hides a secret before you send.",
  },
  {
    id: "table",
    category: "code",
    title: "Tables paste into Sheets as cells",
    text: "Copy a table from an answer and it lands in a spreadsheet as a grid, not a block of text.",
  },
  {
    id: "banner",
    category: "phone",
    title: "A banner when a thread needs you",
    text: "If a thread you're not looking at asks a question, it drops in from the top.",
  },
  {
    id: "hold",
    category: "phone",
    title: "Hold Send to send later",
    text: "Press and hold the send button, pick a time, and the message waits for it.",
  },
] as const satisfies readonly {
  id: string;
  category: Category;
  title: string;
  text: string;
}[];

export const quiet = [
  "Plugged in, your computer stays awake. On battery, only while an agent works.",
  "On a server, Relay updates itself once no thread is working.",
  "Send later and limit resumes go out on time after your computer sleeps.",
  "A settled thread finishes quietly.",
  "New worktrees link your node_modules and copy the ignored files your .worktreeinclude names, like .env.",
  "A second Claude account keeps your skills and CLAUDE.md.",
  "/resume brings a terminal session into a thread.",
];
