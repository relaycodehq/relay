import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PairedComputer } from "../../../shared/handoff";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/error-message";
import { routeKey, type Target } from "./add-targets";

export type Phase =
  | "reaching"
  | "unreachable"
  | "missing"
  | "broken"
  | "installing"
  | "installFailed"
  | "pairing"
  | "pairFailed"
  | "done";

export interface Checkup {
  target: Target;
  phase: Phase;
  /** How fast it answered. */
  ms?: number;
  /** The Relay there, once known. */
  version?: string;
  /** This checkup put it there. */
  installed?: boolean;
  /** What went wrong at the phase it stopped at. */
  error?: string;
  /** The Relay there predates pairing this way: updating it is the fix. */
  tooOld?: boolean;
  /** Paired, as which computer. */
  paired?: PairedComputer;
}

/**
 * Adding a computer as a checkup: reach it, find Relay there (installing it
 * when it's missing), then pair. Each step stops where it went wrong, with
 * what fixes it; a newer checkup drops what an older one still answers.
 */
export function useCheckup() {
  const qc = useQueryClient();
  const [checkup, setCheckup] = useState<Checkup>();
  const run = useRef(0);

  function begin(target: Target, phase: Phase, keep?: Partial<Checkup>) {
    const id = ++run.current;
    setCheckup({ ...keep, target, phase });
    const live = () => run.current === id;
    const update = (next: Partial<Checkup>) => {
      if (live()) setCheckup((c) => c && { ...c, ...next });
    };
    return { live, update };
  }

  async function pair(
    target: Target,
    update: (next: Partial<Checkup>) => void,
  ) {
    update({ phase: "pairing", error: undefined, tooOld: false });
    try {
      const list =
        target.kind === "link"
          ? await api.pairComputer(target.link)
          : await api.connectComputer(target.route);
      const paired =
        target.kind === "route"
          ? list.find(
              (c) => c.route && routeKey(c.route) === routeKey(target.route),
            )
          : list.at(-1);
      update({ phase: "done", paired });
      void qc.invalidateQueries({ queryKey: ["computers-overview"] });
      void qc.invalidateQueries({ queryKey: ["paired-computers"] });
    } catch (e) {
      const error = errorMessage(e);
      update({
        phase: "pairFailed",
        error,
        tooOld: /too old to connect this way/.test(error),
      });
    }
  }

  async function check(target: Target) {
    if (target.kind === "link") {
      const { update } = begin(target, "pairing");
      return pair(target, update);
    }
    const { live, update } = begin(target, "reaching");
    try {
      const found = await api.checkComputer(target.route);
      if (!live()) return;
      if (found.relay === null)
        return update({ phase: "missing", ms: found.ms });
      if (found.broken)
        return update({ phase: "broken", ms: found.ms, error: found.broken });
      update({ ms: found.ms, version: found.relay });
      await pair(target, update);
    } catch (e) {
      update({ phase: "unreachable", error: errorMessage(e) });
    }
  }

  /** Installs Relay there, or updates it, then pairs. */
  async function install() {
    const c = checkup;
    if (c?.target.kind !== "route") return;
    const { target } = c;
    const { live, update } = begin(target, "installing", {
      ms: c.ms,
      version: c.version,
    });
    try {
      await api.installRelayOver(target.route);
      if (!live()) return;
      const found = await api.checkComputer(target.route);
      update({ installed: true, version: found.relay ?? undefined });
      await pair(target, update);
    } catch (e) {
      update({ phase: "installFailed", error: errorMessage(e) });
    }
  }

  return {
    checkup,
    check,
    install,
    /** From the top, as after fixing what it said. */
    again: () => checkup && void check(checkup.target),
    reset: () => {
      run.current++;
      setCheckup(undefined);
    },
    /** Ends reaching or pairing over ssh or WSL, the command there included. */
    stop: () => {
      if (!stoppable(checkup)) return;
      run.current++;
      setCheckup(undefined);
      if (checkup.target.kind === "route")
        void api.stopComputerCheck(checkup.target.route);
    },
  };
}

/**
 * Reaching or pairing over a route, which Stop can end. An install isn't:
 * cut short, it leaves Relay half there; nor is pairing from a link, which
 * might still pair after the screen let go of it.
 */
export const stoppable = (c: Checkup | undefined): c is Checkup =>
  c?.target.kind === "route" &&
  (c.phase === "reaching" || c.phase === "pairing");

/** Waiting on something, not on the user. */
export const busy = (phase: Phase | undefined) =>
  phase === "reaching" || phase === "installing" || phase === "pairing";
