# Turn lifecycle

A thread's turns are what Relay runs in it: an answer to a message, a
compaction, a handoff note, a turn the agent started by itself, a deep
review's lead or reviewer, a `/btw` side answer. This document says how Relay
knows which of them run, when one ends, and who hears about it.

## Why

Before this, "is this thread running" was worked out separately in about
seven places: the in-memory map of active turns and its `stopping` and
`finishing` flags, the sidebar summary derived from it, the streaming status
of the last message, side answers, turns the agent started by itself (which no
summary showed), a deep review's status, and a handed-off thread's mirror.
Sounds, notifications and the phone then guessed that "an answer finished" by
comparing one thread list with the next. Each new kind of turn (idle
compaction, cold compaction, `/btw`, limit resume) broke that guess somewhere,
and each fix added an exception to it. The tests inherited the same guess: they
waited for "the last message is complete and nothing holds the thread", and
those waits are where the release builds kept failing.

## The model

**A turn is the only lifecycle.** Each one is a row in the turn ledger
(`electron/turns/`):

| field | meaning |
|---|---|
| `id` | Relay's own id, made when the turn opens |
| `threadId` | the thread it runs in |
| `kind` | `answer`, `adopt` (the agent started it), `lead`, `compaction`, `handoff`, `aside` |
| `parentTurnId` | the turn it serves: a reviewer's under its review's lead, a handoff note under the answer it briefs |
| `provider` | the agent |
| `phase` | `starting` → `running` → (`finishing` \| `stopping`) → `ended` |
| `endedAs` | `completed`, `failed`, `cancelled`, `unstarted`, `interrupted`, `lost` |
| `answerId` | the message the turn writes into, once it has one |
| `startedAt`, `endedAt` | on this computer's clock |

- `starting`: the thread is held, but no agent runs yet: a new worktree is
  being named and set up, the outgoing agent writes its handoff note.
- `running`: the agent works.
- `finishing`: the answer is written; Relay records its changes and saves.
- `stopping`: Stop was pressed. The answer already shows as stopped while the
  agent winds down.
- `ended`: the thread is given back.

Questions and approvals are not a phase. A turn that asks something still
runs; the thread's `waiting` flag says it needs you.

**Runtime handles stay where they are.** `ActiveTurns` keeps what a running
turn needs to be controlled (its abort controller, open requests, steer and
goal callbacks). Every one of its turns carries a ledger id, and every
transition it makes goes through the ledger. Nothing else decides whether a
turn runs.

**One way to change a turn.** `TurnLedger.start`, `.phase` and `.end` write
the turn and an event in one SQLite transaction, then tell subscribers in
sequence order; a subscriber that throws never holds up the turn. A
transition from a turn that already ended is ignored, so a late completion
can't end the turn after it. Codex, which names its turns, ignores a
completion for any turn but the current one.

## What reads it

- **The thread list.** `running` is true while the thread has a turn in
  `starting`, `running` or `finishing` that holds it, or a turn the agent
  started by itself. `stopping` shows while a stopped turn winds down. A
  running thread's summary carries `turn` (id, kind, phase, since). A
  review's summary runs while any of its reviewers' turns does.
- **News.** One place on the computer, `TurnNews` in `electron/turns/`,
  decides what is news, by the rules in `shared/thread-news.ts`: a `finished`
  or `failed` answer as a turn of kind `answer`, `adopt` or `lead` ends, and
  `waiting` when a thread starts needing you. A usage limit is the failed
  answer's news, once. A compaction, a handoff note or a side answer is never
  news, and neither is a stopped or interrupted turn. It's decided as the turn
  ends, from the thread as it reads then, never by comparing one thread list
  with the next. The window's sounds (`relay:thread-news`), the menubar's
  sounds and the phone all get the same items.
- **The phone.** Each news item is numbered, under an epoch that changes when
  Relay restarts. From bridge 24 a phone hears items as `news` events and asks
  `news(cursor)` for what came after the last one it had; one too far behind,
  or from before a restart, starts again from the thread list. The old list
  feed stays for apps that don't ask, and the Kotlin app doesn't ask yet.

## Ending is guaranteed

1. **The owner ends it.** Every turn is opened by the code that runs it, and
   closed in that code's `finally`, through `ActiveTurns.release`. A turn the
   agent started by itself ends there too, not just its handles.
2. **A check catches leaks.** Every 30s the ledger compares its open turns
   with the handles `ActiveTurns` holds. A turn with no handle ended without
   telling the ledger, so it ends as `lost`, with a warning in the log, and
   its thread lists again.
3. **A restart settles the rest.** Turns left open by a Relay that is no
   longer running are looked at on launch. Those whose agent session the agent
   host kept are picked back up, deep review reviewers included, with their
   review waiting on them again. The rest end as `interrupted`.

## Storage

- One SQLite database, `relay.db`, beside the folder Relay keeps threads in,
  opened with `node:sqlite` (Electron's Node and the headless Relay's Node 22
  both have it). WAL journal, `synchronous = NORMAL`.
- Tables: `turns`, the turns still open with who opened them, and
  `events (seq, at, type, turn_id, data)`, what happened to every turn, to
  look back on. Events older than the newest 20,000 are pruned.
- Each Relay process writes its own `owner` id on the turns it opens. On
  launch, only turns whose owner process is gone are recovered, so a second
  Relay on the same folder (a dev switch, a test) can't end the first one's
  turns.
- Messages stay in the thread's JSON file, written as before, so going back
  to an older Relay keeps working.
- Without `node:sqlite`, or with a database it can't read, the ledger keeps
  its turns in memory: everything works except recovery after a restart.

## Tests

- **Scenarios** in `electron/project-chats/turn-lifecycle.test.ts` drive
  threads through `ProjectChats` with stand-in agents
  (`tests/fixtures/turn-scenario.ts`) and check only what a person or a phone
  would see: whether the thread reads running, how many times it was news,
  what the answer ended as, what a phone catching up gets.
- **Replays.** `tests/fixtures/replay-agent.cjs` plays transcripts recorded
  from the real CLIs (`tests/fixtures/replays/`), waiting on what Relay sends
  instead of on time. Transcripts are recorded in a throwaway project with
  empty agent configs and redacted before they're committed; see
  `tests/fixtures/replays/README.md`.
- **Faults.** The replay player can exit instead of the line that ends the
  turn, or cut the stream there. Every scenario must still end its turn.
- `scenario.ended(threadId)` waits for the thread's turns to give it back;
  every wait fails after 20s with what it waited for, so a stuck replay can't
  pass as an expected failure.
