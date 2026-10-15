import { Activity, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BugReportPreview } from "../../../shared/bug-report";
import { api } from "../../lib/api";
import { useNow } from "../../lib/useNow";
import { Spinner } from "../../ui/ui";

/**
 * "Record performance": Relay traces itself for a short while the user does
 * the slow thing, with what the rest of the computer was doing. The zip stays
 * beside the draft; it's only sent if the user drags it into GitHub.
 */
export function ReportRecording({
  preview,
  locked,
  onChange,
  onError,
}: {
  preview: BugReportPreview;
  locked: boolean;
  onChange: (preview: BugReportPreview) => void;
  onError: (error: unknown) => void;
}) {
  const [seconds, setSeconds] = useState(30);
  // Set at the click, before the main process's own state comes back.
  const [started, setStarted] = useState<{ endsAt: number }>();
  const running = preview.recordingNow ?? started;
  const kept = preview.draft.recording;
  // Started before this page opened: its `record` call went with the page
  // that made it, so this one waits for the recording itself.
  const othersRecording = !!preview.recordingNow && !started;
  useEffect(() => {
    if (!othersRecording) return;
    let live = true;
    api.bugReportRecordingDone().then(
      (next) => live && onChange(next),
      (error) => live && onError(error),
    );
    return () => {
      live = false;
    };
  }, [othersRecording]);

  async function record() {
    setStarted({ endsAt: Date.now() + seconds * 1000 });
    try {
      onChange(await api.recordBugReportPerformance(seconds));
    } catch (error) {
      onError(error);
    } finally {
      setStarted(undefined);
    }
  }

  if (running) return <Recording endsAt={running.endsAt} />;
  return (
    <div className="report-recording">
      {kept && (
        <div className="report-recording-kept">
          <Activity size={14} aria-hidden />
          <span>
            Performance recording, {kept.seconds} s,{" "}
            {(kept.bytes / 1e6).toFixed(1)} MB
          </span>
          {!locked && (
            <button
              type="button"
              className="icon-button"
              aria-label="Remove the recording"
              title="Remove"
              onClick={() =>
                api.removeBugReportRecording().then(onChange, onError)
              }
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
      {!locked && (
        <div className="report-shot-adder">
          <button type="button" onClick={() => void record()}>
            <Activity size={14} />
            {kept ? "Record again" : "Record performance"}
          </button>
          <select
            aria-label="How long"
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          >
            <option value={30}>30 s</option>
            <option value={60}>60 s</option>
          </select>
          <span className="muted">
            Start it, then do whatever is slow. Relay records itself and notes
            what else the computer was doing; it stays here until you send it.
          </span>
        </div>
      )}
    </div>
  );
}

function Recording({ endsAt }: { endsAt: number }) {
  const now = useNow(1000);
  // Saving takes a few seconds, which the countdown mustn't hide.
  const [stopped, setStopped] = useState(false);
  const left = stopped ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <div className="report-recording report-shot-adder" role="status">
      <Spinner size={13} steady />
      <span>
        {left > 0
          ? `Recording, ${left} s left. Do the slow thing now; you can leave this page.`
          : "Saving the recording…"}
      </span>
      {left > 0 && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setStopped(true);
            void api.stopBugReportRecording();
          }}
        >
          Stop now
        </button>
      )}
    </div>
  );
}
