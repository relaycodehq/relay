import { describe, expect, it } from "vitest";
import { parseNote, saidInAnswer } from "./parse";

describe("parseNote", () => {
  it("reads nothing to say as no note", () => {
    expect(parseNote("learn: none")).toBeNull();
    expect(parseNote("learn: None.")).toBeNull();
    expect(parseNote("**learn:** none")).toBeNull();
    expect(parseNote("I think everything looks fine.")).toBeNull();
  });

  it("reads a full note, diff and ask included", () => {
    const note =
      parseNote(`learn: The tests subagent made checkout.spec.ts pass by accepting any total.
tag: Heads up
title: The checkout test no longer checks the total
- It compared the total to **42.00**.
- Now it accepts any amount.
diff: tests/checkout.spec.ts
\`\`\`
-  expect(total).toBe("42.00");
+  expect(total).toMatch(/^\\d+\\.\\d{2}$/);
\`\`\`
ask: Put back the exact total and fix the rounding instead.`);
    expect(note).toEqual({
      tag: "Heads up",
      line: "The tests subagent made checkout.spec.ts pass by accepting any total.",
      title: "The checkout test no longer checks the total",
      points: [
        "It compared the total to **42.00**.",
        "Now it accepts any amount.",
      ],
      diff: {
        file: "tests/checkout.spec.ts",
        lines: [
          '-  expect(total).toBe("42.00");',
          "+  expect(total).toMatch(/^\\d+\\.\\d{2}$/);",
        ],
      },
      steer: "Put back the exact total and fix the rounding instead.",
    });
  });

  it("tolerates bold labels, a lead-in and missing optional parts", () => {
    const note = parseNote(`Here is my answer.
**learn:** Retries now apply to every spec.
**tag:** you should know
- One point.
ask: none`);
    expect(note).toEqual({
      tag: "You should know",
      line: "Retries now apply to every spec.",
      title: "Retries now apply to every spec.",
      points: ["One point."],
    });
  });

  it("drops a diff that has no file", () => {
    const note = parseNote("learn: Something.\n```\n+ x\n```");
    expect(note?.diff).toBeUndefined();
  });
});

describe("said", () => {
  // The note from the Cloudflare deploy, and the answer that already said it.
  const answer = `The site is on the mini and Caddy is set up for \`relay.example.com\`, but it isn't reachable yet: **the domain has no DNS record**. That part needs you, in Cloudflare.

**What you need to do**

Add a proxied A record in Cloudflare for \`relay\` pointing at the mini's public IP.`;
  const reply = (
    said: string,
  ) => `learn: relay.example.com has no DNS record yet, so the deploy cannot go live until you add one in Cloudflare.
tag: Heads up
title: Deploy needs a DNS record from you
- A lookup returned nothing.
said: ${said}`;

  it("reads where the agent said it, or nothing when it never did", () => {
    expect(parseNote(reply('"the domain has no DNS record"'))?.said).toBe(
      "the domain has no DNS record",
    );
    expect(parseNote(reply("never"))?.said).toBeUndefined();
  });

  it("finds a quote in the answer whatever its markdown, and nowhere else", () => {
    const said = (text: string) => parseNote(reply(text))?.said;
    expect(
      saidInAnswer(
        said("it isn't reachable yet: the domain has no DNS record"),
        answer,
      ),
    ).toBe(true);
    // Said only in passing mid-turn, not in the answer: still news.
    expect(
      saidInAnswer(said("DNS lookup for relay came back empty"), answer),
    ).toBe(false);
    expect(saidInAnswer(said("never"), answer)).toBe(false);
    // Too short to tell anything apart.
    expect(saidInAnswer(said("DNS record"), answer)).toBe(false);
  });
});
