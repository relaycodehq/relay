import { useEffect, useRef } from "react";
import { jumpCommand } from "../../../shared/thread-windows";
import { api } from "../../lib/api";
import { mac } from "../../lib/mod-key";
import { digitOf } from "../../lib/shortcuts";
import { noteUsed } from "../../lib/used";

/**
 * `jump-thread` in a thread's own window, which has no Activity: brings the
 * main window up on Activity's Nth thread, or this window's flash if that's
 * the thread it holds.
 */
export function useJumpInMainWindow(onError: (e: unknown) => void) {
  const fail = useRef(onError);
  fail.current = onError;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Ctrl keys typed in a terminal belong to its shell.
      if (
        !mac &&
        e.ctrlKey &&
        (e.target as Element | null)?.closest?.(".xterm")
      )
        return;
      const digit = digitOf("jump-thread", e);
      if (!digit || e.repeat) return;
      e.preventDefault();
      noteUsed("shortcut:jump-thread");
      void api
        .runInMainWindow(jumpCommand(digit))
        .catch((err) => fail.current(err));
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
}
