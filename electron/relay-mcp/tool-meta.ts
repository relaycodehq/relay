import type { RelayToolName } from "./tools";

/** How Relay treats one of its tools, besides its schema and description. */
interface ToolMeta {
  /** What a call reads as in a turn. */
  label: string;
  /** Also served at STARTED_PATH, to threads another thread started. */
  started?: true;
  /** Left out unless the URL's query turns its group on, or `pages` off. */
  group?: "pages" | "dev" | "import";
  /** Only reads or waits, so a call a restart cut off can run again. */
  replayable?: true;
}

/** Every Relay tool has a row here; the compiler asks for one for a new tool. */
export const relayToolMeta: Record<RelayToolName, ToolMeta> = {
  start_threads: { label: "Started threads" },
  list_threads: { label: "Checked on started threads", replayable: true },
  find_threads: {
    label: "Looked through threads",
    started: true,
    replayable: true,
  },
  read_thread: { label: "Read a thread", started: true, replayable: true },
  send_to_thread: { label: "Messaged a started thread" },
  wait_for_threads: { label: "Waited for started threads", replayable: true },
  stop_thread: { label: "Stopped a started thread" },
  hand_off_thread: { label: "Moved a thread to another computer" },
  settle_thread: { label: "Settled a started thread" },
  settle_this_thread: { label: "Settles this thread when done", started: true },
  wake_this_thread: { label: "Set a wake-up", started: true },
  usage_limits: { label: "Checked usage limits", started: true },
  list_agents: { label: "Listed agents" },
  move_to_worktree: {
    label: "Moved the thread to its own worktree",
    started: true,
  },
  deep_review: { label: "Started a deep review" },
  list_review_setups: { label: "Listed review setups" },
  list_schedules: { label: "Checked the schedules", replayable: true },
  add_schedule: { label: "Set up a schedule" },
  update_schedule: { label: "Changed a schedule" },
  pause_schedule: { label: "Paused or resumed a schedule" },
  remove_schedule: { label: "Removed a schedule" },
  run_schedule: { label: "Test-ran a schedule" },
  list_notes: { label: "Read the notes", started: true },
  add_note: { label: "Added a note", started: true },
  tick_note: { label: "Ticked an item in the notes", started: true },
  list_projects: { label: "Listed projects", started: true, replayable: true },
  open_preview: { label: "Opened the preview", started: true },
  screenshot: { label: "Looked at the preview", started: true },
  console_errors: { label: "Read the preview's console", started: true },
  show_html: { label: "Showed a page", started: true, group: "pages" },
  preview_html: { label: "Looked at a page", started: true, group: "pages" },
  ask_html: { label: "Asked with a page", started: true, group: "pages" },
  import_sources: { label: "Looked at what to import", group: "import" },
  offer_import: { label: "Offered what to import", group: "import" },
  restart_relay: { label: "Restarted Relay", group: "dev" },
  report_relay_problem: {
    label: "Drafted a report about Relay",
    started: true,
  },
  move_to_project: { label: "Moved the thread to another project" },
  add_project: { label: "Added a project" },
};

const names = Object.keys(relayToolMeta) as RelayToolName[];

/** The tools whose row matches. */
export const relayToolsWhere = (match: (meta: ToolMeta) => unknown) =>
  new Set<string>(names.filter((name) => match(relayToolMeta[name])));

/** What a call of `tool` reads as, if it's one of Relay's. */
export const relayToolLabel = (tool: string) =>
  Object.hasOwn(relayToolMeta, tool)
    ? relayToolMeta[tool as RelayToolName].label
    : undefined;
