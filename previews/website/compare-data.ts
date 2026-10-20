// What the compare page says about each app. Read from each app's public docs,
// pricing and changelog on CHECKED; nobody ran them side by side. Keep every
// cell something its makers could check, and say where they are ahead.

export const CHECKED = "11 October 2026";

export type Rival = {
  id: string;
  name: string;
  href: string;
  /** One fair sentence on what it is. */
  is: string;
  /** Who should pick it over Relay. */
  pickThem: string;
  /** Who should pick Relay over it. */
  pickRelay: string;
};

export const relay = {
  id: "relay",
  name: "Relay",
};

export const rivals: Rival[] = [
  {
    id: "conductor",
    name: "Conductor",
    href: "https://www.conductor.build",
    is: "A polished Mac app for running Claude Code, Codex, Cursor and OpenCode in parallel worktrees, with paid cloud workspaces for teams.",
    pickThem:
      "You work on a Mac in a team and want managed cloud workspaces, shared chats and GitHub stacks, and the Pro plan is fine.",
    pickRelay:
      "You use Windows or Linux, want your phone on your own machines for free, or need agents that keep running after you quit.",
  },
  {
    id: "t3-code",
    name: "T3 Code",
    href: "https://github.com/pingdotgg/t3code",
    is: "A free, MIT-licensed app from ping.gg for the agents you already have. A server on your machine is driven from desktop, web, iOS and Android.",
    pickThem:
      "You want an iPhone app from the store today, agents spread over several SSH machines, or GitLab and Bitbucket.",
    pickRelay:
      "You want no usage analytics, a thread you can move to another computer while it runs, reviews checked by a lead, and voice both ways.",
  },
  {
    id: "superset",
    name: "Superset",
    href: "https://superset.sh",
    is: "A source-available (ELv2) workspace that runs 22 CLI agents in terminals, with a paid Pro tier for remote hosts, automations and iPhone.",
    pickThem:
      "You want the widest list of terminal agents, Slack and Linear automations, or team features like SSO.",
    pickRelay:
      "You want no account, an open-source license, Windows or Android, and a structured view of each step instead of a terminal.",
  },
  {
    id: "jean",
    name: "Jean",
    href: "https://jean.build",
    is: "A free, Apache-2.0 desktop app and headless server from the Coolify team, heavy on GitHub, Linear and Sentry automation.",
    pickThem:
      "You want issues turned into worktrees and plans on their own, CI fixed until it passes, and several servers in one sidebar.",
    pickRelay:
      "You want a native, end-to-end encrypted phone app, threads that move between computers, reviews checked by a lead, and voice.",
  },
  {
    id: "orca",
    name: "Orca",
    href: "https://onorca.dev",
    is: "A free, MIT-licensed, terminal-first workspace from Stably AI for fleets of CLI agents, on your laptop, over SSH or on a server, with a phone app.",
    pickThem:
      "You want any CLI agent in a terminal, three ways to run remotely, an iPhone app from the store, and Jira or GitLab built in.",
    pickRelay:
      "You want each step as a structured trace instead of a terminal, no analytics, threads that move between computers, and voice.",
  },
];

export type Mark = "yes" | "part" | "no" | "unknown";
export type Cell = { mark: Mark; text?: string };
export type Row = { label: string; hint?: string; cells: Record<string, Cell> };

const yes = (text?: string): Cell => ({ mark: "yes", text });
const part = (text: string): Cell => ({ mark: "part", text });
const no = (text?: string): Cell => ({ mark: "no", text });
const unknown = (text = "Not documented"): Cell => ({ mark: "unknown", text });

