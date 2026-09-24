# T3 Code attribution

Source: https://github.com/pingdotgg/t3code
Pinned commit: 52e4b4429359904441039a286c61eaafe8474451

Vendored: StyledDiffCodeView.tsx, diffRendering.ts, diffCollapse.ts, gitPatchPath.ts. Import paths adapted. DiffWorkerPoolProvider and desktop titlebar options adapted from T3 Code. Worker count and caches reduced for single-file review.

Skill display names and source badges adapt providerSkills.ts and ComposerCommandMenu.tsx; atomic composer chips adapt ComposerSkillExtension from ComposerPromptEditorTiptap.tsx using Tiptap.

Composer command discovery follows T3 Code’s ChatComposer and CodexProvider skills/list integration; Relay adds local PR actions and mid-message $skill completion.

MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## jsonc-parser

Microsoft node-jsonc-parser 3.3.1, used to read project configuration with comments.
Source: https://github.com/microsoft/node-jsonc-parser

The MIT License (MIT)

Copyright (c) Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## T3 Code streaming

Relay's turn timeline also adapts `apps/web/src/components/chat/MessagesTimeline.tsx`
and `MessagesTimeline.logic.ts` at the pinned streaming commit. File-reference
parsing in `src/vendor/t3code/markdownLinks.ts` comes from
`packages/client-runtime/src/markdownLinks.ts` at that commit; only its shared
path-helper import is replaced locally. These are covered by the T3 MIT license
above. The app keeps private commentary and tool work out of shared messages.

The thread-first layout and composer proportions are also informed by ChatView.tsx and chat/ComposerSurface.tsx at the streaming commit below. Review Relay owns its presentation, persistence and collaboration components.

Thread titles adapt the provider-name event handling in `CodexAdapter.ts` and
`ProviderRuntimeIngestion.ts`, plus the separate fallback generation in
`ProviderCommandReactor.ts` and `TextGenerationPrompts.ts` at that commit.
Relay's prompt and title persistence are app-specific.

Screenshot paste follows the attachment flow in T3 Code's `ChatComposer.tsx`:
prepare a bounded image, retain it in the draft, and pass Codex a local image
path. Claude receives an image content block as in its provider adapter. Relay's
image storage, IPC validation, and sharing rules are app-specific.

Pristine upstream sources are listed with the exact commit and SHA-256 hashes in
`t3-streaming.lock.json`:

- `src/vendor/t3code/markdown-incremental.ts` — incremental Markdown parsing.
- `electron/vendor/t3code/codex/protocol.ts` — Codex JSON-RPC framing, correlation,
  ordering and lifecycle.
- `electron/vendor/t3code/codex/errors.ts` and `_internal/shared.ts` — protocol types.

Source: https://github.com/pingdotgg/t3code. MIT, copyright (c) 2026 T3 Tools Inc.
The complete upstream license is also retained at `electron/vendor/t3code/LICENSE`.
App-specific process spawning, permission policy, bounded output and persistence
live outside these files. See `docs/t3-streaming.md` for the update procedure.

## Effect

Effect 4.0.0-rc.115 — the runtime used by the pinned T3 streaming protocol.
Source: https://github.com/Effect-TS/effect

MIT License

Copyright (c) 2023 Effectful Technologies Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## T3 Code model picker

Model search ranking and provider SVGs are copied from T3 Code at
`b5a0f810108d42ca8635b5a3d75a6e885bb3a254`; the provider rail, model rows,
favorites and legacy section are adapted from its chat model-picker components.
See `src/vendor/t3code/model-picker/README.md` for paths and changes; the MIT
license above and the local LICENSE apply.

## T3 Code pull request picker

The searchable pull request popover in `src/components/ProjectPullPicker.tsx`
adapts the combobox interaction from T3 Code's
`BranchToolbarBranchSelector.tsx` and `pullRequest/PullRequestCandidatePicker.tsx`
at `b5a0f810108d42ca8635b5a3d75a6e885bb3a254`. The MIT license above
applies.

## T3 Code project headline picker

The inline project switcher in `src/components/ProjectHeadlinePicker.tsx`
adapts T3 Code's `chat/DraftHeroHeadline.tsx` at
`b5a0f810108d42ca8635b5a3d75a6e885bb3a254`. The MIT license above
applies.

## Base UI

Base UI 1.4.1, used for accessible model/reasoning popovers and keyboard navigation.
Source: https://github.com/mui/base-ui. MIT; full license follows.

The MIT License (MIT)

Copyright (c) 2019 Material-UI SAS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Branch picker interaction

The searchable branch picker follows T3 Code's `BranchToolbarBranchSelector.tsx` (local checkout at `52e4b4429359904441039a286c61eaafe8474451`): current/worktree/remote labels and a create-from-search action. Relay uses its existing Base UI components and a local Git backend. T3 Code's MIT license is included above.


## T3 Code interruption and follow-up interaction

Stop/resume and queued follow-up presentation follow `CodexSessionRuntime.ts`,
`queuedMessageStore.ts`, `chat/ComposerPrimaryActions.tsx` and `chat/MessagesTimeline.tsx` at the pinned commit above.
Relay owns its persisted FIFO queue, uses Codex `turn/interrupt` and `turn/steer`,
and pauses queued work after Stop or restart. The T3 MIT license above applies.

## Permission controls and planning

Relay’s runtime permission labels/descriptions, Build/Plan toggle, Codex sandbox/reviewer mapping, approval action arrangement, and numbered question choices are adapted from T3 Code at the pinned reference revision (MIT license above): `runtimeModeConfig.ts`, `ChatComposer.tsx` (`ComposerFooterModeControls`), `ComposerPendingApprovalActions.tsx`, `ComposerPendingUserInputPanel.tsx`, `CodexSessionRuntime.ts` and `ClaudeAdapter.ts`. Relay supplies its own persistence, request validation, local-only approval broker and styles.

## Anthropic Claude Agent SDK

`@anthropic-ai/claude-agent-sdk` version 0.3.276 is used for Claude project sessions.

© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.

Package source and documentation: https://github.com/anthropics/claude-agent-sdk-typescript. This dependency is not covered by T3 Code’s MIT license.

## OpenUsage

Claude and Codex session/weekly limits in the model picker adapt OpenUsage’s usage-window mapping and burn-rate pacing. Claude's limits come from Claude Code itself through the Agent SDK; for Codex, Relay reads the local CLI sign-in and calls the usage API. The OpenUsage application is not required.

Source: https://github.com/robinebers/openusage

MIT License

Copyright (c) 2026 Robin Ebers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
