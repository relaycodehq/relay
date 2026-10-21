import { useStoredChoice } from "../../lib/persisted-store";
import type {
  BugReportPreview,
  BugReportScreenshot,
} from "../../../shared/bug-report";
import { RichText } from "../../ui/RichText";
import { Segmented } from "../../ui/SettingsCard";
import { useScreenshot } from "./ReportScreenshots";

const VIEW_KEY = "relay-report-preview";
type View = "rendered" | "markdown";

/**
 * The issue as it would be posted: drawn the way GitHub shows it, or as the
 * Markdown that is actually sent. Both come from the same body.
 */
export function ReportPreview({
  preview,
  updating,
}: {
  preview: BugReportPreview;
  updating: boolean;
}) {
  const [view, setView] = useStoredChoice<View>(
    VIEW_KEY,
    ["rendered", "markdown"],
    "rendered",
  );
  const shots = preview.draft.screenshots;
  // `gh` uploads them and rewrites these references; the API can't, so they
  // follow as a comment the user adds.
  const inBody = preview.via === "gh";
  return (
    <div className="report-preview">
      <div className="report-preview-bar">
        <Segmented<View>
          label="Preview as"
          value={view}
          options={[
            ["rendered", "Preview"],
            ["markdown", "Markdown"],
          ]}
          onChange={setView}
        />
        {updating && <span className="muted">Updating…</span>}
      </div>
      <article
        className="report-payload"
        aria-label="Issue preview"
        data-updating={updating || undefined}
      >
        <h2 className="report-payload-title">{preview.title}</h2>
        {view === "rendered" ? (
          <div className="report-payload-body markdown">
            <RichText
              text={preview.body}
              html
              image={(src, alt) => {
                const n = /^\.\/screenshot-(\d+)\.png$/.exec(src)?.[1];
                const shot = n ? shots[Number(n) - 1] : undefined;
                return shot ? <ShotImage shot={shot} alt={alt} /> : undefined;
              }}
            />
          </div>
        ) : (
          <pre className="report-payload-source">{preview.body}</pre>
        )}
      </article>
      {!inBody && shots.length > 0 && (
        <div className="report-preview-later">
          <p className="muted">
            {shots.length === 1 ? "This screenshot goes" : "These go"} in a
            comment you add after sending: GitHub's API takes text only, so
            Relay opens the issue and the folder with{" "}
            {shots.length === 1 ? "it" : "them"} for you to drag in.
          </p>
          <div className="report-preview-shots">
            {shots.map((shot) => (
              <ShotImage key={shot.id} shot={shot} alt={shot.name} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShotImage({ shot, alt }: { shot: BugReportScreenshot; alt: string }) {
  const url = useScreenshot(shot.id)?.url;
  return url ? (
    <img className="report-preview-shot" src={url} alt={alt} />
  ) : (
    <span className="report-preview-shot report-shot-blank" />
  );
}
