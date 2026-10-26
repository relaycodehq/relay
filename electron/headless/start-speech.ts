import type { Store } from "../app/store";
import { Dictation } from "../dictation/service";
import { ReadAloud } from "../read-aloud";
import { setOnnxRuntimeDir } from "../util/onnxruntime";
import { HeadlessSpeech, SpeechRuntime } from "./speech";

/** Speech for phones, its engines downloaded into the home folder when set up. */
export async function startSpeech(
  home: string,
  /** The folder the bundle runs from. */
  lib: string,
  store: Store,
  fetcher: typeof fetch,
) {
  const runtime = new SpeechRuntime(home, lib, fetcher);
  setOnnxRuntimeDir(runtime.ortDir);
  await runtime.prepare();
  const dictation = new Dictation(home, () => {});
  const readAloud = new ReadAloud(
    home,
    {
      get: () => store.get().readAloud,
      save: (settings) =>
        store.update((s) => {
          s.readAloud = settings;
        }),
    },
    () => {},
  );
  const speech = new HeadlessSpeech(runtime, dictation, readAloud);
  void speech.catchUp();
  return { speech, dictation, readAloud };
}
