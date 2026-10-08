import {
  FolderGit2,
  Info,
  Keyboard,
  ListTodo,
  Mic,
  MonitorUp,
  Palette,
  Puzzle,
  Smartphone,
  Sparkles,
  UserRound,
  Volume2,
} from "lucide-react";
import type { SettingsCategory } from "../../../lib/settings-page";

export const categories: {
  id: SettingsCategory;
  label: string;
  description: string;
  icon: typeof Palette;
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, typography, colour mode, accent and app icon.",
    icon: Palette,
  },
  {
    id: "projects",
    label: "Projects",
    description:
      "What one project does its own way. Anything left alone follows the rest of Settings.",
    icon: FolderGit2,
  },
  {
    id: "account",
    label: "Gitea",
    description:
      "Optional: pull requests on a Gitea server. GitHub needs nothing here; Relay uses the gh CLI's login.",
    icon: UserRound,
  },
  {
    id: "models",
    label: "AI models",
    description:
      "The agent new threads start on, and the models for grouping, line questions and commits.",
    icon: Sparkles,
  },
  {
    id: "integrations",
    label: "Integrations",
    description:
      "Git, and the hosts your pull requests, CI and work items come from.",
    icon: ListTodo,
  },
  {
    id: "plugins",
    label: "Plugins",
    description:
      "Extras that ship with Relay and stay out of sight until you turn them on.",
    icon: Puzzle,
  },
  {
    id: "phone",
    label: "Phone",
    description: "Follow and answer your threads from the Relay phone app.",
    icon: Smartphone,
  },
  {
    id: "computers",
    label: "Computers",
    description:
      "Hand a thread to another computer running Relay, like a Mac mini at home, and bring it back later.",
    icon: MonitorUp,
  },
  {
    id: "dictation",
    label: "Dictation",
    description: "Speak your messages; words appear as you talk.",
    icon: Mic,
  },
  {
    id: "read-aloud",
    label: "Read aloud",
    description:
      "Have answers read to you by a voice that runs on this computer.",
    icon: Volume2,
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Everything you can do from the keyboard.",
    icon: Keyboard,
  },
  {
    id: "about",
    label: "About",
    description: "Version and changelog.",
    icon: Info,
  },
];

export const categoryOf = (id: SettingsCategory) =>
  categories.find((c) => c.id === id)!;
