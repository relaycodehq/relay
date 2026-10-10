import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  customFileId,
  customSoundMaxBytes,
  soundEvents,
  type CustomSound,
  type SoundSettings,
} from "../../shared/sounds";
import type { Store } from "../app/store";

export type StoredCustomSound = CustomSound & { ext: string };

/** Sound files the user added, one file each in `sounds/` under app data. */
export class CustomSounds {
  constructor(private store: Store) {}

  private get folder() {
    return join(this.store.dir, "sounds");
  }

  private file(sound: StoredCustomSound) {
    return join(this.folder, `${sound.id}.${sound.ext}`);
  }

  list(): CustomSound[] {
    return (this.store.get().customSounds ?? []).map(({ id, name }) => ({
      id,
      name,
    }));
  }

  async add(name: string, ext: string, bytes: Uint8Array) {
    if (bytes.byteLength > customSoundMaxBytes)
      throw new Error("That file is too big for a notification sound.");
    const sound: StoredCustomSound = { id: randomUUID(), name, ext };
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    await writeFile(this.file(sound), bytes);
    await this.store.update((s) => {
      s.customSounds = [...(s.customSounds ?? []), sound];
    });
    return { id: sound.id, name };
  }

  async bytes(id: string) {
    const sound = this.store.get().customSounds?.find((s) => s.id === id);
    if (!sound) throw new Error("That sound was removed.");
    return new Uint8Array(await readFile(this.file(sound)));
  }

  /** Drops the file, and the app's events that played it go quiet; a project's pick of it plays nothing. */
  async remove(id: string) {
    const sound = this.store.get().customSounds?.find((s) => s.id === id);
    if (!sound) return;
    await this.store.update((s) => {
      s.customSounds = s.customSounds?.filter((c) => c.id !== id);
      if (s.sounds) s.sounds = withoutSound(s.sounds, id);
    });
    await rm(this.file(sound), { force: true });
  }
}

function withoutSound(settings: SoundSettings, id: string): SoundSettings {
  const next = { ...settings };
  for (const event of soundEvents) {
    const sound = next[event];
    if (sound && customFileId(sound) === id) delete next[event];
  }
  return next;
}
