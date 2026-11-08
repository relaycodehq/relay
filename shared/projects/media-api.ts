import type { ProjectChatSend } from "./send";

/** The pictures and videos a thread's messages hold, read or show. */
export interface ChatMediaApi {
  projectChatImage(id: string, imageId: string): Promise<string>;
  /** The screenshots of a queued or scheduled message, to take it back with them. */
  projectChatQueuedImages(
    id: string,
    messageId: string,
  ): Promise<NonNullable<ProjectChatSend["images"]>>;
  /** An image file the agent read during the turn `messageId`, as a data URL. */
  projectChatReadImage(
    id: string,
    messageId: string,
    path: string,
  ): Promise<string>;
  /** Where the player streams a video the answer `messageId` embeds from. */
  projectChatVideo(
    id: string,
    messageId: string,
    path: string,
  ): Promise<string>;
  /** The thread's preview as the turn `messageId` left it, as a JPEG data URL. */
  projectChatPreviewShot(id: string, messageId: string): Promise<string>;
  /** Shows that image file in Finder. */
  revealProjectChatReadImage(
    id: string,
    messageId: string,
    path: string,
  ): Promise<void>;
}
