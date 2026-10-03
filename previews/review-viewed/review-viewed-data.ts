// Sample PR for the review-viewed preview: files, change groups, and what
// starts out viewed.
import type { ChangedFile } from "../../shared/types";

type Status = ChangedFile["status"];
const file = (filename: string, status: Status = "modified") =>
  ({ filename, status, additions: 12, deletions: 4, changes: 16 }) as ChangedFile;

export const files: ChangedFile[] = [
  file("src/app/api-compat.ts"),
  file("src/app/app-routing.module.ts"),
  file("src/app/app.module.ts"),
  file("src/app/guards/host-or-org-admin.guard.ts", "added"),
  file("src/app/guards/site.guard.ts"),
  file("src/app/guards/system-redirect.guard.ts", "added"),
  file("src/app/interfaces/api/license-report.ts"),
  file("src/app/interfaces/api/license.ts"),
  file("src/app/interfaces/api/site.ts"),
  file("src/app/interfaces/history-config.ts"),
  file("src/app/interfaces/navigation.ts"),
  file("src/app/main/main-toolbar/main-toolbar.component.html"),
  file("src/app/main/main-toolbar/main-toolbar.component.scss"),
  file("src/app/main/main-toolbar/main-toolbar.component.ts"),
  file("src/app/main/navigation/navigation.component.html"),
  file("src/app/main/navigation/navigation.component.scss"),
  file("src/app/main/navigation/navigation.component.ts"),
  file("src/app/pages/history/edit-license-dialog/edit-license-dialog.component.ts"),
  file("src/app/pages/history/history.component.html"),
  file("src/app/pages/history/history.component.ts"),
  file("src/app/pages/licenses/license-search.service.ts", "added"),
  file("src/app/pages/licenses/licenses.component.html"),
  file("src/app/pages/licenses/licenses.component.ts"),
  file("src/app/services/license.service.ts"),
  file("src/app/services/system.service.ts", "added"),
  file("src/app/shared/legacy-table.ts", "deleted"),
  file("src/environments/environment.ts"),
];

export interface SampleGroup {
  id: string;
  name: string;
  paths: string[];
}

export const groups: SampleGroup[] = [
  {
    id: "interfaces",
    name: "Rename licenceId to licenseId in API types",
    paths: [
      "src/app/interfaces/api/license-report.ts",
      "src/app/interfaces/api/license.ts",
      "src/app/interfaces/api/site.ts",
    ],
  },
  {
    id: "scss",
    name: "Swap toolbar colours for theme tokens",
    paths: [
      "src/app/main/main-toolbar/main-toolbar.component.scss",
      "src/app/main/navigation/navigation.component.scss",
    ],
  },
];

export const initiallyViewed = [
  "src/app/api-compat.ts",
  "src/app/guards/host-or-org-admin.guard.ts",
  "src/app/guards/system-redirect.guard.ts",
  "src/app/interfaces/history-config.ts",
  "src/app/interfaces/navigation.ts",
  "src/app/interfaces/api/license.ts",
  "src/app/main/main-toolbar/main-toolbar.component.scss",
  "src/app/main/navigation/navigation.component.scss",
];

/** Viewed on an earlier push, then changed again. */
export const changedSinceViewed = new Set(["src/app/services/license.service.ts"]);

export const sampleDiff = [
  " import { Injectable } from '@angular/core';",
  " import { HttpClient } from '@angular/common/http';",
  "-import { LegacyTable } from '../shared/legacy-table';",
  "+import { LicenseSearchService } from '../pages/licenses/license-search.service';",
  " ",
  " @Injectable({ providedIn: 'root' })",
  " export class LicenseService {",
  "-  constructor(private http: HttpClient, private table: LegacyTable) {}",
  "+  constructor(",
  "+    private http: HttpClient,",
  "+    private search: LicenseSearchService,",
  "+  ) {}",
  " ",
  "   list(query: string) {",
  "-    return this.table.filter(query);",
  "+    return this.search.find({ query, scope: 'all' });",
  "   }",
  " }",
];
