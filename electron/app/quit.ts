import { app, dialog } from "electron";
import type { AppWindow } from "./window";

interface QuitSteps {
  window: AppWindow;
  /** False until startup has loaded the store; quitting then has nothing to save. */
  started(): boolean;
  /** Claude's background work that quitting would end. */
  runningTasks(): { description: string }[];
  /** Stops auxiliary work once the quit has been committed. */
  stopping(): void;
  /** Saves before services or hosts are torn down; a rejection keeps Relay open. */
  prepare(): Promise<unknown>;
  /** Resumes prepared services when the user keeps Relay open. */
  cancelled(): void;
  /** Stops services once saving succeeded, or the user chose to discard. */
  shutDown(): Promise<unknown>;
  /** The last step, once nothing is left to save. */
  release(): void;
}

/**
 * Quitting asks about running background work, lets the window's unsaved
 * edits veto it, then saves before Relay exits.
 */
export class Quit {
  /** Everything is saved; the next quit goes straight through. */
  ready = false;
  /** The user already agreed to stop background work. */
  confirmed = false;
  /** Relay is restarting, not quitting: the agent host keeps the agents' sessions. */
  detaching = false;
  private flushing = false;
  private asking = false;
  private cancelled?: () => void;

  constructor(private steps: QuitSteps) {}

  /** A restart still lets the window and failed saves cancel the quit. */
  restart(cancelled?: () => void) {
    this.cancelled = cancelled;
    this.detaching = true;
    app.quit();
  }

  cancel() {
    this.detaching = false;
    this.confirmed = false;
    const cancelled = this.cancelled;
    this.cancelled = undefined;
    this.steps.cancelled();
    cancelled?.();
  }

  listen() {
    app.on("window-all-closed", () => {
      // Relay stays in the menubar with its agents; Quit is there.
      if (process.platform === "darwin") app.dock?.hide();
    });
    app.on("before-quit", (event) => this.beforeQuit(event));
  }

  /** Call once ready, or Electron's own handling of the signals wins. */
  detachOnSignals() {
    // A signal means a restart (a rebuild, a script), not the user quitting:
    // the agents' sessions carry on in the agent host and come back after it.
    // Electron turns these signals into a plain quit of its own; a handler
    // added once it's ready runs instead of it.
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.on(signal, () => this.restart());
  }

  private beforeQuit(event: Electron.Event) {
    const steps = this.steps;
    if (this.ready || !steps.started()) {
      steps.release();
      return;
    }
    event.preventDefault();
    // Quitting ends Claude's sessions, and the background work they run.
    const tasks = this.confirmed || this.detaching ? [] : steps.runningTasks();
    if (tasks.length) {
      if (this.asking) return;
      this.asking = true;
      void dialog
        .showMessageBox({
          type: "warning",
          message:
            tasks.length === 1
              ? "Claude is still running something in the background."
              : `Claude is still running ${tasks.length} things in the background.`,
          detail: [
            ...tasks.slice(0, 5).map((t) => `• ${t.description}`),
            "",
            "Quitting stops it. Relay will offer to pick it back up next time.",
          ].join("\n"),
          buttons: ["Quit Anyway", "Keep Running"],
          defaultId: 1,
          cancelId: 1,
        })
        .then(({ response }) => {
          this.asking = false;
          if (response === 0) {
            this.confirmed = true;
            return app.quit();
          }
          this.cancel();
        });
      return;
    }
    // Its unsaved-edits prompt can still cancel the quit, so the window closes
    // before anything shuts down; closing it asks to quit again.
    if (steps.window.closeToQuit()) return;
    if (this.flushing) return;
    this.flushing = true;
    void steps.prepare().then(
      () => this.finish(),
      async () => {
        const choice = await dialog.showMessageBox({
          type: "error",
          title: "Review data could not be saved",
          message: "Some local review changes have not been saved.",
          detail:
            "Keep the app open and retry saving, or quit and lose those unsaved changes.",
          buttons: ["Keep open", "Quit without saving"],
          defaultId: 0,
          cancelId: 0,
        });
        this.flushing = false;
        if (choice.response === 1) {
          await this.finish();
        } else {
          this.cancel();
          steps.window.open();
        }
      },
    );
  }

  private async finish() {
    this.flushing = true;
    this.steps.stopping();
    // Preparation is the only cancellable phase. Once teardown starts,
    // reporting Keep open would leave a partially disposed app behind.
    await this.steps
      .shutDown()
      .catch((error) =>
        console.warn("Could not finish shutting down Relay:", error),
      );
    this.ready = true;
    app.quit();
  }
}
