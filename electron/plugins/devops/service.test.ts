import { beforeEach, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../app/store";
import {
  defaultDevOpsSettings,
  type DevOpsSettings,
} from "../../../shared/devops";
import { DevOps } from "./service";
import type { Fetch } from "./client";

const az = vi.hoisted(() => ({ token: "old-login", issued: [] as string[] }));

vi.mock("../../platform/executables", () => ({
  findExecutable: async () => "az",
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    done: (error: Error | null, result: { stdout: string }) => void,
  ) => {
    az.issued.push(az.token);
    done(null, {
      stdout: JSON.stringify({
        accessToken: az.token,
        expires_on: Date.now() / 1000 + 3600,
      }),
    });
  },
}));

beforeEach(() => {
  az.token = "old-login";
  az.issued = [];
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const refused = (status: number) =>
  new Response("<html>Sign in</html>", { status });

async function setup(fetch: Fetch, auth: DevOpsSettings["auth"] = "azure-cli") {
  const store = new Store(
    await mkdtemp(join(tmpdir(), "relay-devops-recovery-")),
  );
  await store.load();
  const devops = new DevOps(
    store,
    fetch,
    async (value) => `sealed:${value}`,
    async (value) => value.replace(/^sealed:/, ""),
  );
  await devops.save(
    { ...defaultDevOpsSettings, enabled: true, organization: "contoso", auth },
    auth === "pat" ? { pat: "old-pat" } : {},
  );
  return devops;
}

function server() {
  const seen: string[] = [];
  const state = {
    failure: undefined as number | "network" | undefined,
    holdFields: undefined as Promise<Response> | undefined,
    holdItems: undefined as Promise<Response> | undefined,
  };
  const fetch: Fetch = async (url, init) => {
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: {
          "x-vss-resourcetenant": "11111111-1111-1111-1111-111111111111",
        },
      });
    seen.push(new Headers(init?.headers).get("authorization")!);
    if (url.includes("/wit/fields") && state.holdFields)
      return state.holdFields;
    if (url.includes("/wit/wiql") && state.holdItems) return state.holdItems;
    if (state.failure === "network") throw new TypeError("fetch failed");
    if (state.failure !== undefined) return refused(state.failure);
    if (url.includes("/wit/fields")) return json({ value: [] });
    if (url.includes("/wit/wiql")) return json({ workItems: [] });
    if (url.includes("/wit/workitemsbatch"))
      return json({
        value: [
          {
            id: 1,
            fields: {
              "System.Title": "Old item",
              "System.TeamProject": "Software",
            },
          },
        ],
      });
    return json({
      authenticatedUser: { providerDisplayName: "Sample account" },
    });
  };
  return { fetch, seen, state };
}

const operations = [
  { name: "sign-in check", run: (devops: DevOps) => devops.whoAmI() },
  { name: "fields", run: (devops: DevOps) => devops.fields() },
  { name: "work items", run: (devops: DevOps) => devops.workItems(null, true) },
];

it.each(
  operations.flatMap((operation) =>
    [401, 203, 200].map((status) => ({ ...operation, status })),
  ),
)(
  "picks up a new CLI login after $name gets a $status sign-in refusal",
  async ({ run, status }) => {
    const { fetch, seen, state } = server();
    const devops = await setup(fetch);
    await devops.whoAmI();
    state.failure = status;
    await expect(run(devops)).rejects.toThrow(/Azure CLI sign-in.*az login/);
    // Report the refusal once; recovery mustn't replay a request automatically.
    expect(seen).toEqual(["Bearer old-login", "Bearer old-login"]);
    az.token = "new-login";
    state.failure = undefined;
    await run(devops);
    expect(seen.at(-1)).toBe("Bearer new-login");
    expect(az.issued).toEqual(["old-login", "new-login"]);
  },
);

it.each(["network", 403, 404, 429, 500] as const)(
  "keeps the CLI credential when the failure is %s",
  async (failure) => {
    const { fetch, seen, state } = server();
    const devops = await setup(fetch);
    await devops.whoAmI();
    state.failure = failure;
    await expect(devops.whoAmI()).rejects.toThrow();
    az.token = "new-login";
    state.failure = undefined;
    await devops.whoAmI();
    expect(seen.at(-1)).toBe("Bearer old-login");
    expect(az.issued).toEqual(["old-login"]);
  },
);

