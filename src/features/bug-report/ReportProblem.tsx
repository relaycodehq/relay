import { useEffect, useRef, useState } from "react";
import type {
  BugReportFields,
  BugReportPreview,
} from "../../../shared/bug-report";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { ReportIncluded } from "./ReportIncluded";
import { ReportPreview } from "./ReportPreview";
import { ReportScreenshots } from "./ReportScreenshots";
import { ReportTidyUp } from "./ReportTidyUp";
import "./bug-report.css";

const fieldsOf = ({ draft }: BugReportPreview): BugReportFields => ({
  kind: draft.kind,
  title: draft.title,
  description: draft.description,
  ...(draft.writer ? { writer: draft.writer } : {}),
  includeLog: draft.includeLog,
  removedFacts: draft.removedFacts,
});

const describe = {
  bug: {
    label: "Steps to reproduce",
    hint: "What you did, what happened, and what you expected instead. GitHub Markdown works.",
    placeholder:
      "1. Open a thread\n2. …\n\nWhat happened: …\nWhat I expected: …",
  },
  feature: {
    label: "Description",
    hint: "The feature you'd like, and what it would help you do. GitHub Markdown works.",
    placeholder: "It would help if …",
  },
};

/**
 * Settings → Report a problem, laid out like VS Code's issue reporter. The
 * draft lives in the main process and is saved as it's typed; Send posts
 * exactly what the preview shows, or without a `gh` login opens GitHub's
 * own form with it.
 */
