import type { AgentProvider } from "./agents";

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

/**
 * A thread can have more shells than its first; each extra one is a slot,
 * keyed `<thread key>~<slot>`. The first shell's slot is "".
 */
export const terminalSlotKey = (key: string, slot: string) =>
  slot ? `${key}~${slot}` : key;
/** The thread key a shell's key belongs to. */
export const terminalBaseKey = (key: string) => key.split("~")[0]!;
export const TERMINAL_SLOT = /^[a-z0-9]{1,12}$/;

export interface TerminalApi {
  /**
   * Opens the thread's shell (the draft's when `chatId` is null) in `slot`,
   * the first one by default, starting it if needed.
   */
  openTerminal(
    projectId: string,
    chatId: string | null,
    size: { cols: number; rows: number },
    fresh?: boolean,
    slot?: string,
  ): Promise<TerminalOpened>;
  /** Ends a shell for good: its tab was closed. */
  closeTerminal(key: string): Promise<void>;
  writeTerminal(key: string, data: string): Promise<void>;
  /**
   * Types the agent's own sign-in command at the shell's prompt; false when a
   * command holds the shell, or the agent signs in through Relay.
   */
  prefillSignIn(key: string, provider: AgentProvider): Promise<boolean>;
  /**
   * Types a command at the shell's prompt for the user to run; false when a
   * command holds the shell, or the shell can't take several lines as one.
   */
  prefillTerminal(key: string, text: string): Promise<boolean>;
  resizeTerminal(key: string, cols: number, rows: number): Promise<void>;
  ackTerminal(key: string, bytes: number): Promise<void>;
  /** Hands the draft's shells to the thread its first message started. */
  adoptTerminal(projectId: string, chatId: string): Promise<void>;
  onTerminal(callback: (event: TerminalEvent) => void): () => void;
}
