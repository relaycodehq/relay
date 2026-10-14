import type { AgentProvider } from "./agents";
import type { ModelChoice } from "./settings";

/** What made Relay offer the report; the user asking needs no reason. */
export type BugReportOccasion =
  | { kind: "asked" }
  | { kind: "quit"; at: number; dump: boolean }
  | { kind: "window"; reason: string; exitCode: number };

/** A screenshot as stored with the draft: an edited, re-encoded PNG. */
export interface BugReportScreenshot {
  id: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
}

/**
 * Where a send got to. "sending" and "unknown" mean an issue may exist:
 * the next send looks for it before posting again.
 */
export type BugReportSubmission =
  | { status: "sending"; at: number }
  | { status: "unknown"; at: number; error: string }
  | {
      status: "sent";
      at: number;
      url: string;
      number: number;
      /** How the screenshots got there; "browser" ones still need adding by hand. */
      screenshots: "none" | "attached" | "partial" | "browser";
    }
  /** Opened GitHub's own form; whether it was submitted is beyond Relay. */
  | { status: "browser"; at: number };

/** The user's report while it's written; kept on disk until sent or discarded. */
export interface BugReportDraft {
  /** Also written into the issue, so a send that may have landed is found again. */
  id: string;
  kind: BugReportKind;
  title: string;
  /** One box, as VS Code's reporter has: what happened, expected, steps. */
  description: string;
  /** The agent and model that tidy the description up; left out, Relay's helper default. */
  writer?: BugReportWriter;
  /** The title and description as they were before the last tidy-up, for its undo. */
  beforeTidy?: { title: string; description: string };
  occasion: BugReportOccasion;
  includeLog: boolean;
  /** Facts the user took out of the report, by id. */
  removedFacts: string[];
  screenshots: BugReportScreenshot[];
  /** A recording of Relay's performance, zipped beside the draft. */
  recording?: BugReportRecording;
  /** Also attach the whole day of the performance log as a file. */
  attachPerfLog?: boolean;
  submission?: BugReportSubmission;
  /** The last send that failed in a way that surely posted nothing. */
  error?: string;
  updatedAt: number;
}

export type BugReportKind = "bug" | "feature";

export interface BugReportRecording {
  at: number;
  seconds: number;
  bytes: number;
}

export interface BugReportWriter {
  provider: AgentProvider;
  choice: ModelChoice;
}

export type BugReportFields = Pick<
  BugReportDraft,
  "kind" | "title" | "description" | "includeLog" | "removedFacts"
> & { writer?: BugReportWriter; attachPerfLog?: boolean };

export interface BugReportFact {
  id: string;
  /** The "Include …" box it's under. */
  group: "system" | "agents" | "performance";
  label: string;
  value: string;
}

/** Everything the report page shows, built by the main process from the saved draft. */
export interface BugReportPreview {
  draft: BugReportDraft;
  /** Exactly what is posted. */
  title: string;
  body: string;
  facts: BugReportFact[];
  log: {
    /** Lines in the issue, newest last. */
    included: number;
    total: number;
    /** Characters of anonymized log; the saved bundle holds all of it. */
    size: number;
    /** The lines in the issue, anonymized, for its "(show)". */
    text: string;
  };
  destination: {
    repo: string;
    url: string;
    visibility: "public" | "private" | "unknown";
  };
  /** Who tidies the description up: the draft's pick, else Relay's helper default. */
  writer: BugReportWriter;
  /** Who the issue is posted as; null without a `gh` login. */
  account: { login: string } | null;
  accountError?: string;
  /**
   * "gh": a `gh` new enough to upload the screenshots with the issue.
   * "api": GitHub's API, which takes text only; screenshots go in by hand.
   * "browser": no `gh` login, so Send opens GitHub's own form with it.
   */
  via: "gh" | "api" | "browser";
  /** A performance recording under way, while Relay records. */
  recordingNow?: { startedAt: number; endsAt: number };
  /** The files that go in by hand, by dragging them from Relay's tray. */
  dragFiles: string[];
  /** Matches the payload a send would post; a send with another one is refused. */
  digest: string;
}

/** What Send did: posted it, or opened GitHub's form with it. */
export interface BugReportSent {
  preview: BugReportPreview;
  /** Opened GitHub's form: with the report in the link, or on the clipboard. */
  opened?: "prefilled" | "clipboard";
}

/** A file in the tray Relay floats over GitHub's page, to drag in. */
export interface DragTrayFile {
  id: string;
  name: string;
  bytes: number;
  /** A data URL: the screenshot itself, or the system's icon for the file. */
  thumb: string;
}
