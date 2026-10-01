import { describe, expect, it } from "vitest";
import { tenantOf } from "../../electron/plugins/devops/auth";
import type { FoundItem } from "../../electron/plugins/devops/client";
import { compareField, sortItems } from "../../electron/plugins/devops/order";
import { toWorkItem } from "../../electron/plugins/devops/parse";
import { readSettings } from "../../electron/plugins/devops/settings";
import { runningSprints } from "../../electron/plugins/devops/sprints";
import { workItemsQuery } from "../../electron/plugins/devops/wiql";
import {
  currentSprintField,
  defaultDevOpsSettings,
  type DevOpsSettings,
} from "../../shared/devops";

describe("the WIQL", () => {
  it("asks for your open items, most recently changed first", () => {
    expect(workItemsQuery(null, [], true)).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me " +
        "AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved', 'Completed') " +
        "AND [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC",
    );
  });

  it("lets a state filter, in any case, pick closed states too", () => {
    const query = workItemsQuery(
      ["o'brien@example.com"],
      [{ field: "system.state", values: ["Done"] }],
      false,
    );
    expect(query).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] IN ('o''brien@example.com') " +
        "AND [system.state] IN ('Done') ORDER BY [System.ChangedDate] DESC",
    );
  });
});

describe("the order", () => {
  it("puts an item without the field last in both directions", () => {
    expect(compareField(undefined, 1, "asc")).toBe(1);
    expect(compareField(undefined, 1, "desc")).toBe(1);
    expect(compareField("", "a", "desc")).toBe(1);
    expect(compareField(undefined, undefined, "asc")).toBe(0);
  });

  it("compares numbers in text by value, and people by name", () => {
    expect(compareField("10 - Low", "9 - High", "asc")).toBeGreaterThan(0);
    expect(
      compareField({ displayName: "Ann" }, { displayName: "Bob" }, "desc"),
    ).toBeGreaterThan(0);
    expect(compareField(true, false, "desc")).toBeLessThan(0);
  });

  it("breaks ties on the WIQL's order and reads fields in any case", () => {
    const item = (id: number, fields: Record<string, unknown>): FoundItem => ({
      id,
      fields,
    });
    const found = [
      item(1, { "System.IterationId": 7, "custom.effort": 2 }),
      item(2, { "System.IterationId": 8, "Custom.Effort": 2 }),
      item(3, { "System.IterationId": 8, "Custom.Effort": 1 }),
      item(4, { "System.IterationId": 7, "Custom.Effort": 2 }),
    ];
    const sorted = sortItems(
      found,
      [
        { field: currentSprintField, direction: "desc" },
        { field: "Custom.Effort", direction: "asc" },
      ],
      [4, 2, 1, 3],
      new Set([8]),
    );
    expect(sorted.map((w) => w.id)).toEqual([3, 2, 4, 1]);
  });
});

describe("a work item", () => {
  it("falls back to repro steps and reads its assignee either way", () => {
    const item = toWorkItem(
      "https://dev.azure.com/org",
      5,
      {
        "System.TeamProject": "Mobile App",
        "System.AssignedTo": { displayName: "Ann Example" },
        "Microsoft.VSTS.Common.Priority": "2",
        "Microsoft.VSTS.TCM.ReproSteps": "<p>Open it</p><p>Crash</p>",
        "System.IterationId": 3,
      },
      new Set([3]),
    );
    expect(item).toMatchObject({
      title: "",
      tags: [],
      priority: null,
      currentSprint: true,
      assignedTo: "Ann Example",
      description: "Open it\nCrash",
      url: "https://dev.azure.com/org/Mobile%20App/_workitems/edit/5",
    });
    expect(
      toWorkItem("b", 1, { "System.AssignedTo": "ann@x" }, new Set())
        .assignedTo,
    ).toBe("ann@x");
  });
});

describe("the current sprint", () => {
  const now = Date.parse("2026-10-01T15:00:00Z");
  const node = (id: number, start: string, finish: string) => ({
    id,
    attributes: { startDate: start, finishDate: finish },
  });

  it("runs through its finish date and finds nested iterations", () => {
    const running = runningSprints(
      {
        id: 1,
        children: [
          {
            ...node(2, "2026-09-20T00:00:00Z", "2026-10-01T00:00:00Z"),
            children: [node(3, "2026-09-28T00:00:00Z", "2026-10-03T00:00:00Z")],
          },
          node(4, "2026-09-10T00:00:00Z", "2026-09-30T00:00:00Z"),
          node(5, "2026-10-02T00:00:00Z", "2026-10-10T00:00:00Z"),
        ],
      },
      now,
    );
    expect([...running]).toEqual([2, 3]);
    expect(runningSprints(node(6, "2026-10-01T00:00:00Z", ""), now).size).toBe(
      0,
    );
  });
});

describe("saved settings", () => {
  it("fill in what older saves lack", () => {
    const {
      hiddenProjects: _,
      team: __,
      ...older
    } = {
      ...defaultDevOpsSettings,
      organization: "org",
    };
    const read = readSettings(older as DevOpsSettings);
    expect(read.organization).toBe("org");
    expect(read.hiddenProjects).toEqual([]);
    expect(read.team).toEqual({ members: [], filters: [] });
    expect(readSettings(undefined)).toEqual(defaultDevOpsSettings);
  });

  it("keep at most three sort keys when the old sprint switch goes first", () => {
    const fields = ["A", "B", "C"].map((field) => ({
      field,
      direction: "asc" as const,
    }));
    const read = readSettings({
      ...defaultDevOpsSettings,
      sort: { currentSprint: true, fields },
    } as unknown as DevOpsSettings);
    expect(read.sort.fields.map((k) => k.field)).toEqual([
      currentSprintField,
      "A",
      "B",
    ]);
  });
});

it("takes the organization's tenant, but not Microsoft accounts' empty one", () => {
  const guid = "72f988bf-86f1-41af-91ab-2d7cd011db47";
  expect(tenantOf(guid)).toBe(guid);
  expect(tenantOf("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  expect(tenantOf("")).toBeUndefined();
  expect(tenantOf("not-a-tenant")).toBeUndefined();
});
