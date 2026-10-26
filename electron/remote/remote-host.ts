import type {
  ChatMessage,
  ChatSummary,
  KnownMessages,
  Project,
  ProjectChatPatch,
  ProjectChatSend,
} from "../../shared/projects";
import type {
  ComputerMethod,
  PhoneAppearance,
  RemoteEvent,
  UploadedFile,
} from "../../shared/remote";
import type { PairedComputer } from "../../shared/handoff";
import type { ApiMethod } from "../../shared/types";
import type { DraftDevice, DraftWrite, SharedDraft } from "../../shared/drafts";
import type { ThreadCost } from "../../shared/thread-cost";
import type {
  NewsCatchUp,
  NewsCursor,
  NewsItem,
} from "../../shared/thread-news";
import type { SpeechService } from "./phone-dictation";
import type { VoiceService } from "./phone-read-aloud";

/** What the bridge needs from the desktop; main.ts wires it to the real services. */
export interface RemoteHost {
  projects(): Promise<Project[]>;
  /** The computers this one is paired with, which projects on another computer name. */
  pairedComputers?(): readonly Pick<PairedComputer, "id" | "name">[];
  projectPath(projectId: string): string;
  chats(projectId: string): ChatSummary[];
  chat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  /** What a thread's answers cost, where their agent priced them. */
  cost?(id: string): Promise<ThreadCost | undefined>;
  /** The desktop's own dispatch, which validates every call's arguments. */
  dispatch(method: ApiMethod, args: unknown[]): Promise<unknown>;
  name(): string;
  /** This Relay's version, which the phone compares with its own. */
  version?(): string;
  appearance?(): PhoneAppearance | undefined;
  /** Someone at this computer working in Relay; see ./presence. */
  present?(): boolean;
  /** `dataUrl` at most `max` pixels on its longer side; without it phones get images whole. */
  shrinkImage?(dataUrl: string, max: number): string;
  /** A page an answer showed with show_html. */
  renderPage?(chatId: string, renderId: string, page: number): Promise<string>;
  /** The news after `cursor`; see electron/turns/news. */
  news?(cursor?: NewsCursor): NewsCatchUp;
  /** The speech engine phones dictate with. */
  dictation?: SpeechService;
  /** The voice phones hear answers in. */
  readAloud?: VoiceService;
  /** Keeps a chunk of a file a phone attaches; see ../drafts/uploads. */
  uploadFile?(
    id: string,
    name: string,
    size: number,
    offset: number,
    bytes: Buffer,
  ): Promise<UploadedFile>;
  /** Drafts shared with phones; see ../drafts. */
  drafts?: {
    list(): SharedDraft[];
    write(write: DraftWrite, by: DraftDevice): SharedDraft | null;
    other(key: string, drop: boolean): SharedDraft | null;
    holds(key: string): boolean;
    sendHeld(
      key: string,
      chatId: string | undefined,
      send: ProjectChatSend,
    ): Promise<{ chatId: string }>;
  };
  /** Takes threads other computers hand over; see ../handoff/receiver. */
  handoffs?: {
    handle(
      method: ComputerMethod,
      args: unknown[],
      device: { id: string; name: string },
    ): Promise<unknown>;
    /** Keeps the computers live handoffs came from up to date. */
    connect?(link: { send(deviceId: string, event: RemoteEvent): void }): void;
    chatEvent?(event: { chatId: string; message: ChatMessage }): void;
    chatsChanged?(projectId: string): void;
    news?(item: NewsItem): void;
    /** Ends the shells paired computers opened here, or the device's alone. */
    closeShells?(deviceId?: string): void;
  };
}