export function ReportProblem() {
  const [preview, setPreview] = useState<BugReportPreview>();
  const [fields, setFields] = useState<BugReportFields>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<"send" | "files" | "tidy">();
  const [previewing, setPreviewing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Edits not yet saved, so the preview may not show them yet.
  const rev = useRef({ typed: 0, saved: 0 });
  const [dirty, setDirty] = useState(false);
  const latest = useRef(fields);
  latest.current = fields;

  function show(next: BugReportPreview) {
    setPreview(next);
    if (!rev.current.typed || rev.current.typed === rev.current.saved)
      setFields(fieldsOf(next));
  }

  useEffect(() => {
    api.openBugReport().then((p) => {
      setPreview(p);
      setFields(fieldsOf(p));
    }, setError);
  }, []);

  function update(change: Partial<BugReportFields>) {
    rev.current.typed++;
    setDirty(true);
    setFields((f) => f && { ...f, ...change });
  }

  async function save() {
    const at = rev.current.typed;
    const now = latest.current;
    if (!now || at === rev.current.saved) return;
    try {
      const next = await api.saveBugReport(now);
      if (at < rev.current.saved) return;
      rev.current.saved = at;
      setPreview(next);
      if (at === rev.current.typed) setDirty(false);
    } catch (e) {
      setError(e);
    }
  }

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void save(), 350);
    return () => clearTimeout(timer);
  }, [fields, dirty]);
  // Leaving the page keeps the last few keystrokes too.
  useEffect(() => () => void save(), []);

  async function act(kind: typeof busy, work: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
    } catch (e) {
      setError(e);
      // A refused or unconfirmed send changed the draft's state.
      await api.openBugReport().then(show, () => {});
    } finally {
      setBusy(undefined);
    }
  }

  async function startOver() {
    setConfirmDiscard(false);
    const fresh = await api.discardBugReport();
    rev.current = { typed: 0, saved: 0 };
    setDirty(false);
    setPreviewing(false);
    show(fresh);
  }

  if (!preview || !fields)
    return error ? (
      <ErrorBox error={error} />
    ) : (
      <p className="muted">Loading…</p>
    );

  const { draft } = preview;
  const submission = draft.submission;
  const sent = submission?.status === "sent";
  const locked = sent || submission?.status === "sending";
  const shots = draft.screenshots.length;
  const browser = preview.via === "browser";
  const text = describe[fields.kind];
  // A crash suggests its own title; otherwise one is needed, as on GitHub.
  const needsTitle =
    !fields.title.trim() &&
    /^(Problem report|Feature request)$/.test(preview.title);
  const incomplete = needsTitle || !fields.description.trim();

  if (sent)
    return (
      <div className="report-problem">
        <div className="report-banner done" role="status">
          <p>
            <strong>Created issue #{submission.number}.</strong> Thanks!
            {submission.screenshots === "browser" &&
              ` GitHub's API takes text only: open the issue and drag the ${shots === 1 ? "screenshot" : "screenshots"} from the folder Relay shows into a comment.`}
            {submission.screenshots === "partial" &&
              " Some screenshots may not have uploaded; Relay shows the folder with them so you can add any that are missing."}
          </p>
          <div className="report-actions">
            <button
              type="button"
              className="primary"
              onClick={() => act(undefined, () => api.openBugReportIssue())}
            >
              Open issue
            </button>
            <button type="button" onClick={() => act(undefined, startOver)}>
              Report something else
            </button>
          </div>
        </div>
        <ReportPreview preview={preview} updating={false} />
      </div>
    );

  return (
    <div className="report-problem">
      {submission?.status === "unknown" || submission?.status === "sending" ? (
        <p className="report-banner warn" role="status">
          GitHub didn't confirm the last send, so the issue may exist already.
          Sending again checks first and won't post it twice.
        </p>
      ) : submission?.status === "browser" ? (
        <p className="report-banner" role="status">
          GitHub's form is open in your browser. Once you've submitted it there,
          you're done;{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => act(undefined, startOver)}
          >
            start a new report
          </button>
          .
        </p>
      ) : null}

      <p className="report-guidance">
        Before you report, check whether it's{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => void api.openExternal(preview.destination.url)}
        >
          already reported
        </button>
        . Write in any language.
      </p>

      <div className="report-row">
        <label htmlFor="report-kind">This is a</label>
        <select
          id="report-kind"
          value={fields.kind}
          disabled={locked}
          onChange={(e) =>
            update({ kind: e.target.value as BugReportFields["kind"] })
          }
        >
          <option value="bug">Bug report</option>
          <option value="feature">Feature request</option>
        </select>
      </div>

      <label className="report-field">
        <span>
          Title <em aria-hidden>*</em>
        </span>
        <input
          value={fields.title}
          disabled={locked}
          maxLength={256}
          placeholder={
            /^(Problem report|Feature request)$/.test(preview.title)
              ? "Please enter a title."
              : preview.title
          }
          onChange={(e) => update({ title: e.target.value })}
        />
      </label>

      <div className="report-field">
        <label htmlFor="report-description">
          {text.label} <em aria-hidden>*</em>
        </label>
        <small className="muted">{text.hint}</small>
        <textarea
          id="report-description"
          value={fields.description}
          disabled={locked || busy === "tidy"}
          rows={9}
          maxLength={20_000}
          placeholder={text.placeholder}
          onChange={(e) => update({ description: e.target.value })}
        />
        <ReportTidyUp
          writer={fields.writer ?? preview.writer}
          disabled={locked || !fields.description.trim()}
          writing={busy === "tidy"}
          onWriter={(writer) => update({ writer })}
          onTidy={() =>
            act("tidy", async () => {
              await save();
              show(await api.writeBugReport());
            })
          }
          onUndo={
            draft.beforeTidy && !locked
              ? () =>
                  act("tidy", async () => {
                    await save();
                    show(await api.undoBugReportTidy());
                  })
              : undefined
          }
        />
      </div>

      <ReportScreenshots
        screenshots={draft.screenshots}
        locked={locked}
        onChange={show}
        onError={setError}
      />

      <ReportIncluded
        preview={preview}
        fields={fields}
        locked={locked}
        onChange={update}
      />

      {previewing && <ReportPreview preview={preview} updating={dirty} />}
      {notice && (
        <p className="report-banner" role="status">
          {notice}
        </p>
      )}
      {!!error && <ErrorBox error={error} />}

      <footer className="report-footer">
        <p className="muted">
          {browser ? (
            <>
              Opens GitHub in your browser, ready to submit with your GitHub
              account.
            </>
          ) : (
            <>
              Creates a{" "}
              {preview.destination.visibility === "private"
                ? "private"
                : "public"}{" "}
              issue on {preview.destination.repo} as{" "}
              <strong>@{preview.account?.login}</strong>.
            </>
          )}{" "}
          Paths and names on this computer are replaced with placeholders; what
          you write and screenshot goes as it is.
        </p>
        <div className="report-actions">
          <button
            type="button"
            className="text-button"
            aria-expanded={previewing}
            onClick={() => setPreviewing((p) => !p)}
          >
            {previewing ? "Hide preview" : "Preview"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={dirty || !!busy}
            onClick={() =>
              act("files", async () => {
                const folder = await api.saveBugReportFiles();
                setNotice(`Saved to ${folder}, with the whole log.`);
              })
            }
          >
            Save as files
          </button>
          {confirmDiscard ? (
            <span className="report-confirm">
              <span className="muted">Discard it?</span>
              <button
                type="button"
                className="text-button report-danger"
                onClick={() => act(undefined, startOver)}
              >
                Discard
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="text-button"
              disabled={locked || !!busy}
              onClick={() => setConfirmDiscard(true)}
            >
              Discard
            </button>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="primary"
            disabled={locked || dirty || !!busy || incomplete}
            title={
              incomplete ? "Fill in the title and description first" : undefined
            }
            onClick={() =>
              act("send", async () => {
                const result = await api.sendBugReport(preview.digest);
                show(result.preview);
                if (result.opened === "clipboard")
                  setNotice(
                    "The report is too long for a link, so it's on your clipboard: paste it into the form GitHub opened.",
                  );
              })
            }
          >
            {busy === "send"
              ? "Submitting…"
              : browser
                ? "Preview on GitHub"
                : "Create on GitHub"}
          </button>
        </div>
      </footer>
    </div>
  );
}
