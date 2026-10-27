import {
  setActivityBranches,
  useActivityBranches,
} from "../../../lib/activity-branches";
import {
  setSidebarAutoHide,
  useSidebarAutoHide,
} from "../../../lib/sidebar-auto-hide";
import { api } from "../../../lib/api";
import { ErrorBox } from "../../../ui/ui";
import { Switch } from "../../../ui/SettingsCard";
import { useSavedSetting } from "../useSavedSetting";
import type { SettingEntry } from "../settings-search";

/** Appearance's Sidebar section: how the projects sidebar names and shows things. */
export function useSidebarEntries(): SettingEntry[] {
  const smartNames = useSavedSetting(
    {
      queryKey: ["smart-project-names"],
      queryFn: () => api.smartProjectNames(),
      staleTime: Infinity,
    },
    (enabled) => api.saveSmartProjectNames(enabled),
    ["projects"],
  );
  const sidebarAutoHide = useSidebarAutoHide();
  const activityBranches = useActivityBranches();
  return [
    {
      id: "smart-project-names",
      category: "appearance",
      section: "Sidebar",
      title: "Smart project names",
      description:
        "Turn relay-releases into Relay Releases. Off keeps the original folder or repository name. Names you type yourself stay as typed.",
      keywords:
        "projects naming folder repository capitalize separators hyphen underscore original smart",
      render: () => (
        <>
          <Switch
            label="Smart project names"
            checked={smartNames.value ?? true}
            disabled={!smartNames.loaded || smartNames.saving}
            onChange={(enabled) => smartNames.set(enabled)}
          />
          {smartNames.error && <ErrorBox error={smartNames.error} />}
        </>
      ),
    },
    {
      id: "sidebar-auto-hide",
      category: "appearance",
      section: "Sidebar",
      title: "Make room for side panes",
      description:
        "Hide the projects sidebar while Changes, Files or History is open, and bring it back when they close.",
      keywords: "sidebar projects hide collapse changes files history pane",
      render: () => (
        <Switch
          label="Hide the sidebar while side panes are open"
          checked={sidebarAutoHide}
          onChange={setSidebarAutoHide}
        />
      ),
    },
    {
      id: "activity-branches",
      category: "appearance",
      section: "Sidebar",
      title: "Branches in Activity",
      description:
        "The branch or worktree under each thread's title. Off leaves Activity to titles and times; Projects still shows them.",
      keywords:
        "branch worktree git main commit activity cards thread line hide show version control",
      render: () => (
        <Switch
          label="Show branches in Activity"
          checked={activityBranches}
          onChange={setActivityBranches}
        />
      ),
    },
  ];
}
