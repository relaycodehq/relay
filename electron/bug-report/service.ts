import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  BugReportDraft,
  BugReportFact,
  BugReportFields,
  BugReportOccasion,
  BugReportPreview,
  BugReportRecording,
  BugReportSent,
  BugReportSubmission,
  BugReportWriter,
} from "../../shared/bug-report";
import { anonymizer, type Identity } from "./anonymize";
import { crashedRunLog } from "./crash-log";
import { cleanPng } from "./png";
import {
  attachments,
  buildReport,
  digestOf,
  occasionText,
  perfLogName,
  recordingName,
  reportMarker,
  screenshotFile,
  systemFacts,
  type SystemInfo,
} from "./report";
import {
  ghCanAttach,
  ghCreateIssue,
  surelyNotPosted,
  type Exec,
  type IssueHost,
} from "./submit";

/** GitHub takes images up to 10 MB. */
export const screenshotLimit = 10_000_000;
const maxScreenshots = 10;
/** A link to GitHub's form past this gets refused; see the measurement in git history of issue.ts. */
const urlBudget = 4500;

export interface BugReportDeps {
  /** Where the draft and its screenshots live. */
  dir: string;
  logs: string;
  repo: string;
  system(): Promise<SystemInfo>;
  identity(): Identity;
  /** GitHub as the `gh` login; throws when there is none. */
  host(): Promise<IssueHost>;
  /** The `gh` program, or null without one. */
  gh(): Promise<string | null>;
  exec: Exec;
  /** Has an agent tidy up the user's description, and title it. */
  writeUp(
    writer: BugReportWriter,
    text: string,
    kind: BugReportDraft["kind"],
    seen: string,
  ): Promise<Pick<BugReportDraft, "title" | "description">>;
  /** The agent that writes reports up until the user picks one. */
  defaultWriter(): BugReportWriter;
  /** Relay's performance log and recordings; left out where there are none. */
  performance?: PerformanceSource;
  now?: () => number;
}

export interface PerformanceSource {
  /** The performance log summed up, and the machine now. */
  facts(): Promise<BugReportFact[]>;
  /** The whole performance log, for a file. */
  logText(): Promise<string>;
  /** Records into `dir`'s `performance.zip`. */
  record(
    dir: string,
    anonymize: (text: string) => string,
    options: { seconds: number; others: boolean },
    signal: AbortSignal,
  ): Promise<BugReportRecording>;
}

/** Things only a desktop Relay can do with a finished report. */
export interface DesktopActions {
  openExternal(url: string): Promise<void>;
  reveal(path: string): void;
  /** Floats the files over everything, to drag into GitHub's page. */
  offerDrag(files: string[]): void;
  copy(text: string): void;
  /** Where saved reports go. */
  downloads: string;
}

const pasteHere =
  "Relay copied the report to your clipboard because it's too long for a link. Paste it here, in place of this line.";

class ChangedSinceShown extends Error {
  constructor() {
    super(
      "The report changed since it was shown. Look it over again, then send.",
    );
  }
}

/**
 * The problem report the user is writing: kept on disk as they type, with
 * its screenshots beside it, until it's sent and they start another. Nothing
 * leaves this computer except through `send` or `openInBrowser`, and both
 * post only what the last preview showed.
 */
export class BugReports {
  private draft?: Promise<BugReportDraft>;
  private queue: Promise<unknown> = Promise.resolve();
  private gathered?: Promise<{ facts: BugReportFact[]; log: string }>;
  private via?: Promise<{ via: "gh" | "api"; gh: string | null }>;
  private signedIn?: Promise<
    Pick<BugReportPreview, "account" | "accountError"> & {
      visibility: BugReportPreview["destination"]["visibility"];
    }
  >;
  /** A prompt asked for the report before a window could show it. */
  private wanted = false;
  private recording?: {
    startedAt: number;
    endsAt: number;
    stop: AbortController;
    /** Settles once the recording is saved, or has failed. */
    done: Promise<unknown>;
  };

  constructor(
    private deps: BugReportDeps,
    private desktop?: DesktopActions,
  ) {}

