import { describe, expect, it } from "vitest";
import {
  ASK_ANSWER_MAX_CHARS,
  LIGHT_RENDER_THEME,
  RENDER_COMPOSE_CHARS,
  RENDER_MAX_HEIGHT,
} from "./html-render";
import {
  PHONE_RENDER_CSP,
  parseRenderMessage,
  phoneRenderDocument,
} from "./html-render-phone";

describe("phoneRenderDocument", () => {
  it("puts the rules and the bootstrap before anything the page does", () => {
    const html = phoneRenderDocument(
      "<!doctype html><html><head><title>x</title></head><body>hi</body></html>",
      LIGHT_RENDER_THEME,
    );
    expect(html).toMatch(
      /^<!doctype html><html><head><meta name="viewport"[^>]*><meta http-equiv="Content-Security-Policy"[^>]*><script>[\s\S]*<\/script><title>x<\/title>/,
    );
    expect(html).toContain("ReactNativeWebView.postMessage");
  });

  it("gives a page without a doctype one, so it isn't in quirks mode", () => {
    expect(phoneRenderDocument("<p>hi</p>", LIGHT_RENDER_THEME)).toMatch(
      /^<!doctype html><head><meta charset="utf-8">/,
    );
  });

  it("keeps the desktop's rules but for the sandbox a meta can't carry", () => {
    expect(PHONE_RENDER_CSP).not.toContain("sandbox");
    expect(PHONE_RENDER_CSP).toContain("default-src 'none'");
    expect(PHONE_RENDER_CSP).toContain("connect-src https:");
    expect(PHONE_RENDER_CSP).not.toContain('"');
  });

  it("can't be broken out of by a theme value", () => {
    const html = phoneRenderDocument("<p>x</p>", {
      scheme: "dark",
      vars: { "--text": "</script><script>alert(1)</script>" },
    });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe("parseRenderMessage", () => {
  const parse = (m: unknown) => parseRenderMessage(JSON.stringify(m));

  it("takes the three messages a page may send", () => {
    expect(parse({ relayRender: "size", height: 120.4 })).toEqual({
      relayRender: "size",
      height: 121,
    });
    expect(
      parse({ relayRender: "link", href: "https://example.com/a" }),
    ).toEqual({
      relayRender: "link",
      href: "https://example.com/a",
    });
    expect(parse({ relayRender: "compose", text: "Go with B" })).toEqual({
      relayRender: "compose",
      text: "Go with B",
    });
  });

  it("takes an asked page's answer whole, and none too big to hand back", () => {
    const json = JSON.stringify({ sound: "glass" });
    expect(parse({ relayRender: "answer", json })).toEqual({
      relayRender: "answer",
      json,
    });
    const big = JSON.stringify("x".repeat(ASK_ANSWER_MAX_CHARS));
    expect(parse({ relayRender: "answer", json: big })).toBeNull();
    expect(
      parse({ relayRender: "answer", json: { sound: "glass" } }),
    ).toBeNull();
  });

  it("takes a short page's own height, as a one-line formula needs", () => {
    expect(parse({ relayRender: "size", height: 41 })).toEqual({
      relayRender: "size",
      height: 41,
    });
  });

  it("keeps a runaway height and a long text within bounds", () => {
    expect(parse({ relayRender: "size", height: 1e9 })).toEqual({
      relayRender: "size",
      height: RENDER_MAX_HEIGHT,
    });
    const long = parse({ relayRender: "compose", text: "x".repeat(1e5) });
    expect(long?.relayRender === "compose" && long.text).toHaveLength(
      RENDER_COMPOSE_CHARS,
    );
  });

  it.each([
    "not json",
    "null",
    '"size"',
    JSON.stringify({ relayRender: "size", height: "tall" }),
    JSON.stringify({ relayRender: "size", height: null }),
    JSON.stringify({ relayRender: "link", href: "javascript:alert(1)" }),
    JSON.stringify({ relayRender: "link", href: "intent://x#Intent;end" }),
    JSON.stringify({ relayRender: "link", href: "tel:112" }),
    JSON.stringify({ relayRender: "compose", text: "   " }),
    JSON.stringify({ relayRender: "other" }),
  ])("drops %s", (data) => {
    expect(parseRenderMessage(data)).toBeNull();
  });
});
