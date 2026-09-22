// Worker lifetime pattern adapted from T3 Code (MIT); see THIRD_PARTY_NOTICES.md.
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useState, type ReactNode } from "react";
import { useSyntaxThemes } from "../lib/appearance";
let shared:
  | {
      pool: WorkerPoolManager;
      users: number;
      timer?: ReturnType<typeof setTimeout>;
    }
  | undefined;
export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const [pool, setPool] = useState<WorkerPoolManager>();
  const [error, setError] = useState("");
  const syntaxThemes = useSyntaxThemes();
  useEffect(() => {
    const entry = (shared ??= {
      pool: new WorkerPoolManager(
        {
          workerFactory: () => new DiffsWorker(),
          poolSize: 2,
          totalASTLRUCacheSize: 1,
        },
        {
          theme: syntaxThemes,
          preferredHighlighter: "shiki-js",
          tokenizeMaxLineLength: 1000,
          useTokenTransformer: true,
        },
      ),
      users: 0,
    });
    clearTimeout(entry.timer);
    entry.users++;
    let alive = true;
    entry.pool
      .initialize()
      .then(() => {
        if (alive) setPool(entry.pool);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      entry.users--;
      if (!entry.users)
        entry.timer = setTimeout(() => {
          entry.pool.terminate();
          if (shared === entry) shared = undefined;
        }, 10000);
    };
  }, []);
  // Workers highlight with the pool's theme; switching themes re-tokenizes.
  useEffect(() => {
    void pool?.setRenderOptions({ theme: syntaxThemes }).catch(() => {});
  }, [pool, syntaxThemes]);
  if (error)
    return <div className="empty small">Syntax worker failed: {error}</div>;
  return pool ? (
    <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>
  ) : (
    <div className="empty small">Preparing syntax highlighting…</div>
  );
}
