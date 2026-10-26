// Dictation and read aloud in `relay settings`: what each shows, setting one
// up while it downloads, and the read aloud menu.
import { dictationModelSize } from "../../../shared/dictation";
import { readAloudSpeeds } from "../../../shared/read-aloud";
import { callControl } from "../control";
import { dim, green, ok, yellow } from "../format";
import type { SpeechEngine, SpeechState } from "../speech";
import { sleep } from "../../util/sleep";
import type { Ask } from "./ask";
import { call, control, type SettingsContext, type Snapshot } from "./snapshot";

export const megabytes = (bytes: number) =>
  `${Math.round(bytes / 1_000_000).toLocaleString("en")} MB`;

export function dictationValue({ dictation }: SpeechState) {
  if (!dictation.supported) return dim("not available on this computer");
  if (!dictation.engine)
    return dim(`not set up (${megabytes(dictationModelSize)} model)`);
  const model = dictation.model;
  if (model.status === "ready") return green("ready");
  if (model.status === "downloading")
    return `downloading, ${Math.round((model.received / model.total) * 100)}%`;
  if (model.status === "failed") return yellow(`failed: ${model.error}`);
  return dim("model not downloaded");
}

export function voiceValue({ voice }: SpeechState) {
  if (!voice.supported) return dim("not available on this computer");
  const ready = voice.state.engines.filter((e) => e.model.status === "ready");
  if (!voice.engine || !ready.length) return dim("not set up");
  const engine =
    ready.find((e) => e.id === voice.state.settings.engine) ?? ready[0]!;
  const picked = voice.state.settings.voices[engine.id];
  const name = (engine.voices.find((v) => v.id === picked) ?? engine.voices[0])
    ?.name;
  return `${engine.name}${name ? `, ${name}` : ""}, ${voice.state.settings.speed}×`;
}

/** Follows a speech setup to its end: a line that redraws on a terminal, a line per tenth in a log. */
async function follow(ctx: SettingsContext, engine: SpeechEngine) {
  const leave = () => {
    console.log(
      "\nIt carries on in the background; relay settings shows how far it got.",
    );
    process.exit(130);
  };
  process.once("SIGINT", leave);
  try {
    let logged = "";
    for (;;) {
      const state = await callControl(control(ctx), "speech");
      const setup = state.setup;
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
      if (!setup || setup.engine !== engine) return;
      if (setup.status === "failed")
        throw new Error(setup.error ?? "Setting it up failed.");
      if (setup.status === "done") return console.log(ok("Ready."));
      const what =
        setup.step === "engine"
          ? `the ${engine === "dictation" ? "speech" : "voice"} engine`
          : engine === "dictation"
            ? "the model"
            : "the voice";
      const model =
        engine === "dictation"
          ? state.dictation.model
          : state.voice.state.engines.find(
              (e) => e.model.status === "downloading",
            )?.model;
      const progress =
        setup.step === "engine"
          ? state.download
          : model?.status === "downloading"
            ? model
            : undefined;
      const line = `Downloading ${what}…${progress ? ` ${megabytes(progress.received)}${progress.total ? ` of ${megabytes(progress.total)}` : ""}` : ""}`;
      if (process.stdout.isTTY) process.stdout.write(line);
      else {
        const tenth = progress?.total
          ? Math.floor((progress.received / progress.total) * 10)
          : "";
        if (`${what} ${tenth}` !== logged) console.log(line);
        logged = `${what} ${tenth}`;
      }
      await sleep(process.stdout.isTTY ? 400 : 2000);
    }
  } finally {
    process.off("SIGINT", leave);
  }
}

export async function setUpDictation(ctx: SettingsContext) {
  await callControl(control(ctx), "installSpeech", "dictation");
  await follow(ctx, "dictation");
  console.log("Phones dictate with this computer's speech engine now.");
}

export async function setUpVoice(ctx: SettingsContext, engine?: string) {
  await callControl(control(ctx), "installSpeech", "voice", engine);
  await follow(ctx, "voice");
  console.log(
    "Phones can have answers read aloud in this computer's voice now.",
  );
}

export async function changeVoice(ctx: SettingsContext, ask: Ask, s: Snapshot) {
  const { voice } = s.speech;
  if (!voice.supported)
    throw new Error("Read aloud isn't available on this computer.");
  const engines = voice.state.engines;
  const ready = voice.engine
    ? engines.filter((e) => e.model.status === "ready")
    : [];
  if (!ready.length) {
    const engine = await ask.pick(
      "Download which voice?",
      engines.map((e) => ({
        value: e.id,
        label: `${e.name} ${dim(`${megabytes(e.size)}, ${e.credit}`)}`,
      })),
    );
    if (engine) await setUpVoice(ctx, engine);
    return;
  }
  const action = await ask.pick("Read aloud", [
    { value: "voice", label: "Choose the voice" },
    { value: "speed", label: "Choose the speed" },
    { value: "add", label: "Download another engine" },
    { value: "remove", label: "Remove read aloud" },
  ]);
  const settings = voice.state.settings;
  if (action === "voice") {
    const choice = await ask.pick(
      "Voice",
      ready.flatMap((e) =>
        e.voices.map((v) => ({
          value: [e.id, v.id] as const,
          label: `${v.name} ${dim(`${v.language}, ${e.name}`)}`,
        })),
      ),
    );
    if (choice)
      await call(ctx, "saveReadAloudSettings", {
        ...settings,
        engine: choice[0],
        voices: { ...settings.voices, [choice[0]]: choice[1] },
      });
  } else if (action === "speed") {
    const speed = await ask.pick(
      "Speed",
      readAloudSpeeds.map((x) => ({ value: x, label: `${x}×` })),
    );
    if (speed) await call(ctx, "saveReadAloudSettings", { ...settings, speed });
  } else if (action === "add") {
    const engine = await ask.pick(
      "Download which voice?",
      engines
        .filter((e) => e.model.status !== "ready")
        .map((e) => ({
          value: e.id,
          label: `${e.name} ${dim(megabytes(e.size))}`,
        })),
    );
    if (engine) await setUpVoice(ctx, engine);
  } else if (
    action === "remove" &&
    (await ask.yes("Remove every voice and the engine?", false))
  ) {
    await callControl(control(ctx), "removeSpeech", "voice");
    console.log(ok("Removed."));
  }
}