  private get now() {
    return this.deps.now?.() ?? Date.now();
  }
  private get file() {
    return join(this.deps.dir, "draft.json");
  }
  private shot(id: string) {
    return join(this.deps.dir, "screenshots", `${id}.png`);
  }
  private get recordingPath() {
    return join(this.deps.dir, recordingName);
  }

  /** Runs one change at a time, each on the draft as the last left it. */
  private change(fn: (draft: BugReportDraft) => Promise<void> | void) {
    const task = this.queue.then(async () => {
      const draft = structuredClone(await this.load());
      await fn(draft);
      draft.updatedAt = this.now;
      await this.write(draft);
      this.draft = Promise.resolve(draft);
      return draft;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  private load() {
    this.draft ??= this.read();
    return this.draft;
  }

  private async read(): Promise<BugReportDraft> {
    try {
      const saved = JSON.parse(
        await readFile(this.file, "utf8"),
      ) as BugReportDraft;
      if (typeof saved.id !== "string") throw new Error("Not a draft");
      saved.kind = saved.kind === "feature" ? "feature" : "bug";
      saved.description ??= "";
      // A screenshot whose file is gone can't be shown or sent.
      const present = new Set(
        await readdir(join(this.deps.dir, "screenshots")).catch(() => []),
      );
      saved.screenshots = (saved.screenshots ?? []).filter((s) =>
        present.has(`${s.id}.png`),
      );
      if (saved.recording && !(await exists(this.recordingPath)))
        delete saved.recording;
      return saved;
    } catch {
      return this.fresh({ kind: "asked" });
    }
  }

  private fresh(occasion: BugReportOccasion): BugReportDraft {
    return {
      id: randomUUID(),
      kind: "bug",
      title: "",
      description: "",
      occasion,
      includeLog: true,
      removedFacts: [],
      screenshots: [],
      updatedAt: this.now,
    };
  }

  private async write(draft: BugReportDraft) {
    await mkdir(this.deps.dir, { recursive: true, mode: 0o700 });
    const tmp = join(this.deps.dir, `draft-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(draft), { mode: 0o600 });
    await rename(tmp, this.file);
  }

  /** Marks that a prompt wants the report shown once a window can. */
  want() {
    this.wanted = true;
  }
  takeWanted() {
    const wanted = this.wanted;
    this.wanted = false;
    return wanted;
  }

  /**
   * Notes what made Relay offer the report. A crash starts a new report
   * unless one is being written.
   */
  async begin(occasion: BugReportOccasion) {
    if (occasion.kind !== "asked")
      await this.change((draft) => {
        if (draft.submission?.status === "sent" || isEmpty(draft))
          Object.assign(draft, this.fresh(occasion));
        else draft.occasion = occasion;
      });
    this.forget();
  }

  /**
   * An agent's write-up of what the user asked it to report. Starts a new
   * report, so it never overwrites one the user is still writing.
   */
  async prefill(
    fields: Pick<BugReportDraft, "kind" | "title" | "description">,
  ) {
    await this.change((draft) => {
      if (draft.submission?.status !== "sent" && !isEmpty(draft))
        throw new Error(
          "The user is already writing a report on Relay's Report a problem page. Ask them to send or discard it first, or give them your write-up to paste in.",
        );
      Object.assign(draft, this.fresh({ kind: "asked" }), fields);
    });
    this.forget();
  }

  /** The page opened: looks at the system, the log and the `gh` login again. */
  open() {
    this.forget();
    return this.preview();
  }

  private forget() {
    this.gathered = this.via = this.signedIn = undefined;
  }

  save(id: string, fields: BugReportFields) {
    return this.change((draft) => {
      if (draft.id !== id) throw new Error("That report is no longer open.");
      if (locked(draft)) return;
      Object.assign(draft, fields);
    }).then(() => this.preview());
  }

  /**
   * Has the picked agent tidy up the description and title it. Only the
   * description and what Relay saw go to it: no log, facts or screenshots.
   */
  async writeWithAgent() {
    const draft = await this.load();
    const id = draft.id;
    if (locked(draft)) throw new Error("This report was already sent.");
    if (!draft.description.trim())
      throw new Error("Write what happened first, in your own words.");
    const written = await this.deps.writeUp(
      draft.writer ?? this.deps.defaultWriter(),
      draft.description,
      draft.kind,
      occasionText(draft.occasion),
    );
    await this.change((next) => {
      if (next.id !== id) throw new Error("That report is no longer open.");
      if (locked(next)) return;
      next.beforeTidy = { title: next.title, description: next.description };
      Object.assign(next, written);
    });
    return this.preview();
  }

  /** Puts back the title and description the last tidy-up replaced. */
  async undoTidy() {
    await this.change((draft) => {
      if (locked(draft)) throw new Error("This report was already sent.");
      if (!draft.beforeTidy) return;
      Object.assign(draft, draft.beforeTidy);
      delete draft.beforeTidy;
    });
    return this.preview();
  }

  /**
   * Keeps an edited screenshot; the bytes must already be the flattened PNG.
   * With `replacing`, it takes that one's place, as its edited version.
   */
  async addScreenshot(
    draftId: string,
    name: string,
    bytes: Uint8Array,
    replacing?: string,
  ) {
    const png = cleanPng(bytes);
    if (!png) throw new Error("That screenshot isn't a PNG Relay can read.");
    if (png.bytes.length > screenshotLimit)
      throw new Error("Screenshots can be up to 10 MB on GitHub.");
    const id = randomUUID();
    await this.change(async (draft) => {
      if (draft.id !== draftId)
        throw new Error("That report is no longer open.");
      if (locked(draft)) throw new Error("This report was already sent.");
      const at = replacing
        ? draft.screenshots.findIndex((s) => s.id === replacing)
        : draft.screenshots.length;
      if (at < 0)
        throw new Error("That screenshot is no longer in the report.");
      if (!replacing && at >= maxScreenshots)
        throw new Error(`A report holds up to ${maxScreenshots} screenshots.`);
      // The file lands first, so a draft never names one that isn't there.
      await mkdir(join(this.deps.dir, "screenshots"), { recursive: true });
      const tmp = `${this.shot(id)}.tmp`;
      await writeFile(tmp, png.bytes, { mode: 0o600 });
      await rename(tmp, this.shot(id));
      draft.screenshots.splice(at, replacing ? 1 : 0, {
        id,
        name: name.slice(0, 120) || "Screenshot",
        bytes: png.bytes.length,
        width: png.width,
        height: png.height,
      });
    });
    if (replacing) await rm(this.shot(replacing), { force: true });
    return this.preview();
  }

  async removeScreenshot(id: string) {
    await this.change((draft) => {
      if (locked(draft)) throw new Error("This report was already sent.");
      draft.screenshots = draft.screenshots.filter((s) => s.id !== id);
    });
    await rm(this.shot(id), { force: true });
    return this.preview();
  }

  async screenshotBytes(id: string) {
    const draft = await this.load();
    if (!draft.screenshots.some((s) => s.id === id))
      throw new Error("That screenshot is no longer in the report.");
    return new Uint8Array(await readFile(this.shot(id)));
  }

  /**
   * Records Relay's performance while the user reproduces the problem,
   * replacing any earlier recording. Resolves once it's saved.
   */
  async record(seconds: number) {
    const performance = this.deps.performance;
    if (!performance)
      throw new Error("This Relay can't record its performance.");
    if (this.recording) throw new Error("Relay is recording already.");
    const draft = await this.load();
    if (locked(draft)) throw new Error("This report was already sent.");
    const stop = new AbortController();
    const startedAt = this.now;
    const run = async () => {
      try {
        const recording = await performance.record(
          this.deps.dir,
          anonymizer(this.deps.identity()),
          {
            seconds,
            others: !draft.removedFacts.includes("perf-others"),
          },
          stop.signal,
        );
        await this.change((next) => {
          next.recording = recording;
        });
      } catch (error) {
        // Stopped before it began recording: there's nothing to keep.
        if (!(stop.signal.aborted && error === stop.signal.reason)) throw error;
      } finally {
        this.recording = undefined;
      }
    };
    const recording = {
      startedAt,
      endsAt: startedAt + seconds * 1000,
      stop,
      done: Promise.resolve() as Promise<unknown>,
    };
    this.recording = recording;
    recording.done = run();
    await recording.done;
    return this.preview();
  }

  /** The report once the recording under way is saved, or at once without one. */
  async recordingDone() {
    // Its own failure is the caller of `record`'s to show.
    await this.recording?.done.catch(() => {});
    return this.preview();
  }

  /** Ends a recording early; what it caught so far is kept. */
  stopRecording() {
    // A page opened while it saves shows "Saving", not the time left.
    if (this.recording)
      this.recording.endsAt = Math.min(this.recording.endsAt, this.now);
    this.recording?.stop.abort();
  }

  async removeRecording() {
    await this.change((draft) => {
      if (locked(draft)) throw new Error("This report was already sent.");
      delete draft.recording;
    });
    await rm(this.recordingPath, { force: true });
    return this.preview();
  }

  /** Throws the draft away, screenshots and all, and starts a blank one. */
  async discard() {
    const recording = this.recording;
    recording?.stop.abort();
    // Its zip and its draft would land in, or bring back, the folder.
    await recording?.done.catch(() => {});
    // Reserve our place before awaiting filesystem work. A later save must
    // resolve against the replacement draft, not write beside this removal.
    const task = this.queue.then(async () => {
      await rm(this.deps.dir, { recursive: true, force: true });
      this.draft = Promise.resolve(this.fresh({ kind: "asked" }));
      this.forget();
    });
    this.queue = task.catch(() => {});
    await task;
    return this.preview();
  }

  private gather() {
    this.gathered ??= (async () => {
      const draft = await this.load();
      const anonymize = anonymizer(this.deps.identity());
      const [system, performance] = await Promise.all([
        this.deps.system(),
        this.deps.performance?.facts().catch((e: unknown) => {
          console.warn("Could not read the performance log:", e);
          return [];
        }) ?? [],
      ]);
      const facts = [
        ...systemFacts(system, draft.occasion),
        ...performance,
      ].map((f) => ({ ...f, value: anonymize(f.value) }));
      return { facts, log: anonymize(await this.readLog(draft.occasion)) };
    })();
    // A failed look is tried again next time rather than kept.
    this.gathered.catch(() => (this.gathered = undefined));
    return this.gathered;
  }

  private async readLog(occasion: BugReportOccasion) {
    if (occasion.kind === "quit") {
      const kept = crashedRunLog(this.deps.logs, occasion.at);
      if (kept) return kept;
    }
    const read = (name: string) =>
      readFile(join(this.deps.logs, name), "utf8").catch(() => "");
    const [old, current] = await Promise.all([
      read("main.old.log"),
      read("main.log"),
    ]);
    return old + current;
  }

  private route() {
    this.via ??= (async () => {
      const gh = await this.deps.gh().catch(() => null);
      const attach =
        !!gh &&
        (await ghCanAttach(gh, this.deps.exec, this.deps.dir).catch(
          () => false,
        ));
      return { via: attach ? ("gh" as const) : ("api" as const), gh };
    })();
    return this.via;
  }

  async preview(): Promise<BugReportPreview> {
    const draft = await this.load();
    const { facts, log } = await this.gather();
    const { account, accountError, visibility } = await this.github();
    // Without a `gh` login Send opens GitHub's own form. Without screenshots
    // both other routes post the same thing through the API.
    const sendVia = !account
      ? "browser"
      : draft.screenshots.length
        ? (await this.route()).via
        : "api";
    const report = buildReport({ draft, facts, log, via: sendVia });
    return {
      draft,
      title: report.title,
      body: report.body,
      facts,
      log: {
        included: report.included,
        total: report.total,
        size: log.length,
        text: report.logText,
      },
      destination: {
        repo: this.deps.repo,
        url: `https://github.com/${this.deps.repo}/issues`,
        visibility,
      },
      writer: draft.writer ?? this.deps.defaultWriter(),
      account,
      ...(accountError ? { accountError } : {}),
      via: sendVia,
      ...(this.recording
        ? {
            recordingNow: {
              startedAt: this.recording.startedAt,
              endsAt: this.recording.endsAt,
            },
          }
        : {}),
      dragFiles: byHand(draft, sendVia),
      digest: digestOf({
        title: report.title,
        body: report.body,
        via: sendVia,
        screenshots: draft.screenshots.map((s) => s.id),
      }),
    };
  }

  /** Who would post it, and whether the world can read it. */
  private github() {
    this.signedIn ??= this.deps.host().then(
      async (host) => ({
        account: { login: host.login },
        visibility: await host
          .visibility(this.deps.repo)
          .catch(() => "unknown" as const),
      }),
      (error: unknown) => ({
        account: null,
        accountError: message(error),
        visibility: "unknown" as const,
      }),
    );
    return this.signedIn;
  }

  private setSubmission(
    submission: BugReportSubmission | undefined,
    error?: string,
  ) {
    return this.change((draft) => {
      if (submission) draft.submission = submission;
      else delete draft.submission;
      if (error) draft.error = error;
      else delete draft.error;
    });
  }

  /**
   * Posts the issue the preview with `digest` showed. A send that may have
   * landed is looked up before anything is posted again, and the draft stays
   * whatever happens.
   */
  async send(digest: string): Promise<BugReportSent> {
    const shown = await this.preview();
    if (shown.draft.submission?.status === "sent") return { preview: shown };
    if (shown.digest !== digest) throw new ChangedSinceShown();
    if (shown.via === "browser") return this.openInBrowser(shown);
    return { preview: await this.post(shown) };
  }

  private async post(shown: BugReportPreview) {
    const draft = shown.draft;
    const host = await this.deps.host();
    const marker = reportMarker(draft.id);
    const earlier = draft.submission;
    // A pasted browser report carries the marker too.
    if (earlier) {
      let found;
      try {
        found = await host.findIssue(
          this.deps.repo,
          marker,
          earlier.at - 60_000,
        );
      } catch (error) {
        throw new Error(
          `Relay couldn't check whether the last send reached GitHub, so it didn't send again. ${message(error)}`,
        );
      }
      if (found) {
        await this.setSubmission({
          status: "sent",
          at: this.now,
          ...found,
          screenshots: draft.screenshots.length ? "partial" : "none",
        });
        return this.preview();
      }
    }
    const at = this.now;
    // Written before posting: a crash mid-send leaves a send to look for.
    await this.setSubmission({ status: "sending", at });
    try {
      if (shown.via === "gh") {
        const { gh } = await this.route();
        const sending = join(this.deps.dir, "sending");
        await rm(sending, { recursive: true, force: true });
        await mkdir(sending, { recursive: true });
        const files = draft.screenshots.map((_, i) => screenshotFile(i));
        await Promise.all(
          draft.screenshots.map((s, i) =>
            copyFile(this.shot(s.id), join(sending, files[i])),
          ),
        );
        await writeFile(join(sending, "body.md"), shown.body);
        const result = await ghCreateIssue(gh!, this.deps.exec, {
          repo: this.deps.repo,
          title: shown.title,
          bodyFile: join(sending, "body.md"),
          dir: sending,
          files,
        }).finally(() => rm(sending, { recursive: true, force: true }));
        if (result.status === "refused") {
          await this.setSubmission(undefined, result.error);
          throw new Error(result.error);
        }
        if (result.status === "unknown") {
          await this.setSubmission({
            status: "unknown",
            at,
            error: result.error,
          });
          throw new Error(unknownOutcome(result.error));
        }
        await this.setSubmission({
          status: "sent",
          at: this.now,
          ...result.issue,
          screenshots: result.screenshots,
        });
      } else {
        const issue = await host.createIssue(
          this.deps.repo,
          shown.title,
          shown.body,
        );
        await this.setSubmission({
          status: "sent",
          at: this.now,
          ...issue,
          screenshots: draft.screenshots.length ? "browser" : "none",
        });
      }
    } catch (error) {
      const current = (await this.load()).submission;
      if (current?.status === "sending") {
        if (surelyNotPosted(error)) {
          await this.setSubmission(undefined, message(error));
          throw error;
        }
        await this.setSubmission({
          status: "unknown",
          at,
          error: message(error),
        });
        throw new Error(unknownOutcome(message(error)));
      }
      throw error;
    }
    return this.preview();
  }

  /**
   * For someone without `gh`: opens GitHub's own form with the report in it,
   * the way VS Code's reporter does. A report too long for a link goes on the
   * clipboard and the form says to paste it. The screenshots' folder opens
   * beside it, to drag them in.
   */
  private async openInBrowser(shown: BugReportPreview): Promise<BugReportSent> {
    const desktop = this.requireDesktop();
    const base = `https://github.com/${this.deps.repo}/issues/new`;
    const link = (body: string) =>
      `${base}?${new URLSearchParams({ title: shown.title, body })}`;
    const fits = link(shown.body).length <= urlBudget;
    if (!fits) desktop.copy(shown.body);
    await desktop.openExternal(link(fits ? shown.body : pasteHere));
    await this.offerFiles(shown.dragFiles);
    await this.setSubmission({ status: "browser", at: this.now });
    return {
      preview: await this.preview(),
      opened: fits ? "prefilled" : "clipboard",
    };
  }

  /** Floats the files that go in by hand, saved as files first. */
  private async offerFiles(names: string[]) {
    if (!names.length) return;
    const folder = await this.writeBundle();
    this.requireDesktop().offerDrag(names.map((n) => join(folder, n)));
  }

  /** Shows the files that go in by hand again, as Send showed them. */
  async offerDrag() {
    const shown = await this.preview();
    if (!shown.dragFiles.length) throw new Error("Nothing needs dragging in.");
    await this.offerFiles(shown.dragFiles);
  }

  /**
   * Writes the report as files: the text with the whole log in it, the log
   * on its own, and the screenshots. Works offline and without a login.
   */
  async saveBundle() {
    const folder = await this.writeBundle();
    this.requireDesktop().reveal(join(folder, "report.md"));
    return folder;
  }

  private async writeBundle() {
    const desktop = this.requireDesktop();
    const shown = await this.preview();
    const { facts, log } = await this.gather();
    const draft = shown.draft;
    const full = buildReport({ draft, facts, log, via: "gh", unbounded: true });
    const stamp = new Date(this.now)
      .toISOString()
      .slice(0, 16)
      .replace(/[T:]/g, "-");
    const folder = join(desktop.downloads, `Relay problem report ${stamp}`);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "report.md"),
      `# ${full.title}\n\n${full.body}\n`,
    );
    if (draft.includeLog) await writeFile(join(folder, "log.txt"), log);
    await Promise.all([
      ...draft.screenshots.map((s, i) =>
        copyFile(this.shot(s.id), join(folder, screenshotFile(i))),
      ),
      ...(draft.recording
        ? [copyFile(this.recordingPath, join(folder, recordingName))]
        : []),
      ...(draft.attachPerfLog && this.deps.performance
        ? [
            this.deps.performance
              .logText()
              .then((text) => writeFile(join(folder, perfLogName), text)),
          ]
        : []),
    ]);
    return folder;
  }

