import { useEffect, useState, type ReactNode } from "react";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffWorker from "@pierre/diffs/worker/worker.js?worker";
import { useSyntaxThemes } from "../../lib/appearance";
import { sharedResource } from "./shared-pool";

type SyntaxThemes = ReturnType<typeof useSyntaxThemes>;

let themesForNewPool: SyntaxThemes = {
  light: "pierre-light",
  dark: "pierre-dark",
};

const pool = sharedResource(
  () =>
    new WorkerPoolManager(
      {
        workerFactory: () => new DiffWorker(),
        // Relay shows one file at a time and workers are heavy.
        poolSize: 2,
        // Relay re-renders from its own items, so a big AST cache only costs memory.
        totalASTLRUCacheSize: 1,
      },
      {
        theme: themesForNewPool,
        preferredHighlighter: "shiki-js",
        useTokenTransformer: true,
        tokenizeMaxLineLength: 1000,
      },
    ),
);

type PoolState =
  | { status: "loading" }
  | { status: "ready"; manager: WorkerPoolManager }
  | { status: "failed"; message: string };

function readyState(): PoolState {
  const existing = pool.peek();
  return existing?.isInitialized()
    ? { status: "ready", manager: existing }
    : { status: "loading" };
}

/** Shares one syntax-highlighting worker pool between every mounted diff view. */
export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const themes = useSyntaxThemes();
  const [state, setState] = useState<PoolState>(readyState);

  useEffect(() => {
    themesForNewPool = themes;
    const manager = pool.acquire();
    let live = true;
    // Resolves once the pool is set up; renders queue until workers are warm.
    manager.initialize().then(
      () => {
        if (live) setState({ status: "ready", manager });
      },
      (error: unknown) => {
        if (live)
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      live = false;
      pool.release();
    };
    // Mount once; theme changes go through setRenderOptions below.
  }, []);

  const manager = state.status === "ready" ? state.manager : undefined;
  useEffect(() => {
    themesForNewPool = themes;
    // A failed switch keeps the old colours.
    manager?.setRenderOptions({ theme: themes }).catch(() => {});
  }, [manager, themes]);

  if (state.status === "failed")
    return (
      <div className="empty small">Syntax worker failed: {state.message}</div>
    );
  if (!manager)
    return <div className="empty small">Preparing syntax highlighting…</div>;
  return (
    <WorkerPoolContext.Provider value={manager}>
      {children}
    </WorkerPoolContext.Provider>
  );
}
