// Sounds Relay plays when a thread finishes, needs you or fails. The built-in
// ones are synthesized in the window; custom ones are files the main process
// keeps in app data.
import { z } from "zod";
import type { ThreadNews } from "./thread-news";

export type SoundEvent = ThreadNews["kind"];
export const soundEvents = [
  "finished",
  "waiting",
  "failed",
] as const satisfies readonly SoundEvent[];

export const soundEventLabels: Record<SoundEvent, string> = {
  finished: "Done",
  waiting: "Needs you",
  failed: "Failed or stopped",
};

export const soundEventHints: Record<SoundEvent, string> = {
  finished: "A thread finished its answer.",
  waiting: "A question, plan or approval is waiting on you.",
  failed: "An answer failed, or an agent hit its usage limit.",
};

/** Each event's built-ins, in the order the picker lists them; siblings line up across events. */
export const builtInSounds = {
  finished: [
    ["marimba", "Marimba"],
    ["glass", "Glass"],
    ["kalimba", "Kalimba"],
    ["chime", "Chime"],
    ["pluck", "Pluck"],
    ["bubble", "Bubble"],
    ["ratchet", "Ratchet"],
    ["tink", "Tink"],
  ],
  waiting: [
    ["marimba-nudge", "Marimba nudge"],
    ["ask", "Ask"],
    ["kalimba-hang", "Kalimba hang"],
    ["double-ping", "Double ping"],
    ["pluck-ask", "Pluck ask"],
    ["knock", "Knock"],
    ["tap-tap", "Tap tap"],
    ["tink-tink", "Tink tink"],
  ],
  failed: [
    ["fall", "Fall"],
    ["thud", "Thud"],
    ["muted-buzz", "Muted buzz"],
  ],
} as const satisfies Record<SoundEvent, readonly (readonly [string, string])[]>;

export type BuiltInSoundId = (typeof builtInSounds)[SoundEvent][number][0];

const builtInIds = soundEvents.flatMap((e) =>
  builtInSounds[e].map(([id]) => id),
) as [BuiltInSoundId, ...BuiltInSoundId[]];

const customPrefix = "custom:";
/** A built-in's id, or `custom:` and the id of a file the user added. */
export const soundIdSchema = z.union([
  z.enum(builtInIds),
  z.string().regex(/^custom:[0-9a-f-]{36}$/),
]);
export type SoundId = z.infer<typeof soundIdSchema>;

export const customSoundId = (id: string): SoundId => `${customPrefix}${id}`;
/** The file's id for a custom sound, undefined for a built-in. */
export const customFileId = (sound: SoundId) =>
  sound.startsWith(customPrefix) ? sound.slice(customPrefix.length) : undefined;

/** The app's sounds; an event left unset plays nothing, which is how Relay starts. */
export const soundSettingsSchema = z
  .object({
    finished: soundIdSchema.optional(),
    waiting: soundIdSchema.optional(),
    failed: soundIdSchema.optional(),
    /** 0 to 1; unset is `defaultSoundVolume`. */
    volume: z.number().min(0).max(1).optional(),
  })
  .strict();
export type SoundSettings = z.infer<typeof soundSettingsSchema>;
export const defaultSoundVolume = 0.7;

/** A project's own sounds: unset follows the app, "off" keeps that event quiet. */
export const projectSoundsSchema = z
  .object({
    finished: z.union([soundIdSchema, z.literal("off")]).optional(),
    waiting: z.union([soundIdSchema, z.literal("off")]).optional(),
    failed: z.union([soundIdSchema, z.literal("off")]).optional(),
  })
  .strict();
export type ProjectSounds = z.infer<typeof projectSoundsSchema>;

/** What `event` plays in a project with `own` settings, if anything. */
export function soundFor(
  event: SoundEvent,
  app: SoundSettings | undefined,
  own: ProjectSounds | undefined,
): SoundId | undefined {
  const mine = own?.[event];
  if (mine === "off") return undefined;
  return mine ?? app?.[event];
}

export interface CustomSound {
  id: string;
  /** The file's name as added, without its extension. */
  name: string;
}

export const customSoundExtensions = [
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "flac",
] as const;
export type CustomSoundExtension = (typeof customSoundExtensions)[number];
export const customSoundExtensionSchema = z.enum(customSoundExtensions);
/** Long enough for any notification sound; a whole song is a mistake. */
export const customSoundMaxBytes = 4 * 1024 * 1024;
export const customSoundMaxSeconds = 10;

/** A sound for the menubar's hidden player to play; a custom one brings its file. */
export interface PlaySoundEvent {
  sound: SoundId;
  volume: number;
  bytes?: Uint8Array;
}