it.each([401, 203, 200])(
  "keeps a PAT refused with %i saved and uses its replacement without asking az",
  async (status) => {
    const { fetch, seen, state } = server();
    const devops = await setup(fetch, "pat");
    state.failure = status;
    await expect(devops.whoAmI()).rejects.toThrow(/token.*Work Items \(Read\)/);
    expect(devops.status().hasPat).toBe(true);
    await devops.save(devops.settings(), { pat: "new-pat" });
    state.failure = undefined;
    await devops.whoAmI();
    expect(seen.at(-1)).toBe(
      `Basic ${Buffer.from(":new-pat").toString("base64")}`,
    );
    expect(az.issued).toEqual([]);
  },
);

it("doesn't let a late refusal discard the CLI credential that already recovered", async () => {
  const { fetch, seen, state } = server();
  const devops = await setup(fetch);
  await devops.whoAmI();
  let finish!: (response: Response) => void;
  state.holdFields = new Promise((resolve) => {
    finish = resolve;
  });
  const late = expect(devops.fields()).rejects.toThrow(/Azure CLI sign-in/);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  state.failure = 401;
  await expect(devops.whoAmI()).rejects.toThrow(/Azure CLI sign-in/);
  az.token = "new-login";
  state.failure = undefined;
  await devops.whoAmI();
  finish(refused(401));
  await late;
  await devops.whoAmI();
  expect(seen.at(-1)).toBe("Bearer new-login");
  expect(az.issued).toEqual(["old-login", "new-login"]);
});

it("drops cached fields and work items when their sign-in is rejected", async () => {
  const { fetch, seen, state } = server();
  const devops = await setup(fetch);
  await devops.fields();
  await devops.workItems(null);
  state.failure = 401;
  await expect(devops.whoAmI()).rejects.toThrow(/Azure CLI sign-in/);
  az.token = "new-login";
  state.failure = undefined;
  await devops.fields();
  await devops.workItems(null);
  expect(seen.slice(-2)).toEqual(["Bearer new-login", "Bearer new-login"]);
  expect(az.issued).toEqual(["old-login", "new-login"]);
});

it("keeps the new settings' CLI sign-in even when its token matches a late refusal", async () => {
  const { fetch, seen, state } = server();
  const devops = await setup(fetch);
  await devops.whoAmI();
  let finish!: (response: Response) => void;
  state.holdFields = new Promise((resolve) => {
    finish = resolve;
  });
  const late = expect(devops.fields()).rejects.toThrow(/Azure CLI sign-in/);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  await devops.save(devops.settings(), {});
  await devops.whoAmI();
  finish(refused(401));
  await late;
  await devops.whoAmI();
  // Saving without changing the sign-in keeps the shared az token too.
  expect(az.issued).toEqual(["old-login"]);
});

it("doesn't let old fields arriving late overwrite the recovered account's cache", async () => {
  const { fetch, seen, state } = server();
  const devops = await setup(fetch);
  await devops.whoAmI();
  let finish!: (response: Response) => void;
  state.holdFields = new Promise((resolve) => {
    finish = resolve;
  });
  const late = devops.fields();
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  state.failure = 401;
  await expect(devops.whoAmI()).rejects.toThrow(/Azure CLI sign-in/);
  az.token = "new-login";
  state.failure = undefined;
  state.holdFields = undefined;
  expect(await devops.fields()).toEqual([]);
  finish(
    json({ value: [{ name: "Old field", referenceName: "Custom.OldField" }] }),
  );
  await late;
  expect(await devops.fields()).toEqual([]);
});

it("doesn't let old work items arriving late overwrite the recovered account's cache", async () => {
  const { fetch, seen, state } = server();
  const devops = await setup(fetch);
  await devops.whoAmI();
  let finish!: (response: Response) => void;
  state.holdItems = new Promise((resolve) => {
    finish = resolve;
  });
  const late = devops.workItems(null);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  state.failure = 401;
  await expect(devops.whoAmI()).rejects.toThrow(/Azure CLI sign-in/);
  az.token = "new-login";
  state.failure = undefined;
  state.holdItems = undefined;
  expect((await devops.workItems(null)).items).toEqual([]);
  finish(json({ workItems: [{ id: 1 }] }));
  expect((await late).items[0].title).toBe("Old item");
  expect((await devops.workItems(null)).items).toEqual([]);
});
