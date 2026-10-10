import { z } from "zod";
import {
  customSoundExtensionSchema,
  customSoundMaxBytes,
  soundSettingsSchema,
} from "../../shared/sounds";
import { CustomSounds } from "../sounds";
import { takes, type ApiContext, type Handlers } from "./context";

const idSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(120);
const bytesSchema = z.custom<Uint8Array>(
  (b) =>
    b instanceof Uint8Array &&
    b.byteLength > 0 &&
    b.byteLength <= customSoundMaxBytes,
  "Pick an audio file of up to 4 MB.",
);

/** Settings → Sounds, and the files it plays. */
export function soundHandlers(ctx: ApiContext) {
  const { store } = ctx;
  const custom = new CustomSounds(store);
  return {
    soundSettings: () => store.get().sounds ?? {},
    saveSoundSettings: takes([soundSettingsSchema], async (settings) => {
      await store.update((s) => {
        s.sounds = settings;
      });
      return settings;
    }),
    customSounds: () => custom.list(),
    addCustomSound: takes(
      [nameSchema, customSoundExtensionSchema, bytesSchema],
      (name, ext, bytes) => custom.add(name, ext, bytes),
    ),
    customSoundBytes: takes([idSchema], (id) => custom.bytes(id)),
    removeCustomSound: takes([idSchema], (id) => custom.remove(id)),
  } satisfies Handlers;
}
