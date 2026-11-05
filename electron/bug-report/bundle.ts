import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BugReportDraft } from "../../shared/bug-report";
import { perfLogName, recordingName, screenshotFile } from "./report";

/**
 * Writes the report into `folder` as files: the text with the whole log in
 * it, the log on its own, the screenshots, the recording and the
 * performance log.
 */
export async function writeReportBundle(
  folder: string,
  {
    report,
    draft,
    log,
    shot,
    recording,
    perfLog,
  }: {
    report: { title: string; body: string };
    draft: BugReportDraft;
    log: string;
    /** Where a screenshot of the draft is kept. */
    shot: (id: string) => string;
    recording: string;
    /** Absent where Relay keeps no performance log. */
    perfLog?: () => Promise<string>;
  },
) {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "report.md"),
    `# ${report.title}\n\n${report.body}\n`,
  );
  if (draft.includeLog) await writeFile(join(folder, "log.txt"), log);
  await Promise.all([
    ...draft.screenshots.map((s, i) =>
      copyFile(shot(s.id), join(folder, screenshotFile(i))),
    ),
    ...(draft.recording
      ? [copyFile(recording, join(folder, recordingName))]
      : []),
    ...(draft.attachPerfLog && perfLog
      ? [perfLog().then((text) => writeFile(join(folder, perfLogName), text))]
      : []),
  ]);
}
