import type { ProjectChat } from "../../shared/projects";
import type { ProjectChats } from "../project-chats";
import { toolText } from "../relay-mcp";
import { leadSide } from "./lead-side";

const DRIVE_ALWAYS =
  "Always lets this thread start, message, stop and settle any thread in any project without asking again. Reading needs no permission.";

/** Asking the user, in the lead's own turn, before a tool acts for it. */
export class Approvals {
  constructor(
    private chats: Pick<ProjectChats, "askInTurn" | "allowDriving">,
  ) {}

  /**
   * Whether the user lets the lead start or message a thread of its own: a
   * new turn spends usage and may edit the project. A lead with full access
   * or leave to drive threads may, unless `always`.
   */
  async ask(
    lead: ProjectChat,
    title: string,
    detail: string,
    signal: AbortSignal,
    always = false,
  ) {
    if (!always && (lead.drivesThreads || this.fullAccess(lead))) return true;
    const response = await this.chats.askInTurn(
      lead.id,
      {
        kind: "approval",
        title,
        detail,
        decisions: ["accept", "decline", "cancel"],
      },
      signal,
    );
    return response.kind === "approval" && response.decision === "accept";
  }

  /**
   * Whether the user lets the lead drive a thread beyond its own in its
   * project. Full access doesn't: it was given for the lead's own folder.
   * Always keeps the leave on the lead, so it asks only once.
   */
  async askToDrive(
    lead: ProjectChat,
    title: string,
    detail: string,
    signal: AbortSignal,
  ) {
    if (lead.drivesThreads) return true;
    const response = await this.chats.askInTurn(
      lead.id,
      {
        kind: "approval",
        title,
        detail: [detail, DRIVE_ALWAYS].filter(Boolean).join("\n\n"),
        decisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
      signal,
    );
    if (response.kind !== "approval") return false;
    if (response.decision === "acceptForSession")
      await this.chats.allowDriving(lead.id, true);
    return (
      response.decision === "accept" || response.decision === "acceptForSession"
    );
  }

  /** The lead runs with full access: edits and commands go without asking. */
  fullAccess(lead: ProjectChat) {
    return leadSide(lead).last.runtimeMode === "full-access";
  }
}

/** What a tool answers when the user said no. */
export function refused(what: string) {
  return toolText(
    `The user didn't let you ${what}. Ask them what they want instead.`,
    true,
  );
}
