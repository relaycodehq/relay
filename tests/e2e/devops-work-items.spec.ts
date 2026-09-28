import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("assigned Azure DevOps work items appear under a new thread and Jev narrows them to the project", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-devops-"))),
    repo = join(root, "licensing");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  await mkdir(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(join(repo, "README.md"), "# Licensing\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  // A scripted agent so the attached work item can really be sent.
  const bin = join(root, "bin");
  await mkdir(bin);
  for (const name of ["codex", "claude"])
    await fakeCli(
      join(bin, name),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog, net }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
      const g = globalThis as { devopsCalls?: string[] };
      g.devopsCalls = [];
      const reply = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      // Fixed, so a refetch sees unchanged items and Jev's answers are reused.
      const changed = new Date(Date.now() - 3600_000).toISOString();
      const item = (
        id: number,
        title: string,
        state: string,
        area: string,
        tags = "",
      ) => ({
        id,
        fields: {
          "System.Title": title,
          "System.WorkItemType": "User Story",
          "System.State": state,
          "System.AreaPath": area,
          "System.TeamProject": "Software",
          "System.Tags": tags,
          "System.ChangedDate": changed,
          "System.Description": "<p>Customers cannot find licenses.</p>",
        },
      });
      const original = net.fetch.bind(net);
      net.fetch = (async (input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://dev.azure.com/")) {
          g.devopsCalls!.push(url);
          if (url.includes("/_apis/wit/wiql"))
            return reply({
              workItems: [{ id: 9789 }, { id: 10263 }, { id: 10032 }],
            });
          return reply({
            value: [
              item(
                9789,
                "Licensing: extend and improve search options and UX",
                "On Hold",
                "Software\\WEB",
                "Licensing",
              ),
              item(
                10263,
                "(Fleet project) Port Kiosk to Windows tablet",
                "On Hold",
                "Software\\DEVICE",
              ),
              item(
                10032,
                "Implement RFID",
                "Active",
                "Software\\DEVICE",
                "Kiosk",
              ),
            ],
          });
        }
        if (url === "https://openrouter.ai/api/v1/systemone") {
          g.devopsCalls!.push(url);
          const body = JSON.parse(String(init?.body));
          return reply({
            answers: Object.fromEntries(
              Object.keys(body.questions).map((k) => [
                k,
                { type: "noul", noul: k === "wi_9789" ? 0.97 : 0.04 },
              ]),
            ),
          });
        }
        return original(input, init);
      }) as typeof net.fetch;
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /What should we work on in/ }),
    ).toBeVisible();
    // Nothing shows until the integration is turned on.
    await expect(
      page.getByRole("region", { name: "Your work items" }),
    ).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+Comma");
    const settings = page.getByRole("dialog");
    await settings.getByRole("button", { name: "Integrations" }).click();
    const devops = settings.getByRole("region", { name: "Azure DevOps" });
    await devops.getByLabel("Show my work items under new threads").check();
    await devops.getByLabel("Organization").fill("contoso");
    await devops.getByLabel("Project").fill("Software");
    await devops.getByLabel("Personal access token").fill("pat-123");
    await devops.getByRole("button", { name: "Save and test" }).click();
    await expect(devops.getByRole("status")).toHaveText(
      "Connected · 3 open items assigned to you",
    );
    await page.screenshot({ path: join(root, "settings.png") });

    const filter = settings.getByRole("region", { name: "Project filter" });
    await filter
      .getByLabel("Show only the items that belong to the open project")
      .check();
    await filter.getByLabel("OpenRouter API key").fill("sk-or-test");
    await filter.getByRole("button", { name: "Save filter" }).click();
    await expect(filter.getByRole("status")).toHaveText("Saved");
    const projects = settings.getByRole("region", { name: "Projects" });
    await projects
      .getByLabel("licensing hints")
      .fill("Licensing, license keys");
    await projects.getByRole("button", { name: "Save projects" }).click();
    await expect(projects.getByRole("status")).toHaveText("Saved");
    await settings.getByRole("button", { name: "Close dialog" }).click();

    const cards = page.getByRole("region", { name: "Your work items" });
    await expect(cards.locator(".work-item-card")).toHaveCount(1);
    await expect(cards).toContainText("Licensing: extend and improve search");
    await page.screenshot({ path: join(root, "cards-matched.png") });

    await cards.getByRole("button", { name: /^All/ }).click();
    await expect(cards.locator(".work-item-card")).toHaveCount(3);
    await cards.getByLabel("Search work items").fill("rfid");
    await expect(cards.locator(".work-item-card")).toHaveCount(1);
    await cards.getByLabel("Search work items").fill("");
    await page.screenshot({ path: join(root, "cards-all.png") });

    // Projects outside Azure DevOps can hide the cards, and take it back.
    const jevCalls = async () =>
      (
        await app.evaluate(
          () => (globalThis as { devopsCalls?: string[] }).devopsCalls!,
        )
      ).filter((u) => u.includes("openrouter")).length;
    const jevBefore = await jevCalls();
    await cards
      .getByRole("button", { name: "Hide work items in licensing" })
      .click();
    await expect(cards).toHaveCount(0);
    const hidden = page.getByRole("status").filter({
      hasText: "Work items are hidden in licensing.",
    });
    await expect(hidden).toBeVisible();
    await hidden.getByRole("button", { name: "Undo" }).click();
    // The row comes back as it was left, still showing every item.
    await expect(cards.locator(".work-item-card")).toHaveCount(3);
    // Unchanged items keep Jev's earlier answers.
    expect(await jevCalls()).toBe(jevBefore);

    // The scrollbar is hidden; the row fades only towards cards off-screen.
    const row = cards.locator(".work-items-row");
    expect(
      await row.evaluate((el) => getComputedStyle(el).scrollbarWidth),
    ).toBe("none");
    expect(await row.getAttribute("data-fade-start")).toBeNull();

    // Picking a card attaches it instead of pasting it into the draft.
    const card = cards.getByRole("button", {
      name: /Licensing: extend and improve/,
    });
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    const chip = page.locator(".work-item-chip");
    await expect(chip).toContainText("#9789");
    await expect(chip).toContainText("On Hold");
    await expect(page.locator(".thread-start .ProseMirror")).toHaveText("");
    // The attachment alone is enough to send.
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeEnabled();
    await page.screenshot({ path: join(root, "attached.png") });

    // Picking it again, or the chip's remove button, detaches it.
    await card.click();
    await expect(chip).toHaveCount(0);
    await card.click();
    await chip.getByRole("button", { name: "Remove work item" }).click();
    await expect(chip).toHaveCount(0);
    await expect(card).toHaveAttribute("aria-pressed", "false");

    // Sending puts the work item first, then `~` and the user's words.
    await card.click();
    await page.locator(".thread-start .ProseMirror").click();
    await page.keyboard.type("I am going to work on this card");
    await page.getByRole("button", { name: "Send message" }).click();
    const sent = page.getByRole("article", { name: "Your message" });
    await expect(sent).toContainText(
      "User Story #9789: Licensing: extend and improve search options and UX",
    );
    await expect(sent).toContainText("~");
    await expect(sent).toContainText("I am going to work on this card");
    await expect(page.locator(".work-item-chip")).toHaveCount(0);
    await page.screenshot({ path: join(root, "sent.png") });
    // Once before the hints were saved, once with them.
    expect(await jevCalls()).toBe(2);
    console.log("screenshots in", root);
  } finally {
    await app.close();
  }
});
