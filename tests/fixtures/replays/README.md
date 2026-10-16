# Recorded agent transcripts

What the real agent CLIs said in each turn-lifecycle scenario, played back by
`tests/fixtures/replay-agent.cjs` in `electron/project-chats/turn-lifecycle.test.ts`.
One folder per agent and scenario, one transcript per process the agent ran
(the thread's turns, title jobs, model probes). Each line is one line the CLI
read (`out`, from Relay) or wrote (`in`), with its time since the process
started.

## Recording again

After an agent CLI changes how it talks, record its scenarios again:

```sh
RELAY_RECORD=claude,codex npx vitest run -c tests/record/vitest.config.ts
node tests/record/redact.mjs /tmp/relay-replays-raw claude codex
npx vitest run tests/unit/replay-fixtures.test.ts electron/project-chats/turn-lifecycle.test.ts
```

- It spends a little real usage on cheap models.
- Every agent runs in a throwaway sample project with an empty config folder:
  only its sign-in comes along (Claude reads the usual Keychain item, Codex
  and OpenCode get a link to their `auth.json`), so no instructions, MCP
  servers or skills of yours end up in a transcript. What the account itself
  brings still does: Claude lists the claude.ai connectors and skills synced
  to it.
- `redact.mjs` turns paths, names, emails, keys, account ids and the account's
  plan, credit and computer name into placeholders, and drops what came from
  claude.ai; `tests/unit/replay-fixtures.test.ts` fails on anything it
  missed. Read a new transcript before committing it anyway.
