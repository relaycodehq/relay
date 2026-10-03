import { describe, expect, it } from "vitest";
import {
  assembleLegacy,
  draftKeyOf,
  emptyThreadDraft,
  mergeLegacy,
  parseLegacyKey,
  parseThreadDraft,
  serializeThreadDraft,
  splitDraftKey,
  withBody,
  type ThreadDraft,
} from "./thread-draft";

const sha = "a".repeat(40);
const selection = {
  head: sha,
  base: sha,
  path: "src/a.ts",
  start: 3,
  end: 4,
  side: "additions" as const,
  question: "Why?",
};
const ref = { path: "src/b.ts", start: 1, end: 2, label: "HEAD", code: "x" };
const workItem = { id: 7, title: "Fix it" };

const full: ThreadDraft = {
  main: {
    text: "Hello $go",
    skills: { $go: "Go" },
    quotes: ["> a"],
    files: ["src/a.ts"],
  },
  replies: { r1: { text: "Reply", skills: {}, quotes: [], files: ["b.ts"] } },
  replyRoot: "r1",
  selection,
  workItem: workItem as ThreadDraft["workItem"],
  codeRefs: [ref],
  scope: { kind: "review" },
  workspace: "worktree",
};

describe("the record", () => {
  it("reads back what it wrote", () => {
    expect(parseThreadDraft(JSON.parse(serializeThreadDraft(full)))).toEqual(
      full,
    );
  });

  it("writes nothing for what is empty", () => {
    expect(serializeThreadDraft(emptyThreadDraft())).toBe('{"v":1}');
    const quiet = withBody(
      withBody(full, "r1", { text: "", files: [] }),
      undefined,
      {
        text: "",
        skills: {},
        quotes: [],
        files: [],
      },
    );
    expect(JSON.parse(serializeThreadDraft(quiet))).not.toHaveProperty("main");
    expect(JSON.parse(serializeThreadDraft(quiet))).not.toHaveProperty(
      "replies",
    );
  });

  it.each([null, undefined, "x", 3, []])(
    "reads %j as an empty draft",
    (saved) => {
      expect(parseThreadDraft(saved)).toEqual(emptyThreadDraft());
    },
  );

  it("keeps the parts that read when others don't", () => {
    expect(
      parseThreadDraft({
        v: 1,
        main: {
          text: "kept",
          skills: { $a: "A", $b: 4 },
          quotes: ["q", 3, null],
          files: "nope",
        },
        replies: { r1: { text: "reply" }, r2: "junk", r3: { text: "" } },
        replyRoot: 5,
        selection: { path: "x" },
        workItem: { id: "7" },
        codeRefs: [ref, { path: 1 }],
        scope: { kind: "elsewhere" },
        workspace: "moon",
      }),
    ).toEqual({
      main: { text: "kept", skills: { $a: "A" }, quotes: ["q"], files: [] },
      replies: { r1: { text: "reply", skills: {}, quotes: [], files: [] } },
      codeRefs: [ref],
    });
  });

  it("drops a side conversation when its last part goes", () => {
    expect(withBody(full, "r1", { text: "", files: [] }).replies).toEqual({});
  });
});

describe("draft keys", () => {
  it.each([
    ["chat-draft:c1", { thread: "c1" }],
    ["chat-draft:c1:r1", { thread: "c1", reply: "r1" }],
    ["chat-draft:new:p1", { thread: "new:p1" }],
    ["chat-draft:new:p1:slot", { thread: "new:p1:slot" }],
  ])("splits %s", (key, split) => {
    expect(splitDraftKey(key)).toEqual(split);
    expect(
      draftKeyOf(split.thread, "reply" in split ? split.reply : undefined),
    ).toBe(key);
  });

  it("splits nothing else", () => {
    expect(splitDraftKey("chat-draft:")).toBeUndefined();
    expect(splitDraftKey("composer-settings:c1")).toBeUndefined();
  });

  it("knows each key the old way of keeping a draft used", () => {
    expect(parseLegacyKey("chat-draft:c1:r1")).toEqual({
      thread: "c1",
      reply: "r1",
      kind: "text",
    });
    expect(parseLegacyKey("quote-chips:chat-draft:c1:r1")).toEqual({
      thread: "c1",
      reply: "r1",
      kind: "quotes",
    });
    expect(parseLegacyKey("pasted-texts:chat-draft:new:p:s")).toEqual({
      thread: "new:p:s",
      kind: "pastes",
    });
    expect(parseLegacyKey("chat-code-refs:c1")).toEqual({
      thread: "c1",
      kind: "codeRefs",
    });
    expect(parseLegacyKey("relay-draft-workspace:p:s")).toEqual({
      thread: "new:p:s",
      kind: "workspace",
    });
  });

  it("leaves the keys that are not part of a draft", () => {
    for (const key of [
      "composer-settings:c1",
      "relay-thread-panes",
      "relay-draft:c1",
      "skill-chips:c1",
      "chat-reply:",
      "theme",
    ])
      expect(parseLegacyKey(key)).toBeUndefined();
  });
});

