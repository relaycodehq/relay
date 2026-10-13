import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { screenshot } from "../fixtures/screenshot";

test("a refused Azure CLI login recovers from Check sign-in without restarting Relay", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-devops-auth-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const tokenFile = join(root, "cli-token.txt");
  await writeFile(tokenFile, "old-login");
  await fakeCli(
    join(bin, "az"),
    `const args = process.argv.slice(2);
     if (args[0] === "version") {
       console.log(JSON.stringify({ "azure-cli": "2.86.0" }));
     } else {
       const token = require("node:fs").readFileSync(process.env.RELAY_TEST_AZ_TOKEN, "utf8");
       console.log(JSON.stringify({ accessToken: token, expires_on: Date.now() / 1000 + 3600 }));
     }`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_AZ_TOKEN: tokenFile,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ net }) => {
      const original = net.fetch.bind(net);
      net.fetch = (async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://dev.azure.com/"))
          return original(input, init);
        if (init?.method === "HEAD")
          return new Response(null, {
            headers: {
              "x-vss-resourcetenant": "11111111-1111-1111-1111-111111111111",
            },
          });
        if (
          new Headers(init?.headers).get("authorization") === "Bearer old-login"
        )
          return new Response("<html>Sign in</html>", { status: 203 });
        if (url.includes("/connectionData"))
          return Response.json({
            authenticatedUser: { providerDisplayName: "Sample account" },
          });
        if (url.includes("/wit/fields")) return Response.json({ value: [] });
        return Response.json({ workItems: [] });
      }) as typeof net.fetch;
    });
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await settings.getByRole("button", { name: "Integrations" }).click();
    const plugin = settings.getByRole("region", { name: "Work items" });
    await plugin.getByRole("switch", { name: "Use Azure DevOps" }).check();
    await plugin
      .getByRole("button", { name: "Azure CLI", exact: true })
      .click();
    await plugin.getByLabel("Azure DevOps organization").fill("contoso");
    await plugin.getByLabel("Azure DevOps organization").press("Enter");
    await expect(plugin).toContainText(
      "Azure DevOps rejected the Azure CLI sign-in.",
    );
    const check = plugin.getByRole("button", {
      name: "Check sign-in",
      exact: true,
    });
    await expect(check).toBeEnabled();
    await screenshot(plugin, { path: join(root, "refused.png") });
    // A terminal login changes the CLI's credential source, with Relay still running.
    await writeFile(tokenFile, "new-login");
    await check.click();
    await expect(plugin).toContainText("Signed in as Sample account.");
    await expect(plugin).not.toContainText("Azure DevOps rejected");
    await expect(check).toBeEnabled();
    await screenshot(plugin, { path: join(root, "recovered.png") });
    console.log("auth recovery screenshots in", root);
  } finally {
    await app.close();
  }
});
