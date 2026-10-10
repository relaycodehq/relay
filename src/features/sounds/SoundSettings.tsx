import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { Project } from "../../../shared/projects";
import {
  builtInSounds,
  customFileId,
  customSoundExtensionSchema,
  customSoundId,
  customSoundMaxBytes,
  customSoundMaxSeconds,
  defaultSoundVolume,
  soundEventLabels,
  type CustomSound,
  type SoundEvent,
  type SoundId,
  type SoundSettings,
} from "../../../shared/sounds";
import { SettingsSelect } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";
import { useProjectSetting } from "../projects/ProjectSettings";
import { forgetSound, playSound, soundLength } from "./player";
import { customSoundsQuery, soundSettingsQuery } from "./state";
import "./sounds.css";

/** The app's sounds, saved as they change; a save on its way shows at once. */
function useSoundSettings() {
  const qc = useQueryClient();
  const saved = useQuery(soundSettingsQuery);
  const saving = useMutation({
    mutationFn: (settings: SoundSettings) => api.saveSoundSettings(settings),
    onSuccess: (settings) =>
      qc.setQueryData(soundSettingsQuery.queryKey, settings),
  });
  return {
    value: saving.isPending ? saving.variables : saved.data,
    error: saved.error ?? saving.error,
    set: saving.mutate,
  };
}

function soundOptions(event: SoundEvent, custom: CustomSound[] | undefined) {
  return [
    ...builtInSounds[event].map(([id, label]) => ({
      value: id as SoundId,
      label,
    })),
    ...(custom ?? []).map((c) => ({
      value: customSoundId(c.id),
      label: c.name,
      description: "Your file",
    })),
  ];
}

function soundName(sound: SoundId, custom: CustomSound[] | undefined) {
  const fileId = customFileId(sound);
  if (fileId) return custom?.find((c) => c.id === fileId)?.name;
  for (const list of Object.values(builtInSounds))
    for (const [id, label] of list) if (id === sound) return label;
}

function TryButton({
  sound,
  volume,
}: {
  sound: SoundId | undefined;
  volume: number;
}) {
  return (
    <button
      type="button"
      className="sound-try"
      disabled={!sound}
      aria-label="Play it"
      title="Play it"
      onClick={() => sound && void playSound(sound, volume).catch(() => {})}
    >
      <Play size={13} />
    </button>
  );
}

/** What one event plays across the app; picking a sound plays it. */
export function SoundEventSetting({ event }: { event: SoundEvent }) {
  const settings = useSoundSettings();
  const custom = useQuery(customSoundsQuery).data;
  const value = settings.value?.[event];
  const volume = settings.value?.volume ?? defaultSoundVolume;
  return (
    <div className="sound-setting">
      <SettingsSelect
        label={soundEventLabels[event]}
        value={value ?? "off"}
        options={[
          { value: "off", label: "No sound" },
          ...soundOptions(event, custom),
        ]}
        onChange={(next) => {
          const sound = next === "off" ? undefined : (next as SoundId);
          settings.set({ ...settings.value, [event]: sound });
          if (sound) void playSound(sound, volume).catch(() => {});
        }}
      />
      <TryButton sound={value} volume={volume} />
      {settings.error && <ErrorBox error={settings.error} />}
    </div>
  );
}