describe("assembling the old keys", () => {
  const entries: [string, string][] = [
    ["chat-draft:c1", "Hello $go"],
    ["chat-draft:c1:r1", "Reply"],
    ["chat-reply:c1", "r1"],
    ["chat-selection:c1", JSON.stringify(selection)],
    ["chat-work-item:c1", JSON.stringify(workItem)],
    ["chat-code-refs:c1", JSON.stringify([ref])],
    ["skill-chips:chat-draft:c1", '{"$go":"Go"}'],
    ["quote-chips:chat-draft:c1", '["> a"]'],
    ["file-chips:chat-draft:c1", '["src/a.ts"]'],
    ["file-chips:chat-draft:c1:r1", '["b.ts"]'],
    ["relay-draft-scope:p1:s", '{"kind":"review"}'],
    ["relay-draft-workspace:p1:s", "worktree"],
    ["chat-draft:c2", "Other thread"],
  ];

  it("puts every part of a thread in its draft", () => {
    const drafts = assembleLegacy(entries);
    expect(drafts.get("c1")).toEqual({
      ...full,
      scope: undefined,
      workspace: undefined,
    });
    // Scope and workspace belong to the unsent thread; its draft has no text yet.
    expect(drafts.get("new:p1:s")).toMatchObject({
      scope: { kind: "review" },
      workspace: "worktree",
    });
    expect(drafts.get("c2")?.main.text).toBe("Other thread");
    expect(drafts.size).toBe(3);
  });

  it("keeps the text when a part beside it is garbled", () => {
    const drafts = assembleLegacy([
      ["chat-draft:c1", "Typed"],
      ["skill-chips:chat-draft:c1", "{oops"],
      ["quote-chips:chat-draft:c1", '["ok", 3]'],
      ["file-chips:chat-draft:c1", "7"],
      ["chat-selection:c1", "not json"],
      ["chat-work-item:c1", '{"id":"x"}'],
      ["chat-code-refs:c1", '{"a":1}'],
      ["relay-draft-scope:p1", "{"],
      ["relay-draft-workspace:p1", "moon"],
    ]);
    expect(drafts.get("c1")).toEqual({
      ...emptyThreadDraft(),
      main: { text: "Typed", skills: {}, quotes: ["ok"], files: [] },
    });
    expect(drafts.get("new:p1")).toEqual(emptyThreadDraft());
  });

  it("turns pastes the released version kept beside a draft into pills after its text", () => {
    const pastes = JSON.stringify([
      { n: 1, text: "one" },
      { n: "2", text: "bad" },
      { n: 2, text: "two" },
    ]);
    const { main } = assembleLegacy([
      ["chat-draft:c1", "Look at this  \n"],
      ["pasted-texts:chat-draft:c1", pastes],
    ]).get("c1")!;
    expect(main.text).toBe(
      "Look at this\n\nPasted text #1:\n\n```\none\n```\n\n\n\nPasted text #2:\n\n```\ntwo\n```\n\n",
    );
    // With no text beside them, they are all the draft has; garbled ones are none.
    expect(
      assembleLegacy([["pasted-texts:chat-draft:c2", pastes]]).get("c2")!.main
        .text,
    ).toContain("Pasted text #1");
    expect(
      assembleLegacy([["pasted-texts:chat-draft:c3", "{"]]).get("c3")!.main
        .text,
    ).toBe("");
  });

  it("puts a side conversation's pastes and pills in its own draft", () => {
    const { replies, main } = assembleLegacy([
      ["chat-draft:c1:r1", "Reply"],
      ["pasted-texts:chat-draft:c1:r1", '[{"n":1,"text":"p"}]'],
      ["skill-chips:chat-draft:c1:r1", '{"$a":"A"}'],
    ]).get("c1")!;
    expect(main.text).toBe("");
    expect(replies.r1.text).toContain("Reply\n\nPasted text #1");
    expect(replies.r1.skills).toEqual({ $a: "A" });
  });
});

describe("merging old keys into a record", () => {
  it("lets what the old keys hold win and the record fill in the rest", () => {
    const record = parseThreadDraft({
      main: { text: "newer record", skills: { $a: "A" }, quotes: ["q"] },
      replies: { r1: { text: "r" } },
      selection,
      scope: { kind: "review" },
    });
    const legacy = assembleLegacy([
      ["chat-draft:c1", "from an older build"],
      ["skill-chips:chat-draft:c1", '{"$b":"B"}'],
      ["chat-draft:c1:r2", "second"],
      ["chat-code-refs:c1", JSON.stringify([ref])],
    ]).get("c1")!;
    const merged = mergeLegacy(record, legacy);
    expect(merged.main).toEqual({
      text: "from an older build",
      skills: { $a: "A", $b: "B" },
      quotes: ["q"],
      files: [],
    });
    expect(Object.keys(merged.replies).sort()).toEqual(["r1", "r2"]);
    expect(merged.selection).toEqual(selection);
    expect(merged.scope).toEqual({ kind: "review" });
    expect(merged.codeRefs).toEqual([ref]);
  });

  it("keeps the record when the old keys hold nothing", () => {
    expect(mergeLegacy(full, emptyThreadDraft())).toEqual(full);
  });
});
