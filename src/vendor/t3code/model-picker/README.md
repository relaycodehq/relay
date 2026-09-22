# T3 Code model picker sources

From https://github.com/pingdotgg/t3code at `b5a0f810108d42ca8635b5a3d75a6e885bb3a254` (MIT).

- `searchRanking.ts`: unchanged `packages/shared/src/searchRanking.ts`.
- `modelPickerSearch.ts`: `apps/web/src/components/chat/modelPickerSearch.ts`, with its import redirected locally.
- `ProviderIcons.tsx`: OpenAI/ClaudeAI components extracted from `apps/web/src/components/Icons.tsx`, with Tailwind fill classes replaced by SVG fill attributes.

Relay's `ComposerModelPicker.tsx` adapts the provider rail, rows, favorites and legacy section from `ProviderModelPicker`, `ModelPickerContent`, `ModelPickerSidebar` and `ModelListRow`. It uses the same Base UI primitives, with Relay's existing provider/model state and plain CSS. Streaming vendor files are unchanged.
