import { fileCount } from "./search-model";
import type { ReplaceReport } from "./useReplaceFlow";

/** What a Replace all did: how much it replaced, and each file it left alone with the reason. */
export function ReplaceReportBox({ report }: { report: ReplaceReport }) {
  if (report.kind === "failed")
    return (
      <div className="ps-report" role="status">
        <div>{report.message}</div>
      </div>
    );
  const { replaced, skipped } = report.result;
  const replacedCount = replaced.reduce((n, r) => n + r.count, 0);
  return (
    <div className="ps-report" role="status">
      <div>
        Replaced {replacedCount} in {fileCount(replaced.length)}.
        {skipped.length > 0 && ` ${fileCount(skipped.length)} left alone:`}
      </div>
      {skipped.map((s) => (
        <div key={s.path}>
          <code>{s.path}</code> {s.reason}
        </div>
      ))}
    </div>
  );
}
