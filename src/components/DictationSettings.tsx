import { Download, Pause, Trash2 } from "lucide-react";
import { dictationModel, dictationModelSize } from "../../shared/dictation";
import { api } from "../lib/api";
import {
  setDictationMicrophone,
  useDictationMicrophone,
  useMicrophones,
} from "../lib/dictation/microphones";
import { useDictationModel } from "../lib/dictation/session";
import { SettingsSelect } from "./SettingsCard";
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

export function DictationMicrophoneSetting() {
  const options = useMicrophones();
  const chosen = useDictationMicrophone();
  return (
    <SettingsSelect
      label="Microphone"
      value={options.some((o) => o.value === chosen) ? chosen : ""}
      options={options}
      onChange={setDictationMicrophone}
    />
  );
}
