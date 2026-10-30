// Which of Relay's tools each caller gets, by the path and query of the URL
// it reaches them at.
import { relayToolsWhere } from "./tool-meta";
import { relayToolList } from "./tools";

/** Where a thread started by another reaches the tools: none that drive other threads. */
export const STARTED_PATH = "/mcp/started";
export const startedTools = relayToolsWhere((t) => t.started);
const startedOnly = relayToolsWhere((t) => t.started === "only");

/** Where a thread's side conversation reaches the tools: ones that read, and message_main. */
export const SIDE_PATH = "/mcp/side";
const sideTools = relayToolsWhere((t) => t.side);
const sideOnly = relayToolsWhere((t) => t.side === "only");

/** In a URL's query, `pages=off` leaves out the tools that show the user pages. */
export const PAGES_PARAM = "pages";
const pageTools = relayToolsWhere((t) => t.group === "pages");
export const withoutPages = <T extends { name: string }>(list: T[]) =>
  list.filter((t) => !pageTools.has(t.name));

/** In a URL's query, `dev=on` adds the tools for working on Relay itself; only a Relay run under npm run dev sets it. */
export const DEV_PARAM = "dev";
const devTools = relayToolsWhere((t) => t.group === "dev");
export const withoutDev = <T extends { name: string }>(list: T[]) =>
  list.filter((t) => !devTools.has(t.name));

/** In a URL's query, `import=on` adds the tools for importing another app's history; only threads opened for that set it. */
export const IMPORT_PARAM = "import";
const importTools = relayToolsWhere((t) => t.group === "import");
export const withoutImports = <T extends { name: string }>(list: T[]) =>
  list.filter((t) => !importTools.has(t.name));

/** What tools/list returns to a thread nothing started. */
export const leadToolList = relayToolList.filter(
  (t) => !startedOnly.has(t.name) && !sideOnly.has(t.name),
);

/** What tools/list returns at STARTED_PATH. */
export const startedToolList = relayToolList.filter(
  (t) => startedTools.has(t.name) && !sideOnly.has(t.name),
);

/** What tools/list returns at SIDE_PATH. */
export const sideToolList = relayToolList.filter((t) => sideTools.has(t.name));
