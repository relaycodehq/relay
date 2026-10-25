// What each bridge version adds: a phone or computer speaking at least that
// version may use it. Bump `remoteBridgeVersion` when the bridge gains calls.

/** Bumped when the bridge gains calls; a phone asks for an update of an older desktop. */
export const remoteBridgeVersion = 35;
/**
 * A thread's calls carry what they did (`actions`), and a call that wrote
 * code says so (`wroteCode`); `activityWritten` returns the code.
 */
export const traceTreeBridge = 35;
/** Phones may check whether a pull request merges and merge it (`pullMergeReadiness`, `mergePull`). */
export const mergeBridge = 34;
/** Phones may attach any file (`uploadFile`); the message names the copy saved here. */
export const filesBridge = 33;
/** Sends may ask for the `read-only` runtime mode, and new threads remember theirs. */
export const readOnlyModeBridge = 32;
/** A large phone send arrives in acknowledged batches before being submitted once. */
export const messageBatchesBridge = 31;
/** From here computers carry saved paste files along with sends and handoffs. */
export const pastesBridge = 26;
/**
 * A desktop that reports its bridge in `paired`/`ready` takes a send's `to`;
 * older ones report none and refuse fields they don't know.
 */
export const recipientBridge = 11;
/** From here a desktop reads answers aloud to phones (`readAloud`). */
export const readAloudBridge = 12;
/**
 * From here a desktop sends phones a tool call's output cut to
 * `phoneDetailPreview` characters, and the whole of it on `activityDetail`.
 */
export const activityDetailBridge = 13;
export const phoneDetailPreview = 600;
/** From here a desktop sends a thread's images shrunk to the size a phone shows them (`image`). */
export const imageBridge = 14;

/**
 * From here phones may list a thread's subagents, read one's run (its tool
 * output cut as a thread's is) and stop one, with conditional reads.
 */
export const subagentsBridge = 15;
/** From here a desktop takes `regenerateProjectChatTitle` from phones. */
export const titleBridge = 15;
/** From here thread summaries carry manual unread marks. */
export const markedUnreadBridge = 15;
/** From here phones may call `selectAgentWorktree`, to take a thread off a worktree that is gone. */
export const workspaceBridge = 16;
/** From here phones may fetch the pages an answer showed with show_html (`renderPage`). */
export const renderBridge = 17;
/**
 * From here a desktop shares its drafts with phones (shared/drafts): in the
 * overview, as `draft` events, and through `saveDraft`, `draftOther` and
 * `sendDraft`. Older phones never hear the events, which they'd take for a
 * thread's message.
 */
export const draftsBridge = 19;
/** From here phones may fetch the preview frame a turn kept (`image` with `{kind: "preview"}`). */
export const previewBridge = 22;
/**
 * From here thread summaries carry `notesMark`, and phones may list, tick and
 * remove a thread's notes (`threadNotes`, `tickThreadNote`, `removeThreadNote`).
 */
export const notesBridge = 22;
/** From here a thread carries where it moved (`workspaceMoves`), for the line under its message. */
export const workspaceMovesBridge = 22;
/**
 * From here a desktop sends phones its news as it decides it (`news` events,
 * numbered), and phones catch up on what they missed with `news`. Older
 * phones still read news off the thread lists.
 */
export const newsBridge = 24;
/** From here a paired computer lists its agents' skills and MCP servers (`agentTools`). */
export const agentToolsBridge = 24;

/**
 * From here a desktop tells phones which thread started which and when a
 * limited answer resumes, and takes `setLimitResume` and `closeWatchNote`.
 */
export const awayBridge = 13;
/**
 * From here both ends, once each has said it speaks this bridge, send frames
 * as deflated binary instead of base64 text, the desktop sends streaming
 * answers and thread lists as patches on the last ones (shared/remote-delta),
 * and the phone acknowledges streaming frames so the desktop never sends
 * them faster than the link carries them.
 */
export const compactBridge = 14;
/**
 * From here a computer that took a thread keeps the one it came from up to
 * date (`handoff` events, `handoffChat`) and runs its calls (`handoffCall`),
 * so the thread carries on from there as if it were still there.
 */
export const liveHandoffBridge = 18;
/**
 * From here a live handoff's changes, files, history and Git actions run on
 * the computer the thread is on (`handoffFolderMethods`), not on the copy
 * it left behind.
 */
export const folderHandoffBridge = 20;
/** From here a new thread can start on the computer it's handed to, its first message unanswered here (`HandoffThread.start`). */
export const startHandoffBridge = 20;
/** From here a send may carry the skills its pills picked (`skills`); older computers refuse the field. */
export const skillsBridge = 21;
/**
 * From here a phone may tunnel TCP to the desktop's own loopback
 * (shared/remote-tunnel) and list what listens there (`sites`).
 */
export const tunnelBridge = 23;
/** From here a paired computer clones a project it lacks (`cloneProject`). */
export const cloneBridge = 25;
/**
 * From here, when that clone fails, an agent on the paired computer sets the
 * project up (`setupProject`, `setupProgress`); before, it ran `runCommand`.
 */
export const setupBridge = 27;
/**
 * From here a paired computer hosts projects another computer shows as its
 * own (`Project.computer`): it lists its folders, adds one, starts threads in
 * it and runs its folder's calls (`computerFolders`, `computerAddProject`,
 * `startInProject`, `projectCall`, `computerCall`), and its shells
 * (`projectTerminal`, `terminalCall`, `terminal` events).
 */
export const remoteProjectsBridge = 28;
/**
 * From here a desktop takes `background` frames: while a phone says it's in
 * the background, its events come in a batch every `backgroundBatchMs`
 * (streaming answers only once it's back) and it's ticked a quarter as often,
 * so its radio sleeps between. Older desktops ignore the frame.
 */
export const backgroundBridge = 29;
/** Project setup on a paired computer, including a chosen clone destination. */
export const remoteAddingBridge = 30;

/** The bridge from which phones may call `updateMethods` too. */
export const phoneUpdatesBridge = 11;
