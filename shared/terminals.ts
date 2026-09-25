/** Output from a thread's shell, or its exit; -1 when Relay ended it. */
export type TerminalEvent =
  | { key: string; data: string; exitCode?: undefined }
  | { key: string; exitCode: number; data?: undefined };

export interface TerminalOpened {
  cwd: string;
  /** Recent output, when the shell was already running. */
  backlog: string;
  exitCode?: number;
}

/** A thread's shell is keyed by its chat id, a draft's by `draft:<projectId>`. */
export const draftTerminalKey = (projectId: string) => `draft:${projectId}`;

export interface TerminalApi {
  /** Opens the thread's shell (the draft's when `chatId` is null), starting it if needed. */
  openTerminal(
    projectId: string,
    chatId: string | null,
    size: { cols: number; rows: number },
    fresh?: boolean,
  ): Promise<TerminalOpened>;
  writeTerminal(key: string, data: string): Promise<void>;
  /** Types the Claude sign-in command at the shell's prompt; false when a command holds the shell. */
  prefillClaudeSignIn(key: string): Promise<boolean>;
  resizeTerminal(key: string, cols: number, rows: number): Promise<void>;
  ackTerminal(key: string, bytes: number): Promise<void>;
  closeTerminal(key: string): Promise<void>;
  /** Hands the draft's shell to the thread its first message started. */
  adoptTerminal(projectId: string, chatId: string): Promise<void>;
  onTerminal(callback: (event: TerminalEvent) => void): () => void;
}
