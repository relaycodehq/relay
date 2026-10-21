import type {
  AgentActivity,
  AgentProvider,
  ChatMessage,
  ProjectChat,
} from "../../shared/projects";
import { checkedOutOr } from "../git/git";
import { finishTurn, resumeTurn, startTurn } from "../git/turn-changes";
import { keepIgnored, recordIgnored } from "../git/ignored-touches";
import { outsideEdits } from "../git/elsewhere";
import { commitWatch } from "./turn-commit";

/**
 * What the agent itself touched in a turn, so the turn's card leaves out
 * edits made meanwhile by anyone else: the files it changed, ignored ones
 * included, the commands it ran and whether it committed.
 */
export class TurnSnapshot {
  private edited = new Set<string>();
  private commands = new Map<string, string>();
  private before: Awaited<ReturnType<typeof startTurn>> | null = null;
  private ignoredStart: Awaited<ReturnType<typeof keepIgnored>> | null = null;
  private commits: Awaited<ReturnType<typeof commitWatch>> | undefined;
  /**
   * Where the turn's edits are counted: its folder, or the worktree the
   * thread moved to mid-answer, from the moment it moved.
   */
  counted: string;
  committed = false;

  constructor(
    private root: string,
    /** The answer's first message, which a steer may have continued below. */
    private first: string,
    /** A side turn changes nothing, and edits made meanwhile are the main answer's. */
    private records: boolean,
  ) {
    this.counted = root;
  }

  /**
   * Taken right before the agent starts, so the card lists only its edits.
   * `checkout` is where commits are watched, when they are.
   */
  async start(resumes: boolean, checkout?: () => Promise<string>) {
    if (!this.records) return;
    // Ignored files stay out of the snapshot; a resumed turn may have written them already.
    [this.before, this.ignoredStart] = await Promise.all([
      (resumes ? resumeTurn : startTurn)(this.root, this.first),
      resumes
        ? null
        : keepIgnored(this.root).catch((e) => {
            // A folder outside Git has no ignored files to keep, every turn.
            if (!/not a git repository/.test(String(e)))
              console.warn("Could not keep the ignored files:", e);
            return null;
          }),
    ]);
    if (this.before && checkout) {
      const folder = await checkout();
      this.commits = await commitWatch(
        folder === this.root ? [this.root] : [this.root, folder],
      );
    }
  }

  /** The thread moved into a worktree mid-answer: count from there on. */
  async moved(path: string) {
    this.counted = path;
    if (!this.before) return;
    this.before = await startTurn(path, this.first);
    this.ignoredStart = await keepIgnored(path).catch(() => null);
    if (this.commits) this.commits = await commitWatch([path, this.root]);
  }

  activity(activity: AgentActivity) {
    if (activity.kind === "command") {
      this.commands.set(activity.id, activity.label);
      this.commits?.command(activity.label);
    } else if (activity.kind === "file") this.commits?.edited();
  }

  edits(paths: string[]) {
    for (const path of paths) this.edited.add(path);
  }

  /**
   * Puts what the turn changed on the message it ended in, and what the
   * checkout is on now on the thread. Before the status changes: a finished
   * answer means a settled checkout.
   */
  async finish(
    chat: ProjectChat,
    message: ChatMessage,
    provider: AgentProvider,
  ) {
    const edited = [...this.edited];
    if (this.before) {
      const files = await finishTurn(
        this.counted,
        this.first,
        this.before,
        message.id,
        { edited, commands: [...this.commands.values()] },
      );
      if (files.length) message.changes = files;
      await recordIgnored(
        this.counted,
        this.ignoredStart,
        edited,
        provider,
      ).catch((e) =>
        console.warn("Could not list the ignored files edited:", e),
      );
      this.committed = !!(await this.commits?.ended());
      // The agent may have left the checkout on another branch, as landing one in main does.
      ({ branch: chat.branch, commit: chat.commit } = await checkedOutOr(
        this.counted,
        chat,
      ));
    }
    // Also where nothing is snapshotted, such as a Scratchpad thread
    // working in a clone elsewhere.
    if (this.records && edited.length) {
      const elsewhere = await outsideEdits(this.counted, edited).catch((e) => {
        console.warn("Could not list the files edited elsewhere:", e);
        return [];
      });
      if (elsewhere.length) message.elsewhere = elsewhere;
    }
  }
}
