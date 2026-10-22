import { useEffect, useRef, useState } from "react";
import type {
  BugReportFields,
  BugReportPreview,
} from "../../../shared/bug-report";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { ReportIncluded } from "./ReportIncluded";
import { ReportPreview } from "./ReportPreview";
import { ReportRecording } from "./ReportRecording";
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
  attachPerfLog: !!draft.attachPerfLog,
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
  const [busy, setBusy] = useState<"send" | "files" | "tidy" | "discard">();
  const [previewing, setPreviewing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Edits not yet saved, so the preview may not show them yet.
  const rev = useRef({ typed: 0, saved: 0 });
  const mounted = useRef(false);
  const opening = useRef(0);
  const discarding = useRef(false);
  const reopen = useRef(false);
  const draftId = useRef<string>(undefined);
  const action = useRef<object>(undefined);
  const [dirty, setDirty] = useState(false);
  const latest = useRef(fields);
  latest.current = fields;

  function show(next: BugReportPreview) {
    if (!mounted.current || next.draft.id !== draftId.current) return;
    setPreview(next);
    if (!rev.current.typed || rev.current.typed === rev.current.saved)
      setFields(fieldsOf(next));
  }

  function replace(next: BugReportPreview) {
    if (!mounted.current) return;
    draftId.current = next.draft.id;
    rev.current = { typed: 0, saved: 0 };
    latest.current = fieldsOf(next);
    setDirty(false);
    setPreviewing(false);
    setConfirmDiscard(false);
    setError(undefined);
    setNotice(undefined);
    action.current = undefined;
    setBusy(undefined);
    setPreview(next);
    setFields(latest.current);
  }

  async function open(replacing: boolean) {
    if (discarding.current) {
      reopen.current = true;
      return;
    }
    const request = ++opening.current;
    try {
      const next = await api.openBugReport();
      if (!mounted.current || request !== opening.current) return;
      if (replacing || next.draft.id !== draftId.current) replace(next);
    } catch (error) {
      if (mounted.current && request === opening.current) setError(error);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void open(true);
    return () => {
      mounted.current = false;
      opening.current++;
    };
  }, []);
  // An agent filled in a new report while this page was open.
  useEffect(() => api.onBugReport(() => void open(false)), []);

  function update(change: Partial<BugReportFields>) {
    rev.current.typed++;
    setDirty(true);
    setFields((f) => f && { ...f, ...change });
  }

  async function save() {
    const revision = rev.current;
    const at = revision.typed;
    const id = draftId.current;
    const now = latest.current;
    if (!id || !now || discarding.current || at === revision.saved) return;
    try {
      const next = await api.saveBugReport(id, now);
      if (!mounted.current || rev.current !== revision || next.draft.id !== id)
        return;
      if (at < revision.saved) return;
      revision.saved = at;
      setPreview(next);
      if (at === revision.typed) setDirty(false);
    } catch (e) {
      if (mounted.current && rev.current === revision) setError(e);
    }
  }

  useEffect(() => {
    if (!dirty || discarding.current) return;
    const timer = setTimeout(() => void save(), 350);
    return () => clearTimeout(timer);
  }, [fields, dirty, busy]);
  // Leaving the page keeps the last few keystrokes too.
  useEffect(() => () => void save(), []);

  async function act(kind: typeof busy, work: () => Promise<void>) {
    const id = draftId.current;
    const current = {};
    action.current = current;
    setBusy(kind);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
    } catch (e) {
      if (
        !mounted.current ||
        action.current !== current ||
        id !== draftId.current
      )
        return;
      setError(e);
      // A refused or unconfirmed send changed the draft's state.
      await api.openBugReport().then(show, () => {});
    } finally {
      if (mounted.current && action.current === current) setBusy(undefined);
    }
  }

  async function startOver() {
    setConfirmDiscard(false);
    // Detach in-flight saves before the replacement request begins.
    rev.current = { ...rev.current };
    opening.current++;
    discarding.current = true;
    try {
      replace(await api.discardBugReport());
    } finally {
      discarding.current = false;
      if (reopen.current) {
        reopen.current = false;
        void open(false);
      }
    }
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
  const locked = sent || submission?.status === "sending" || busy === "discard";
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
            {submission.screenshots === "partial" &&
              " Some screenshots may not have uploaded."}
            {preview.dragFiles.length > 0 &&
              ` ${dragNames(preview.dragFiles)} still ${preview.dragFiles.length === 1 ? "needs" : "need"} adding: Open issue floats ${preview.dragFiles.length === 1 ? "it" : "them"} over GitHub, to drag into a comment.`}
          </p>
          <div className="report-actions">
            <button
              type="button"
              className="primary"
              onClick={() => act(undefined, () => api.openBugReportIssue())}
            >
              Open issue
            </button>
            <button type="button" onClick={() => act("discard", startOver)}>
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
          GitHub's form is open in your browser.{" "}
          {preview.dragFiles.length > 0 && (
            <>
              Drag the files from the window Relay floats over it into the
              comment box (
              <button
                type="button"
                className="text-button"
                onClick={() => act(undefined, () => api.offerBugReportFiles())}
              >
                show it again
              </button>
              ).{" "}
            </>
          )}
          Once you've submitted it there, you're done;{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => act("discard", startOver)}
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
              if (!mounted.current || draftId.current !== draft.id) return;
              show(await api.writeBugReport());
            })
          }
          onUndo={
            draft.beforeTidy && !locked
              ? () =>
                  act("tidy", async () => {
                    await save();
                    if (!mounted.current || draftId.current !== draft.id)
                      return;
                    show(await api.undoBugReportTidy());
                  })
              : undefined
          }
        />
      </div>

      <ReportScreenshots
        key={`screenshots:${draft.id}`}
        draftId={draft.id}
        screenshots={draft.screenshots}
        locked={locked}
        onChange={show}
        onError={(error) => {
          if (mounted.current && draftId.current === draft.id) setError(error);
        }}
      />

      <ReportRecording
        key={`recording:${draft.id}`}
        preview={preview}
        locked={locked}
        onChange={show}
        onError={(error) => {
          if (mounted.current && draftId.current === draft.id) setError(error);
        }}
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
                if (mounted.current && draftId.current === draft.id)
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
                onClick={() => act("discard", startOver)}
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
                if (
                  result.opened === "clipboard" &&
                  mounted.current &&
                  draftId.current === draft.id
                )
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

function dragNames(files: string[]) {
  const shots = files.filter((f) => f.startsWith("screenshot-")).length;
  const parts = [
    ...(shots ? [shots === 1 ? "The screenshot" : `${shots} screenshots`] : []),
    ...files.filter((f) => !f.startsWith("screenshot-")),
  ];
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : parts[0];
}