export const groups: { title: string; rows: Row[] }[] = [
  {
    title: "Cost and trust",
    rows: [
      {
        label: "Free, with nothing behind a paywall",
        cells: {
          relay: yes(),
          "t3-code": yes(),
          conductor: part("Cloud and iOS need Pro, $50/mo"),
          superset: part("Remote, phone and automations need Pro"),
          jean: yes(),
          orca: yes(),
        },
      },
      {
        label: "No account with the app's maker",
        cells: {
          relay: yes(),
          "t3-code": yes("Their hosted tunnel needs one"),
          conductor: unknown("Unclear for local use"),
          superset: no("GitHub or Google sign-in"),
          jean: yes(),
          orca: yes("Their hosted phone relay needs one"),
        },
      },
      {
        label: "Open source",
        cells: {
          relay: yes("MIT"),
          "t3-code": yes("MIT"),
          conductor: no(),
          superset: part("ELv2, source-available"),
          jean: yes("Apache-2.0"),
          orca: yes("MIT"),
        },
      },
      {
        label: "No usage analytics",
        cells: {
          relay: yes(),
          "t3-code": no("On by default, env var opts out"),
          conductor: no("No opt-out documented"),
          superset: no("Tied to your account"),
          jean: yes("None found in the source"),
          orca: no("On by default, can be turned off"),
        },
      },
    ],
  },
  {
    title: "Agents",
    rows: [
      {
        label: "Agents it runs",
        cells: {
          relay: yes(
            "Claude, Codex, OpenCode, Cursor, Amp, Antigravity, ACP registry",
          ),
          "t3-code": yes(
            "Claude, Codex, Cursor, OpenCode, Grok, Pi, ACP registry",
          ),
          conductor: yes("Claude Code, Codex, Cursor, OpenCode"),
          superset: yes("22 CLI agents, in terminals"),
          jean: yes("Claude, Codex, Cursor, OpenCode, Grok, Pi and more"),
          orca: yes("About 40 CLI agents, in terminals"),
        },
      },
      {
        label: "Uses the Claude and ChatGPT plans you pay for",
        cells: {
          relay: yes(),
          "t3-code": yes(),
          conductor: yes(),
          superset: yes(),
          jean: yes(),
          orca: yes(),
        },
      },
      {
        label: "Switch agent mid-conversation",
        cells: {
          relay: yes(),
          "t3-code": yes(),
          conductor: part("New tab with a summary"),
          superset: part("Passes on the terminal output"),
          jean: yes(),
          orca: part("Fresh session with a summary"),
        },
      },
    ],
  },
  {
    title: "Away from your desk",
    rows: [
      {
        label: "Desktop systems",
        cells: {
          relay: yes("macOS, Windows, Linux"),
          "t3-code": yes("macOS, Windows, Linux, web"),
          conductor: part("macOS only"),
          superset: part("macOS; Linux experimental"),
          jean: yes("macOS, Windows, Linux, web"),
          orca: yes("macOS, Windows, Linux, web"),
        },
      },
      {
        label: "Phone app",
        cells: {
          relay: part("Android only"),
          "t3-code": yes("iOS and Android"),
          conductor: part("iOS, Pro, cloud workspaces only"),
          superset: part("iPhone and iPad, Pro"),
          jean: part("Web app in the phone's browser"),
          orca: yes("iOS beta, and Android as an APK"),
        },
      },
      {
        label: "Phone reaches your computer without the maker's servers",
        cells: {
          relay: yes("Tailscale or LAN, end-to-end encrypted"),
          "t3-code": yes("Direct, or their optional tunnel"),
          conductor: no("Through their cloud"),
          superset: no("Through their relay"),
          jean: yes("Your own server, secured by you"),
          orca: yes("LAN, Tailscale, or their relay"),
        },
      },
      {
        label: "Agents on another computer",
        cells: {
          relay: yes("Projects over SSH, WSL or a headless Relay"),
          "t3-code": yes("SSH or a headless server"),
          conductor: part("Their cloud only, Pro"),
          superset: yes("Your hosts, through their relay, Pro"),
          jean: yes("Headless Linux server"),
          orca: yes("SSH, own server, your cloud VMs"),
        },
      },
      {
        label: "Move a running conversation to another computer",
        hint: "With its uncommitted work, and back again",
        cells: {
          relay: yes("Keep chatting from either one"),
          "t3-code": no("Threads stay where they started"),
          conductor: no("Not between your own Macs"),
          superset: unknown(),
          jean: no("A project stays on its one server"),
          orca: no("Sessions stay on the server that owns them"),
        },
      },
      {
        label: "Agents keep running after you quit the app",
        cells: {
          relay: yes(),
          "t3-code": part("As a background service"),
          conductor: no("Local sessions end"),
          superset: yes(),
          jean: yes(),
          orca: yes(),
        },
      },
      {
        label: "Managed cloud sandboxes",
        cells: {
          relay: no("Runs on computers you own"),
          "t3-code": no(),
          conductor: yes("Pro"),
          superset: part("Early access"),
          jean: no(),
          orca: part("Experimental, on your own cloud account"),
        },
      },
    ],
  },
  {
    title: "Reviewing and running the work",
    rows: [
      {
        label: "Review by several agents, checked by a lead",
        hint: "A lead verifies the findings and fixes what holds up",
        cells: {
          relay: yes("Any mix of agents"),
          "t3-code": no(),
          conductor: no("One-model review"),
          superset: unknown(),
          jean: part("Up to 5 side by side, no lead"),
          orca: no("Not built in"),
        },
      },
      {
        label: "Dictation and read-aloud on your own computer",
        cells: {
          relay: yes("Both, with local models"),
          "t3-code": part("Dictation on iPhone"),
          conductor: part("Dictation"),
          superset: part("Dictation on iOS"),
          jean: no(),
          orca: part("Local dictation, no read-aloud"),
        },
      },
      {
        label: "Starts work on its own",
        hint: "From issues, schedules or events",
        cells: {
          relay: no("Scheduled sends only"),
          "t3-code": yes("Schedules and webhooks"),
          conductor: yes("Routines, Pro"),
          superset: yes("Automations, Pro"),
          jean: yes("Picks up issues, fixes CI"),
          orca: yes("Scheduled automations"),
        },
      },
    ],
  },
  {
    title: "Teams and tools",
    rows: [
      {
        label: "Team workspaces",
        hint: "Shared chats, SSO",
        cells: {
          relay: no("Built for one developer"),
          conductor: yes("Shared chats; Teams plan"),
          "t3-code": no(),
          superset: yes("Shared hosts; SSO on Enterprise"),
          jean: no(),
          orca: unknown("Enterprise plan, no details"),
        },
      },
      {
        label: "Pull requests beyond GitHub",
        hint: "GitLab, Bitbucket, Azure DevOps",
        cells: {
          relay: part("GitHub, Gitea and Azure DevOps"),
          conductor: part("GitHub only"),
          "t3-code": yes("GitLab, Bitbucket, Azure DevOps and more"),
          superset: part("GitHub; GitLab only locally"),
          jean: part("GitHub; GitLab for cloning only"),
          orca: yes("GitLab, Bitbucket, Azure DevOps, Gitea"),
        },
      },
      {
        label: "Issue trackers built in",
        hint: "Start work from a Linear or Jira ticket",
        cells: {
          relay: part("Azure DevOps work items, as a plugin"),
          conductor: yes("Linear and GitHub issues"),
          "t3-code": no(),
          superset: yes("Linear tasks"),
          jean: yes("Linear, Sentry, GitHub issues"),
          orca: yes("Linear and Jira"),
        },
      },
    ],
  },
  {
    // A joke, and the one row where Relay fails along with everyone.
    title: "Honestly",
    rows: [
      {
        label: "Worktrees that never get in your way",
        hint: "We looked hard. Nobody, us included",
        cells: {
          relay: no("Not us either"),
          "t3-code": no(),
          conductor: no(),
          superset: no(),
          jean: no(),
          orca: no(),
        },
      },
    ],
  },
];

