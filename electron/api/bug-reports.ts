import { z } from "zod";
import { agentProviderSchema } from "../../shared/agents";
import { modelChoiceSchema } from "../../shared/settings";
import { screenshotLimit } from "../bug-report/service";
import { takes, type ApiContext, type Handlers } from "./context";

const text = (max: number) => z.string().max(max);
const fieldsSchema = z
  .object({
    kind: z.enum(["bug", "feature"]),
    title: text(256),
    description: text(20_000),
    writer: z
      .object({ provider: agentProviderSchema, choice: modelChoiceSchema })
      .strict()
      .optional(),
    includeLog: z.boolean(),
    attachPerfLog: z.boolean().optional(),
    removedFacts: z.array(text(40)).max(60),
  })
  .strict();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const pngSchema = z.custom<Uint8Array>(
  (b) =>
    b instanceof Uint8Array &&
    b.byteLength > 0 &&
    b.byteLength <= screenshotLimit,
  "Screenshots can be up to 10 MB on GitHub.",
);

/** Settings → Report a problem. */
export function bugReportHandlers(ctx: ApiContext) {
  const reports = () => {
    if (!ctx.bugReports)
      throw new Error("Reporting a problem needs Relay's window.");
    return ctx.bugReports;
  };
  const tray = () => {
    if (!ctx.dragTray) throw new Error("Dragging files needs Relay's window.");
    return ctx.dragTray;
  };
  return {
    openBugReport: () => reports().open(),
    saveBugReport: takes([fieldsSchema], (fields) => reports().save(fields)),
    writeBugReport: () => reports().writeWithAgent(),
    undoBugReportTidy: () => reports().undoTidy(),
    addBugReportScreenshot: takes(
      [text(120), pngSchema, z.uuid().optional()],
      (name, png, replacing) => reports().addScreenshot(name, png, replacing),
    ),
    removeBugReportScreenshot: takes([z.uuid()], (id) =>
      reports().removeScreenshot(id),
    ),
    bugReportScreenshot: takes([z.uuid()], (id) =>
      reports().screenshotBytes(id),
    ),
    sendBugReport: takes([digestSchema], (digest) => reports().send(digest)),
    saveBugReportFiles: () => reports().saveBundle(),
    openBugReportIssue: () => reports().openIssue(),
    discardBugReport: () => reports().discard(),
    takeBugReportWanted: () => ctx.bugReports?.takeWanted() ?? false,
    recordBugReportPerformance: takes([z.int().min(5).max(120)], (seconds) =>
      reports().record(seconds),
    ),
    stopBugReportRecording: () => reports().stopRecording(),
    removeBugReportRecording: () => reports().removeRecording(),
    offerBugReportFiles: () => reports().offerDrag(),
    dragTrayFiles: () => tray().list(),
    dragTrayFile: takes([z.string().max(8)], (id) => tray().drag(id)),
    closeDragTray: () => tray().close(),
  } satisfies Handlers;
}
