import { Download, Pause, Play, Square, Trash2 } from "lucide-react";
import {
  readAloudChoice,
  readAloudSpeeds,
  type ReadAloudEngineInfo,
  type ReadAloudSettings,
  type ReadAloudState,
} from "../../../shared/read-aloud";
import { api } from "../../lib/api";
import { SettingsSelect } from "../../ui/SettingsCard";
import { startReading, stopReading, useReading } from "./playback";
import "./read-aloud.css";

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
const sampleKey = "settings-sample";
const sample =
  "Here's how answers will sound. The tests pass, and the build is ready to ship.";

const save = (state: ReadAloudState, change: Partial<ReadAloudSettings>) =>
  void api.saveReadAloudSettings({ ...state.settings, ...change });

/** The engine Settings shows as picked: the saved one, else the one that reads now, else the first. */
export function pickedEngine(state: ReadAloudState) {
  return (
    state.engines.find((e) => e.id === state.settings.engine) ??
    readAloudChoice(state)?.engine ??
    state.engines[0]
  );
}

export function ReadAloudEngineSetting({ state }: { state: ReadAloudState }) {
  const picked = pickedEngine(state);
  return (
    <SettingsSelect
      label="Voice engine"
      value={picked?.id ?? ""}
      options={state.engines.map((e) => ({
        value: e.id,
        label: e.name,
        description:
          e.model.status === "ready"
            ? undefined
            : `Not downloaded · ${megabytes(e.size)}`,
      }))}
      onChange={(engine) => save(state, { engine })}
    />
  );
}

export function ReadAloudVoiceSetting({ state }: { state: ReadAloudState }) {
  const engine = pickedEngine(state);
  const reading = useReading();
  if (!engine) return null;
  const voice =
    engine.voices.find((v) => v.id === state.settings.voices[engine.id]) ??
    engine.voices[0];
  const ready = engine.model.status === "ready";
  const playing = reading?.key === sampleKey && reading.status !== "failed";
  return (
    <div className="read-aloud-voice">
      {reading?.key === sampleKey && reading.status === "failed" && (
        <span className="read-aloud-error" role="status">
          {reading.error}
        </span>
      )}
      <SettingsSelect
        label="Voice"
        value={voice?.id ?? ""}
        options={engine.voices.map((v) => ({
          value: v.id,
          label: v.name,
          description: v.language,
        }))}
        onChange={(id) =>
          save(state, { voices: { ...state.settings.voices, [engine.id]: id } })
        }
      />
      <button
        type="button"
        disabled={!ready}
        title={ready ? undefined : `Download ${engine.name} to try its voices`}
        onClick={() =>
          playing ? stopReading() : startReading(sampleKey, sample)
        }
      >
        {playing ? <Square size={12} /> : <Play size={14} />}
        {playing ? "Stop" : "Try it"}
      </button>
    </div>
  );
}

export function ReadAloudSpeedSetting({ state }: { state: ReadAloudState }) {
  return (
    <SettingsSelect
      label="Speed"
      value={String(state.settings.speed)}
      options={readAloudSpeeds.map((s) => ({
        value: String(s),
        label: s === 1 ? "Normal" : `${s}×`,
      }))}
      onChange={(speed) => save(state, { speed: Number(speed) })}
    />
  );
}

/** An engine's download: its size or progress, and the button for what comes next. */
export function ReadAloudDownload({ engine }: { engine: ReadAloudEngineInfo }) {
  const model = engine.model;
  if (model.status === "downloading")
    return (
      <div className="read-aloud-download">
        <small role="status">
          {megabytes(model.received)} of {megabytes(model.total)}
        </small>
        <button onClick={() => void api.cancelReadAloudDownload(engine.id)}>
          <Pause size={14} />
          Pause
        </button>
      </div>
    );
  if (model.status === "ready")
    return (
      <div className="read-aloud-download">
        <small>{megabytes(engine.size)}</small>
        <button onClick={() => void api.removeReadAloudEngine(engine.id)}>
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    );
  const partial = !!model.received;
  return (
    <div className="read-aloud-download">
      {model.status === "failed" ? (
        <small className="failed" role="alert">
          {model.error}
        </small>
      ) : (
        <small>
          {partial
            ? `${megabytes(model.received!)} of ${megabytes(engine.size)}`
            : megabytes(engine.size)}
        </small>
      )}
      <button
        className="primary"
        onClick={() => void api.downloadReadAloudEngine(engine.id)}
      >
        <Download size={14} />
        {partial ? "Resume" : "Download"}
      </button>
    </div>
  );
}
