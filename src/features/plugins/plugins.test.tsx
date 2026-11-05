// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClockifyStatus } from "../../../shared/clockify";
import type { DevOpsStatus } from "../../../shared/devops";
import {
  clockifyKey,
  devopsKey,
  useClockifyProjects,
  useDevOpsFields,
  useSetPluginEnabled,
} from "./plugins";

const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  status: vi.fn(),
  devopsStatus: vi.fn(),
  fields: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  api: {
    clockifyProjects: mocks.projects,
    clockifyStatus: mocks.status,
    devopsStatus: mocks.devopsStatus,
    devopsFields: mocks.fields,
    setPluginEnabled: mocks.setEnabled,
  },
}));

const statusIn = (workspaceId: string) =>
  ({
    settings: { host: "global", workspaceId, idleMinutes: 15, projects: {} },
    hasToken: true,
    persistent: true,
    day: null,
    review: null,
  }) as unknown as ClockifyStatus;

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let names: string[] | undefined;

/** Lets the queries answer and the hook render what they said. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

function Names() {
  names = useClockifyProjects().data?.map((p) => p.name);
  return null;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
});

it("lists the projects of the workspace now chosen", async () => {
  let workspace = "a";
  mocks.status.mockImplementation(async () => statusIn(workspace));
  mocks.projects.mockImplementation(async () => [
    { id: `${workspace}1`, name: `Project in ${workspace}` },
  ]);
  client.setQueryData(clockifyKey, statusIn("a"));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Names />
      </QueryClientProvider>,
    ),
  );
  await settle();
  expect(names).toEqual(["Project in a"]);

  // Settings saves another workspace; the status shows it at once.
  workspace = "b";
  await act(async () => client.setQueryData(clockifyKey, statusIn("b")));
  await settle();
  expect(names).toEqual(["Project in b"]);
});

it("lists the fields of the organization now saved", async () => {
  let fields: string[] | undefined;
  const statusAt = (organization: string) =>
    ({ settings: { organization, project: "Web" } }) as DevOpsStatus;
  function Fields() {
    fields = useDevOpsFields(true).data?.map((f) => f.name);
    return null;
  }
  let organization = "contoso";
  mocks.devopsStatus.mockImplementation(async () => statusAt(organization));
  mocks.fields.mockImplementation(async () => [
    { name: `Team of ${organization}` },
  ]);
  client.setQueryData(devopsKey, statusAt("contoso"));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Fields />
      </QueryClientProvider>,
    ),
  );
  await settle();
  expect(fields).toEqual(["Team of contoso"]);

  // Settings saves another organization; the status shows it at once.
  organization = "fabrikam";
  await act(async () => client.setQueryData(devopsKey, statusAt("fabrikam")));
  await settle();
  expect(fields).toEqual(["Team of fabrikam"]);
});

it("puts the switch back and says why when turning a plugin on fails", async () => {
  let setEnabled: ReturnType<typeof useSetPluginEnabled> | undefined;
  function Toggle() {
    setEnabled = useSetPluginEnabled();
    return null;
  }
  mocks.setEnabled.mockRejectedValue(new Error("Couldn't save settings.json"));
  client.setQueryData(["plugins"], { clockify: false, devops: false });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Toggle />
      </QueryClientProvider>,
    ),
  );

  await expect(setEnabled!("clockify", true)).rejects.toThrow(
    "Couldn't save settings.json",
  );
  expect(client.getQueryData(["plugins"])).toEqual({
    clockify: false,
    devops: false,
  });
});

it("says a switch failed without waiting on the lists it asks again", async () => {
  let setEnabled: ReturnType<typeof useSetPluginEnabled> | undefined;
  function Toggle() {
    setEnabled = useSetPluginEnabled();
    // The Pull requests page's servers, asked again and slow to answer.
    useQuery({ queryKey: ["pull-servers"], queryFn: () => slow.promise });
    return null;
  }
  const slow = Promise.withResolvers<string[]>();
  mocks.setEnabled.mockRejectedValue(new Error("Couldn't save settings.json"));
  client.setQueryData(["plugins"], { clockify: false, devops: false });
  client.setQueryData(["pull-servers"], []);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Toggle />
      </QueryClientProvider>,
    ),
  );

  const failed = vi.fn();
  void setEnabled!("clockify", true).catch(failed);
  await vi.waitFor(() => expect(failed).toHaveBeenCalled());
  slow.resolve([]);
});
