import { useEffect } from "react";
import type { Pull } from "../../../shared/types";
import { api } from "../../lib/api";
import { useStoredFlag } from "../../lib/useStoredFlag";

/**
 * Tells a PR room you're there while its panel is open, and with "Share my
 * place" which file you're on and how many you've viewed. A hidden window
 * shares nothing.
 */
export function useRoomPresence(
  pull: Pull,
  roomId: string | undefined,
  path: string | undefined,
  viewed: number,
) {
  const [share, setShare] = useStoredFlag("relay-share-room-presence");
  useEffect(() => {
    if (!roomId) return;
    const send = () => {
      void api
        .roomPresence(
          pull,
          share && !document.hidden
            ? {
                path: path ?? null,
                head: pull.head.sha,
                viewed,
                total: pull.changed_files,
              }
            : null,
        )
        .catch(() => {});
    };
    send();
    const timer = setInterval(send, 6000);
    document.addEventListener("visibilitychange", send);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
      void api.roomPresence(pull, null).catch(() => {});
    };
  }, [roomId, share, path, pull.head.sha, viewed]);
  return [share, setShare] as const;
}
