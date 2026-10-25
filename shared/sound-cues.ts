// When a thread sound plays, wherever it plays from: the window while it's
// open, the main process while Relay sits in the menubar alone.
import {
  defaultSoundVolume,
  soundFor,
  type ProjectSounds,
  type SoundEvent,
  type SoundId,
  type SoundSettings,
} from "./sounds";
import type { NewsItem } from "./thread-news";

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
 * Turns the computer's news into sounds. A thread an agent started stays
 * quiet when it's done: that agent is the one waiting on it.
 */
export class SoundCues {
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

  news(item: NewsItem) {
    if (!this.hooks.hears(item.chatId)) return;
    if (item.kind === "finished" && item.byAgent) return;
    const cue = { event: item.kind, projectId: item.projectId };
    if (this.gathered) {
      this.gathered.push(cue);
      return;
    }
    this.gathered = [cue];
    this.playIn(gatherMs);
  }

  /** Plays what gathered once `ms` and any rest after a sound are over; cues meanwhile join in. */
  private playIn(ms: number) {
    setTimeout(() => {
      const resting = this.restUntil - Date.now();
      if (resting > 0) return this.playIn(resting);
      const all = this.gathered ?? [];
      this.gathered = undefined;
      void this.hooks.play(all).then(
        (played) => {
          if (played) this.restUntil = Date.now() + restMs;
        },
        () => {},
      );
    }, ms);
  }
}
