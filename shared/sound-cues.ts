// When a thread sound plays, wherever it plays from: the window while it's
// open, the main process while Relay sits in the menubar alone.
import type { ChatMessage, ChatSummary } from "./projects";
import {
  defaultSoundVolume,
  soundFor,
  type ProjectSounds,
  type SoundEvent,
  type SoundId,
  type SoundSettings,
} from "./sounds";
import { threadNews, type LastAnswer } from "./thread-news";

/** Threads that land together sound once; this long after one sound, the next waits its turn. */
const gatherMs = 250;
const restMs = 1500;
/** The one that sounds when several land together. */
const urgency: Record<SoundEvent, number> = {
  waiting: 3,
  failed: 2,
  finished: 1,
};

export interface SoundCue {
  event: SoundEvent;
  projectId: string;
}

/** The sound for the most urgent cue that has one, at the app's volume. */
export function pickSound(
  cues: readonly SoundCue[],
  app: SoundSettings,
  projectSounds: (projectId: string) => ProjectSounds | undefined,
): { sound: SoundId; volume: number } | undefined {
  let pick: { event: SoundEvent; sound: SoundId } | undefined;
  for (const { event, projectId } of cues) {
    const sound = soundFor(event, app, projectSounds(projectId));
    if (sound && (!pick || urgency[event] > urgency[pick.event]))
      pick = { event, sound };
  }
  return (
    pick && { sound: pick.sound, volume: app.volume ?? defaultSoundVolume }
  );
}

/**
 * Turns thread lists and messages into sounds, by the same rules that ping
 * the phone. A thread an agent started stays quiet when it's done: that agent
 * is the one waiting on it.
 */
export class SoundCues {
  private known = new Map<string, ChatSummary>();
  private answers = new Map<string, LastAnswer & { created: number }>();
  private gathered: SoundCue[] | undefined;
  private restUntil = 0;

  constructor(
    private hooks: {
      /** Whether news of this thread should sound here at all. */
      hears(chatId: string): boolean;
      /** Plays what `pickSound` chose for the cues; false when nothing did. */
      play(cues: SoundCue[]): Promise<boolean>;
    },
  ) {}

  message(chatId: string, m: ChatMessage) {
    if (m.role !== "assistant" || m.parentId) return;
    if (m.compaction || m.handoff || m.reload) return;
    const last = this.answers.get(chatId);
    if (last && last.created > m.created) return;
    this.answers.set(chatId, {
      status: m.status,
      body: m.body,
      error: m.error,
      provider: m.provider,
      created: m.created,
    });
  }

  list(projectId: string, chats: readonly ChatSummary[]) {
    const news = threadNews(this.known, chats, this.answers);
    for (const chat of chats) this.known.set(chat.id, chat);
    const cues = news
      .filter(
        (n) =>
          this.hooks.hears(n.chatId) &&
          !(n.kind === "finished" && this.known.get(n.chatId)?.startedBy),
      )
      .map((n) => ({ event: n.kind, projectId }));
    if (!cues.length) return;
    if (this.gathered) {
      this.gathered.push(...cues);
      return;
    }
    this.gathered = cues;
    setTimeout(() => {
      const all = this.gathered ?? [];
      this.gathered = undefined;
      if (Date.now() < this.restUntil) return;
      void this.hooks.play(all).then(
        (played) => {
          if (played) this.restUntil = Date.now() + restMs;
        },
        () => {},
      );
    }, gatherMs);
  }
}
