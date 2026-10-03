import { useEffect, useState } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { FilePair } from "../../../shared/types";
import DiffWorker from "./diff.worker?worker";

type Request = FilePair & { editable?: boolean };
type Compared = { diff?: FileDiffMetadata; error?: Error };

/** Compares a file pair on a worker that lives only until it answers. */
export function useFileDiff(pair: Request | null | undefined): Compared {
  const [result, setResult] = useState<Compared & { pair: Request }>();
  useEffect(() => {
    if (!pair || pair.binary) return;
    const worker = new DiffWorker();
    const finish = (value: Compared) => {
      clearTimeout(timer);
      worker.terminate();
      setResult({ pair, ...value });
    };
    const timer = setTimeout(
      () => finish({ error: new Error("This file took too long to compare.") }),
      12000,
    );
    worker.onmessage = (e) =>
      finish(
        e.data.error
          ? { error: new Error(e.data.error) }
          : { diff: e.data.value },
      );
    worker.onerror = () =>
      finish({ error: new Error("Could not compare this file.") });
    worker.postMessage(pair);
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [pair]);
  // An answer for an earlier pair must not show while the next one computes.
  return result && result.pair === pair ? result : {};
}