/** One volume for every sound; letting go plays the Done sound at the new level. */
export function SoundVolumeSetting() {
  const settings = useSoundSettings();
  const saved = settings.value?.volume ?? defaultSoundVolume;
  const [volume, setVolume] = useState(saved);
  useEffect(() => setVolume(saved), [saved]);
  const commit = () => {
    if (volume === saved) return;
    settings.set({ ...settings.value, volume });
    void playSound(settings.value?.finished ?? "marimba", volume).catch(
      () => {},
    );
  };
  return (
    <div className="sound-volume">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        aria-label="Volume"
        onChange={(e) => setVolume(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <span className="settings-row-value">{Math.round(volume * 100)}%</span>
    </div>
  );
}

const accept = customSoundExtensionSchema.options.map((e) => `.${e}`).join(",");

/** Files of your own, offered beside the built-ins for every event. */
export function CustomSoundsSetting() {
  const qc = useQueryClient();
  const custom = useQuery(customSoundsQuery);
  const settings = useSoundSettings();
  const volume = settings.value?.volume ?? defaultSoundVolume;
  const input = useRef<HTMLInputElement>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: customSoundsQuery.queryKey }),
      qc.invalidateQueries({ queryKey: soundSettingsQuery.queryKey }),
    ]);
  const add = useMutation({
    mutationFn: async (file: File) => {
      const dot = file.name.lastIndexOf(".");
      const ext = customSoundExtensionSchema.safeParse(
        file.name.slice(dot + 1).toLowerCase(),
      );
      if (dot < 1 || !ext.success)
        throw new Error(`Relay plays ${accept.replaceAll(",", " ")} files.`);
      if (file.size > customSoundMaxBytes)
        throw new Error("That file is too big for a notification sound.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const seconds = await soundLength(bytes).catch(() => {
        throw new Error("That file doesn't play as audio.");
      });
      if (seconds > customSoundMaxSeconds)
        throw new Error(
          `That sound runs ${Math.round(seconds)} seconds; keep it under ${customSoundMaxSeconds}.`,
        );
      return api.addCustomSound(file.name.slice(0, dot), ext.data, bytes);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeCustomSound(id),
    onSuccess: (_, id) => {
      forgetSound(id);
      return refresh();
    },
  });
  return (
    <div className="custom-sounds">
      {custom.data?.map((sound) => (
        <div key={sound.id} className="custom-sound">
          <TryButton sound={customSoundId(sound.id)} volume={volume} />
          <span>{sound.name}</span>
          <button
            type="button"
            className="sound-remove"
            aria-label={`Remove ${sound.name}`}
            title="Remove"
            disabled={remove.isPending}
            onClick={() => remove.mutate(sound.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="sound-add"
        disabled={add.isPending}
        onClick={() => input.current?.click()}
      >
        <Plus size={13} />
        {add.isPending ? "Adding…" : "Add a sound…"}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) add.mutate(file);
        }}
      />
      {!!(add.error || remove.error) && (
        <ErrorBox error={add.error ?? remove.error} />
      )}
    </div>
  );
}

/** What one event plays in a project: like the app, quiet, or a sound of its own. */
export function ProjectSoundSelect({
  project,
  event,
}: {
  project: Project;
  event: SoundEvent;
}) {
  const own = useProjectSetting(project, "sounds");
  const app = useQuery(soundSettingsQuery).data;
  const custom = useQuery(customSoundsQuery).data;
  const value = own.value?.[event];
  const appSound = app?.[event];
  const appLabel = appSound
    ? (soundName(appSound, custom) ?? "a removed sound")
    : "no sound";
  const volume = app?.volume ?? defaultSoundVolume;
  const playing = value === "off" ? undefined : (value ?? appSound);
  return (
    <div className="sound-setting">
      <SettingsSelect
        label={soundEventLabels[event]}
        value={value ?? "app"}
        options={[
          { value: "app", label: `Like the app (${appLabel.toLowerCase()})` },
          { value: "off", label: "No sound" },
          ...soundOptions(event, custom),
        ]}
        onChange={(next) => {
          const sounds = { ...own.value };
          if (next === "app") delete sounds[event];
          else sounds[event] = next as SoundId | "off";
          own.change(Object.keys(sounds).length ? sounds : undefined);
          const heard =
            next === "app"
              ? appSound
              : next === "off"
                ? undefined
                : (next as SoundId);
          if (heard) void playSound(heard, volume).catch(() => {});
        }}
      />
      <TryButton sound={playing} volume={volume} />
      {!!own.error && <ErrorBox error={own.error} />}
    </div>
  );
}
