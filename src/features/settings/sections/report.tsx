import type { SettingEntry } from "../settings-search";
import { ReportProblem } from "../../bug-report/ReportProblem";

export function reportEntries(): SettingEntry[] {
  return [
    {
      id: "report-problem",
      category: "report",
      title: "Report a problem",
      keywords:
        "bug report problem crash issue feedback github log logs screenshot broken help support",
      card: () => <ReportProblem />,
    },
  ];
}
