import { expect, it } from "vitest";
import { anonymizer } from "./anonymize";

const mac = anonymizer({
  home: "/Users/jana",
  user: "jana",
  hosts: ["Janas-MacBook-Pro"],
  relayData: "/Users/jana/Library/Application Support/Relay",
  projects: [
    { path: "/Users/jana/code/secret-startup", repo: "acme/secret-startup" },
    { path: "/Volumes/Work/client-app" },
  ],
});

it("swaps paths for stable placeholders and keeps what's under them", () => {
  const out = mac(
    [
      "warn Could not read /Users/jana/code/secret-startup/src/app.ts: ENOENT",
      'error {"cwd":"/Users/jana/code/secret-startup"} failed in /Volumes/Work/client-app/.git',
      "info Saved /Users/jana/Library/Application Support/Relay/state.json",
      "info Shell /Users/jana/.zshrc, again /Users/jana/code/secret-startup/README.md",
      "info Cloned acme/secret-startup for jana on Janas-MacBook-Pro.local",
    ].join("\n"),
  );
  expect(out).toContain("Could not read <project-1>/src/app.ts: ENOENT");
  expect(out).toContain('{"cwd":"<project-1>"}');
  expect(out).toContain("<project-2>/.git");
  expect(out).toContain("Saved <relay-data>/state.json");
  expect(out).toContain("Shell ~/.zshrc, again <project-1>/README.md");
  expect(out).toContain("Cloned <repo-1> for <user> on <host>");
  expect(out).not.toMatch(/jana|secret-startup|client-app|MacBook/i);
});

it("hides the Mac's own names, apostrophes, accents and all", () => {
  const named = anonymizer({
    home: "/Users/jana",
    user: "jana",
    hosts: ["Janas-MacBook-Pro", "Jana’s MacBook Pro", "Počítač-Jany"],
    relayData: "/x",
    projects: [],
  });
  expect(
    named(
      "paired as Jana’s MacBook Pro (Janas-MacBook-Pro.local), handoff to počítač-jany done",
    ),
  ).toBe("paired as <host> (<host>), handoff to <host> done");
});

it("doesn't eat a longer folder that starts with the same name", () => {
  expect(mac("/Users/janaother/x and /Users/jana")).toBe(
    "/Users/janaother/x and ~",
  );
});

it("handles Windows paths in either slash and JSON-escaped", () => {
  const win = anonymizer({
    home: "C:\\Users\\Jana",
    user: "Jana",
    hosts: ["DESKTOP-7Q2"],
    relayData: "C:\\Users\\Jana\\AppData\\Roaming\\Relay",
    projects: [],
  });
  expect(
    win(
      'c:\\users\\jana\\AppData\\Roaming\\Relay\\logs and "C:\\\\Users\\\\Jana\\\\x" and C:/Users/Jana/y on DESKTOP-7Q2',
    ),
  ).toBe('<relay-data>\\logs and "~\\\\x" and ~/y on <host>');
});

it("removes credentials, query values, emails and private addresses", () => {
  const out = mac(
    [
      "GET https://api.example.com/v1/items?token=abc123&page=2#top",
      "auth Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
      "key ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "from jana.novak@example.org at 192.168.1.20 and 100.101.102.103 via http://127.0.0.1:5177/",
      "pair with mini.tail1234.ts.net",
    ].join("\n"),
  );
  expect(out).toContain("https://api.example.com/v1/items?token=…&page=…#top");
  expect(out).toContain("Bearer [redacted]");
  expect(out).toContain("[redacted GitHub token]");
  expect(out).toContain(
    "from <email> at <ip> and <ip> via http://127.0.0.1:5177/",
  );
  expect(out).toContain("pair with <host>");
  expect(out).not.toMatch(/abc123|ghp_|novak|192\.168|tail1234/);
});