/** Where others are ahead of Relay, said plainly. */
export const ahead: { title: string; text: string }[] = [
  {
    title: "Cloud sandboxes",
    text: "Claude Code, ChatGPT, Cursor and Conductor run agents on their own machines while your laptop is shut. Relay runs on computers you own; a headless Relay on a spare box does that job.",
  },
  {
    title: "An iPhone app in the App Store",
    text: "T3 Code, Orca, Claude, ChatGPT, Cursor and Conductor have one. Relay has none yet; Android is ready.",
  },
  {
    title: "Work that starts itself",
    text: "Jean turns issues into plans and fixes CI until it passes; T3 Code, Orca, Conductor and Cursor run on schedules and webhooks. Relay starts nothing on its own.",
  },
  {
    title: "Teams",
    text: "Conductor, Superset and Cursor have shared workspaces, SSO and SOC 2. Relay is built for one developer and their own computers.",
  },
];

/** What only Relay puts together. */
export const only: { title: string; text: string }[] = [
  {
    title: "No middleman",
    text: "Free, MIT, no account, no analytics. Your phone and your computers talk over your own Tailscale or network, encrypted end to end.",
  },
  {
    title: "Live handoff",
    text: "Send a running thread and its uncommitted work to another computer, keep chatting from the first one, and bring it back.",
  },
  {
    title: "Deep review",
    text: "Claude, Codex and others review the same changes. A lead checks what they found and fixes only what holds up.",
  },
  {
    title: "Voice on your machine",
    text: "Dictate and hear answers read aloud with models on your own computer, from the desktop or the phone.",
  },
];
