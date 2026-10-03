import { expect, it, vi } from "vitest";

const az = vi.hoisted(() => ({
  pending: [] as { tenant: string; done: () => void }[],
}));

vi.mock("../../platform/executables", () => ({
  findExecutable: async () => "az",
}));
vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    args: string[],
    _options: unknown,
    done: (error: Error | null, result?: { stdout: string }) => void,
  ) => {
    const tenant = args[args.indexOf("--tenant") + 1];
    az.pending.push({
      tenant,
      done: () =>
        done(null, {
          stdout: JSON.stringify({
            accessToken: `token-${tenant}`,
            expires_on: Date.now() / 1000 + 3600,
          }),
        }),
    });
  },
}));

const { DevOpsAuth } = await import("./auth");

const tenants: Record<string, string> = {
  "https://dev.azure.com/old": "11111111-1111-1111-1111-111111111111",
  "https://dev.azure.com/new": "22222222-2222-2222-2222-222222222222",
};
const fetchTenant = async (url: string) => {
  const base = url.replace("/_apis/connectionData", "");
  return new Response(null, {
    headers: { "x-vss-resourcetenant": tenants[base] },
  });
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it("doesn't store a token an old organization's az call returns after the settings changed", async () => {
  const auth = new DevOpsAuth(fetchTenant, async () => undefined);

  const stale = auth.header("azure-cli", "https://dev.azure.com/old");
  await tick();
  auth.forget();

  az.pending.shift()!.done();
  expect(await stale).toBe(
    `Bearer token-${tenants["https://dev.azure.com/old"]}`,
  );

  const fresh = auth.header("azure-cli", "https://dev.azure.com/new");
  await tick();
  expect(az.pending).toHaveLength(1);
  az.pending.shift()!.done();
  expect(await fresh).toBe(
    `Bearer token-${tenants["https://dev.azure.com/new"]}`,
  );
});

it("reuses a token for the organization it was issued for", async () => {
  const auth = new DevOpsAuth(fetchTenant, async () => undefined);
  const first = auth.header("azure-cli", "https://dev.azure.com/old");
  await tick();
  az.pending.shift()!.done();
  await first;

  expect(await auth.header("azure-cli", "https://dev.azure.com/old")).toBe(
    `Bearer token-${tenants["https://dev.azure.com/old"]}`,
  );
  expect(az.pending).toHaveLength(0);
});
