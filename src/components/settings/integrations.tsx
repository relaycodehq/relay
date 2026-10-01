import type { SettingEntry } from "../../lib/settings-search";
import { GitSettings } from "../GitSettings";
import {
  SourceControlRescan,
  SourceControlSettings,
} from "../SourceControlSettings";

export function integrationEntries(onConnect?: () => void): SettingEntry[] {
  return [
    {
      id: "git",
      category: "integrations",
      title: "Git",
      description:
        "Relay finds it by itself, the one your terminal runs first. Link another here.",
      keywords: "git executable path program install branch folder exe",
      block: true,
      render: () => <GitSettings />,
    },
    {
      id: "source-control",
      category: "integrations",
      title: "Source control",
      description:
        "CI and pull requests from GitHub and Gitea. Relay uses the CLIs and accounts on this computer.",
      keywords:
        "github gitea forgejo gh tea cli ci actions pull request host sign in login link path token",
      block: true,
      accessory: () => <SourceControlRescan />,
      render: () => <SourceControlSettings onConnect={onConnect} />,
    },
  ];
}
