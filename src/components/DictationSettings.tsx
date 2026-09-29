import { Download, Pause, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDialogContainer } from "../lib/useDialogContainer";
import { dictationModel, dictationModelSize } from "../../shared/dictation";
import { api } from "../lib/api";
import {
  setDictationMicrophone,
  useDictationMicrophone,
  useMicrophones,
} from "../lib/dictation/microphones";
import { useDictationModel } from "../lib/dictation/session";
import {
  defaultDictationShortcut,
  setDictationShortcut,
  shortcutFrom,
  shortcutLabel,
  useDictationShortcut,
} from "../lib/dictation/shortcut";
import { ComposerSelect } from "./ComposerSelect";
import "./dictation.css";

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** The speech model's row: what it is and where its download stands. */
export function dictationModelLine(
  state: ReturnType<typeof useDictationModel>,
) {
  switch (state.status) {
    case "ready":
      return `${dictationModel.name} is downloaded. Speech is turned into text on this computer and never leaves it.`;
    case "downloading":
      return `Downloading ${dictationModel.name}… ${megabytes(state.received)} of ${megabytes(state.total)}`;
    case "failed":
      return state.error;
    case "unsupported":
      return "Dictation isn't available on this system yet.";
    case "missing":
      return `${dictationModel.name} turns speech into text on this computer, in English and 24 other European languages. A one-time ${megabytes(dictationModelSize)} download.`;
  }
}

export function DictationModelSetting() {
  const model = useDictationModel();
  if (model.status === "unsupported") return null;
  if (model.status === "downloading")
    return (
      <button onClick={() => void api.cancelDictationDownload()}>
        <Pause size={14} />
        Pause
      </button>
    );
  if (model.status === "ready")
    return (
      <button onClick={() => void api.removeDictationModel()}>
        <Trash2 size={14} />
        Remove
      </button>
    );
  const partial =
    (model.status === "missing" || model.status === "failed") &&
    !!model.received;
  return (
    <button
      className="primary"
      onClick={() => void api.downloadDictationModel()}
    >
      <Download size={14} />
      {partial ? "Resume download" : "Download"}
    </button>
  );
}

/** Click, then press the new combination; Escape keeps the old one. */
export function DictationShortcutSetting() {
  const shortcut = useDictationShortcut();
  const [recording, setRecording] = useState(false);
  const isDefault =
    shortcutLabel(shortcut) === shortcutLabel(defaultDictationShortcut);
  return (
    <span className="settings-keys dictation-shortcut">
      <button
        className="dictation-shortcut-record"
        data-recording={recording || undefined}
        aria-label={
          recording
            ? "Press the new shortcut"
            : `Dictation shortcut ${shortcutLabel(shortcut)}; click to change`
        }
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") return setRecording(false);
          const next = shortcutFrom(e);
          if (!next) return;
          setDictationShortcut(next);
          setRecording(false);
        }}
      >
        {recording ? "Press keys…" : <kbd>{shortcutLabel(shortcut)}</kbd>}
      </button>
      {!isDefault && !recording && (
        <button
          className="dictation-shortcut-reset"
          onClick={() => setDictationShortcut(defaultDictationShortcut)}
        >
          Reset
        </button>
      )}
    </span>
  );
}

export function DictationMicrophoneSetting() {
  const options = useMicrophones();
  const chosen = useDictationMicrophone();
  const [ref, container] = useDialogContainer();
  return (
    <div ref={ref} className="composer-tools model-field">
      <ComposerSelect
        label="Microphone"
        container={container}
        value={options.some((o) => o.value === chosen) ? chosen : ""}
        options={options}
        onChange={setDictationMicrophone}
      />
    </div>
  );
}
