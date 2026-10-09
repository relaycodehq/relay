/** A thread can need the user while its agent continues working. */
export interface ThreadInputState {
  running?: boolean;
  waiting?: boolean;
  asking?: true;
  /** A live request blocks the running turn, including one with async questions. */
  blocked?: true;
}

/** Only blocking requests or questions left after the turn stops end an orchestration wait. */
export const inputBlocksThread = (chat: ThreadInputState) =>
  !!chat.waiting && (!chat.running || !chat.asking || !!chat.blocked);
