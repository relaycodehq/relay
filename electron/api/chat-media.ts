import { dirname } from "node:path";
import { shell } from "electron";
import { z } from "zod";
import { idSchema } from "../../shared/validation";
import { mediaUrl } from "../media";
import { messageIdSchema, takes, type ApiContext } from "./context";

const mediaPathSchema = z.string().min(1).max(500);

/** The pictures and videos a thread's messages hold, read or show. */
export function chatMediaHandlers({ projectChats }: ApiContext) {
  return {
    projectChatImage: takes([idSchema, idSchema], (id, imageId) =>
      projectChats.files.image(id, imageId),
    ),
    projectChatQueuedImages: takes([idSchema, idSchema], (id, messageId) =>
      projectChats.queuedImages(id, messageId),
    ),
    projectChatReadImage: takes(
      [idSchema, idSchema, mediaPathSchema],
      (id, messageId, path) =>
        projectChats.files.readImage(id, messageId, path),
    ),
    projectChatVideo: takes(
      [idSchema, idSchema, mediaPathSchema],
      async (id, messageId, path) => {
        const full = await projectChats.files.turnVideoPath(
          id,
          messageId,
          path,
        );
        return mediaUrl(full, dirname(full));
      },
    ),
    projectChatPreviewShot: takes(
      [idSchema, messageIdSchema],
      (id, messageId) => projectChats.files.previewShot(id, messageId),
    ),
    revealProjectChatReadImage: takes(
      [idSchema, idSchema, mediaPathSchema],
      async (id, messageId, path) => {
        shell.showItemInFolder(
          await projectChats.files.revealImagePath(id, messageId, path),
        );
      },
    ),
  };
}
