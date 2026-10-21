import { keys } from "../../../lib/mod-key";
import {
  queueKeyLabel,
  setRunningSendAction,
  setSendKey,
  steerKeyLabel,
  useRunningSendAction,
  useSendKey,
  type RunningSendAction,
  type SendKey,
} from "../../../lib/send-key";
import { setCacheHeat, useCacheHeat } from "../../agents/cache-heat";
import { CacheHeatDemo } from "../../agents/CacheHeatDemo";
import {
  setAccessNamed,
  useAccessNamed,
} from "../../composer/composer-toolbar";
import {
  ComposerToolbarReset,
  ComposerToolbarSettings,
} from "../../composer/ComposerToolbarSettings";
import { setImagePills, useImagePills } from "../../images/image-pills";
import { api } from "../../../lib/api";
import { Segmented, Switch } from "../../../ui/SettingsCard";
import { ErrorBox } from "../../../ui/ui";
import type { SettingEntry } from "../settings-search";
import { useSavedSetting } from "../useSavedSetting";

/** Settings → Composer: what it shows, and what Send does. */
export function useComposerEntries(): SettingEntry[] {
  const accessNamed = useAccessNamed();
  const cacheHeat = useCacheHeat();
  const imagePills = useImagePills();
  const sendKey = useSendKey();
  const runningAction = useRunningSendAction();
  return [
    {
      id: "composer-toolbar",
      category: "composer",
      section: "Toolbar",
      title: "Composer toolbar",
      description: "Drag to reorder. Drop below the bar to hide.",
      keywords:
        "composer toolbar order reorder arrange move hide drag controls buttons usage limit quota session weekly ring meter context model effort access mode plan attach dictation microphone",
      block: true,
      accessory: () => <ComposerToolbarReset />,
      render: () => <ComposerToolbarSettings />,
    },
    {
      id: "access-name",
      category: "composer",
      section: "Toolbar",
      title: "Access mode's name",
      description:
        "The composer writes the access mode beside its icon. Off leaves the icon alone, a closed lock for Supervised and an open one for Full access; hover it or open it for the name.",
      keywords:
        "access permissions runtime mode supervised full access auto lock icon label name composer toolbar",
      render: () => (
        <Switch
          label="Name the access mode"
          checked={accessNamed}
          onChange={setAccessNamed}
        />
      ),
    },
    {
      id: "cache-heat",
      category: "composer",
      section: "Toolbar",
      title: "Prompt cache fire and ice",
      description:
        "Flames on the context meter while the prompt cache is fresh, an ice cube once it has expired. Right-click the ring to put it out for one chat.",
      keywords: "prompt cache fire flame ice cold fresh context meter ring",
      render: () => (
        <>
          <CacheHeatDemo />
          <Switch
            label="Show prompt cache fire and ice"
            checked={cacheHeat}
            onChange={setCacheHeat}
          />
        </>
      ),
    },
    {
      id: "send-key",
      category: "composer",
      section: "Sending",
      title: "Send messages with",
      description: {
        enter: "Enter sends the message. Shift+Enter adds a new line.",
        "shift-enter": "Shift+Enter sends the message. Enter adds a new line.",
        "mod-enter": `${keys("⌘", "Ctrl+")}Enter sends the message. Enter adds a new line.`,
      }[sendKey],
      keywords:
        "enter return send submit message newline composer chat keyboard shortcut",
      render: () => (
        <Segmented<SendKey>
          value={sendKey}
          options={[
            ["enter", "Enter"],
            ["shift-enter", "Shift Enter"],
            ["mod-enter", `${keys("⌘", "Ctrl ")}Enter`],
          ]}
          onChange={setSendKey}
        />
      ),
    },
    {
      id: "running-send-action",
      category: "composer",
      section: "Sending",
      title: "While an agent is running",
      description:
        runningAction === "queue"
          ? `Your send key queues the message for after the answer finishes. ${steerKeyLabel(sendKey, runningAction)} steers immediately.`
          : `Your send key steers the current answer immediately. ${queueKeyLabel(sendKey, runningAction)} queues instead.`,
      keywords:
        "enter return send submit message composer chat queue steer follow-up interrupt keyboard shortcut",
      render: () => (
        <Segmented<RunningSendAction>
          label="While an agent is running"
          value={runningAction}
          options={[
            ["queue", "Queue"],
            ["steer", "Steer"],
          ]}
          onChange={setRunningSendAction}
        />
      ),
    },
    {
      id: "composer-predictions",
      category: "composer",
      section: "Sending",
      title: "Suggest my next message",
      description:
        "After a Claude or Codex turn that did real work, the agent guesses what you'd send next and the empty composer shows it as a draft; Tab takes it. One extra question per turn on the thread's own session, mostly read from its prompt cache, counted against that account.",
      keywords:
        "predict prediction suggest suggestion next message ghost draft autocomplete tab complete composer",
      render: () => <PredictionsSwitch />,
    },
    {
      id: "image-pills",
      category: "composer",
      section: "Screenshots",
      title: "Screenshots in the message",
      description:
        "A pasted or dropped screenshot also goes into the text as a pill, which the agent reads as [Image #1]. Off keeps screenshots above the message only.",
      keywords:
        "screenshot image picture paste drop attach pill chip inline thumbnail composer message",
      render: () => (
        <Switch
          label="Put screenshots in the message"
          checked={imagePills}
          onChange={setImagePills}
        />
      ),
    },
  ];
}

function PredictionsSwitch() {
  const predictions = useSavedSetting(
    {
      queryKey: ["composer-predictions"],
      queryFn: () => api.composerPredictions(),
    },
    (enabled) => api.saveComposerPredictions(enabled),
    ["composer-predictions"],
  );
  return (
    <>
      <Switch
        label="Suggest my next message"
        checked={predictions.value ?? false}
        disabled={!predictions.loaded || predictions.saving}
        onChange={(enabled) => predictions.set(enabled)}
      />
      {predictions.error && <ErrorBox error={predictions.error} />}
    </>
  );
}