  async openIssue() {
    const submission = (await this.load()).submission;
    if (submission?.status !== "sent")
      throw new Error("This report wasn't sent yet.");
    await this.requireDesktop().openExternal(submission.url);
    await this.offerFiles((await this.preview()).dragFiles);
  }

  private requireDesktop() {
    if (!this.desktop)
      throw new Error("Reporting a problem needs Relay's window.");
    return this.desktop;
  }
}

/** Sent, or maybe on its way: the text is what was posted. */
const locked = (d: BugReportDraft) =>
  d.submission?.status === "sent" || d.submission?.status === "sending";

/** The files a send leaves for the user to drag into GitHub's page. */
function byHand(draft: BugReportDraft, via: BugReportPreview["via"]) {
  const sent = draft.submission?.status === "sent" ? draft.submission : null;
  const shotsByHand = sent
    ? sent.screenshots === "browser" || sent.screenshots === "partial"
    : via !== "gh";
  return [
    ...(shotsByHand ? draft.screenshots.map((_, i) => screenshotFile(i)) : []),
    ...attachments(draft),
  ];
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const isEmpty = (d: BugReportDraft) =>
  !d.title.trim() &&
  !d.description.trim() &&
  !d.screenshots.length &&
  !d.recording;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const unknownOutcome = (detail: string) =>
  `GitHub didn't confirm the issue (${detail}). It may have been created anyway; sending again checks first, so it won't post twice.`;
