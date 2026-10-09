import { expect, it, vi } from "vitest";
import type { ModelChoice, ReasoningEffort } from "../../../shared/settings";
import type { AcpConnection } from "./connection";
import type { AcpSettings } from "./sessions";
import { applySettings, modelsOf } from "./settings";

const select = (id: string, category: string, currentValue: string, values: string[]) => ({
  id,
  category,
  type: "select",
  currentValue,
  options: values.map((value) => ({ value, name: value.toUpperCase() })),
});

/** A connection that records requests and answers set_config_option with no options. */
function recording() {
  const request = vi.fn(async (..._: unknown[]): Promise<unknown> => ({}));
  return { connection: { request } as unknown as AcpConnection, request };
}
const choice = (model = "", reasoningEffort: ReasoningEffort | "" = ""): ModelChoice => ({
  model,
  reasoningEffort,
  fast: false,
});

it("goes back to the session's own model and effort when Default is picked again", async () => {
  const { connection, request } = recording();
  const session = {
    id: "s",
    settings: {
      configOptions: [
        select("model", "model", "pro", ["pro", "flash"]),
        select("effort", "thought_level", "medium", ["low", "medium", "high"]),
      ],
    } as AcpSettings,
  };

  await applySettings(connection, session, [], choice("flash", "high"));
  await applySettings(connection, session, [], choice());

  expect(request.mock.calls.map((c) => (c[1] as { value: string }).value)).toEqual([
    "flash",
    "high",
    "pro",
    "medium",
  ]);
});

it("does the same through the older model list and mode list some agents still send", async () => {
  const { connection, request } = recording();
  const session = {
    id: "s",
    settings: {
      modes: {
        currentModeId: "default",
        availableModes: [{ id: "default" }, { id: "yolo" }],
      },
      models: {
        currentModelId: "auto",
        availableModels: [{ modelId: "auto" }, { modelId: "flash" }],
      },
    } as AcpSettings,
  };

  await applySettings(connection, session, [{ option: "mode", value: "yolo" }], choice("flash"));
  await applySettings(connection, session, [{ option: "mode", value: "nonsense" }], choice());

  expect(request.mock.calls).toEqual([
    ["session/set_mode", { sessionId: "s", modeId: "yolo" }],
    ["session/set_model", { sessionId: "s", modelId: "flash" }],
    ["session/set_model", { sessionId: "s", modelId: "auto" }],
  ]);
});

it("offers efforts only when every level is one Relay knows", () => {
  const known = modelsOf({
    configOptions: [
      select("model", "model", "a", ["a"]),
      select("effort", "thought_level", "low", ["low", "high"]),
    ],
  } as AcpSettings);
  const odd = modelsOf({
    configOptions: [
      select("model", "model", "a", ["a"]),
      select("effort", "thought_level", "low", ["low", "turbo"]),
    ],
  } as AcpSettings);

  expect(known[0]).toMatchObject({ id: "a", name: "A", efforts: ["low", "high"] });
  expect(odd[0].efforts).toEqual([]);
});

it("takes the first of a wish's names the agent offers, as config option or mode", async () => {
  const wish = [{ option: "mode", value: ["acceptEdits", "auto_edit", "default"] }];
  const asOption = recording();
  await applySettings(
    asOption.connection,
    {
      id: "s",
      settings: {
        configOptions: [select("mode", "mode", "default", ["default", "auto_edit", "yolo"])],
      } as AcpSettings,
    },
    wish,
    choice(),
  );
  expect((asOption.request.mock.calls[0][1] as { value: string }).value).toBe("auto_edit");

  const asMode = recording();
  await applySettings(
    asMode.connection,
    {
      id: "s",
      settings: {
        modes: { currentModeId: "plan", availableModes: [{ id: "plan" }, { id: "default" }] },
      } as AcpSettings,
    },
    wish,
    choice(),
  );
  expect(asMode.request.mock.calls).toEqual([
    ["session/set_mode", { sessionId: "s", modeId: "default" }],
  ]);
});
