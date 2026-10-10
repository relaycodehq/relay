import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Project } from "../../../shared/projects";
import { pickSound, SoundCues } from "../../../shared/sound-cues";
import { openThreadId } from "../thread/arrival";
import { playSound } from "./player";
import { soundSettingsQuery } from "./state";

/** Thread sounds while the window is open; nothing sounds for the thread you're looking at. */
export function followSounds(qc: QueryClient) {
  const cues = new SoundCues({
    hears: (chatId) => !(document.hasFocus() && openThreadId() === chatId),
    async play(heard) {
      // A main process from before sounds has nothing to answer with.
      const app = await qc
        .fetchQuery(soundSettingsQuery)
        .catch(() => undefined);
      if (!app) return false;
      const projects = qc
        .getQueriesData<Project[]>({ queryKey: ["projects"] })
        .flatMap(([, list]) => list ?? []);
      const pick = pickSound(
        heard,
        app,
        (id) => projects.find((p) => p.id === id)?.settings?.sounds,
      );
      if (!pick) return false;
      await playSound(pick.sound, pick.volume).catch(() => {});
      return true;
    },
  });
  const messages = api.onProjectChat((e) => cues.message(e.chatId, e.message));
  const lists = api.onProjectChats((e) => cues.list(e.projectId, e.chats));
  return () => {
    messages();
    lists();
  };
}
