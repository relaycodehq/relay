import { useEffect, useState } from "react";
import type { SendRoom } from "../../shared/rooms";

export interface RoomDraft {
  text: string;
  parentId: string | null;
  context?: SendRoom["context"];
  /** The message as last sent, so a retry after a failure keeps its id. */
  pending?: SendRoom;
}

/** The message being written in a PR room, kept on this device until it's sent. */
export function useRoomDraft(storageKey: string) {
  const [draft, setDraft] = useState<RoomDraft>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? {
          text: "",
          parentId: null,
        }
      );
    } catch {
      return { text: "", parentId: null };
    }
  });
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [draft, storageKey]);
  return { draft, setDraft, saveFailed };
}
