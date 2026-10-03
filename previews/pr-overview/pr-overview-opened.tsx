// A sketch of where opening a PR lands: its project thread with the Review
// pane, as the app already does for PR threads. Not one of the options.
import {
  FileCode2,
  FolderPlus,
  GitPullRequest,
  MessageSquare,
} from "lucide-react";
import { repoOf, threadFor, type SamplePr } from "./pr-overview-data";
import { RepoLabel, Stat } from "./pr-overview-parts";

const sampleLines = [
  [" ", "export class InvoiceExportService {"],
  [" ", "  constructor(private http: HttpClient) {}"],
  ["-", "  export(filter: InvoiceFilter) {"],
  ["-", "    return this.http.get(`/api/invoices/export`, { params: filter });"],
  ["+", "  export(filter: InvoiceFilter): Observable<ExportJob> {"],
  ["+", "    return this.http.post<ExportJob>(`/api/invoices/export-jobs`, filter);"],
  ["+", "  }"],
  ["+", ""],
  ["+", "  status(job: ExportJob) {"],
  ["+", "    return this.http.get<ExportJob>(`/api/invoices/export-jobs/${job.id}`);"],
  [" ", "  }"],
  [" ", "}"],
];

export function OpenedPr({ pr }: { pr: SamplePr }) {
  const local = repoOf(pr.repo).project;
  const thread = threadFor(pr);
  const files = pr.dirs.flatMap((d) =>
    Array.from({ length: Math.min(d.files, 4) }, (_, i) => ({
      dir: d.path,
      name: `${d.path.split("/").pop()}-${["service", "component", "model", "spec"][i]}.ts`,
    })),
  );
  return (
    <div className="pv-opened">
      {!local && (
        <div className="pv-opened-note">
          <FolderPlus size={14} />
          <span>
            <strong>{pr.repo}</strong> isn’t on this Mac, so it opens as a
            review without a thread. Link a folder to chat about it with an
            agent.
          </span>
          <button className="pro-quiet-button">Link a folder…</button>
        </div>
      )}
      <div className="pv-opened-panes">
        {local && (
          <section className="pv-pane pv-chat">
            <header>
              <MessageSquare size={14} />
              Chat
            </header>
            <div className="pv-chat-body">
              <div className="pv-chat-scope">
                <GitPullRequest size={14} />
                <span>
                  {thread ? "Back in the thread about" : "New thread about"}{" "}
                  <RepoLabel repo={pr.repo} number={pr.number} quiet />
                </span>
              </div>
              {thread ? (
                <p className="pv-muted">
                  Earlier messages and your review progress are where you left
                  them.
                </p>
              ) : (
                <p className="pv-muted">
                  Ask about the change, or just review. The thread shows up
                  under {local.name} once you view a file or write something.
                </p>
              )}
            </div>
            <div className="pv-composer">Ask about #{pr.number}…</div>
          </section>
        )}
        <section className="pv-pane pv-review">
          <header>
            <GitPullRequest size={14} />
            Review
            <span className="pv-muted">
              {pr.progress?.viewed ?? 0} of {pr.files} viewed
            </span>
            <span className="spacer" />
            <Stat pr={pr} />
          </header>
          <div className="pv-review-body">
            <ul className="pv-files">
              {files.map((f, i) => (
                <li key={i} className={i === 0 ? "selected" : undefined}>
                  <FileCode2 size={13} />
                  <span>
                    {f.name}
                    <small>{f.dir}</small>
                  </span>
                </li>
              ))}
            </ul>
            <pre className="pv-diff">
              {sampleLines.map(([kind, text], i) => (
                <div key={i} className={`pv-line ${kind === "+" ? "add" : kind === "-" ? "del" : ""}`}>
                  <span>{i + 40}</span>
                  <span>{kind}</span>
                  <code>{text}</code>
                </div>
              ))}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
