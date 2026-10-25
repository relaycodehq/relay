import type { RefObject } from "react";
import { Toolbar } from "@base-ui/react/toolbar";
import { ArrowDown, Star } from "lucide-react";
import type { AgentProvider } from "../../../shared/agents";
import { ProviderIcon } from "./ComposerModelPicker";
import { providerName, type Category } from "./model-picker-catalog";

/** A rail tab's name; its tooltip also says when its agent isn't installed. */
function tabName(tab: Category, missing: boolean) {
  if (tab === "favorites") return { label: "Favorites", title: "Favorites" };
  if (tab === "message")
    return { label: "Message only", title: "Message only · no agent" };
  const name = providerName(tab);
  return { label: name, title: missing ? `${name} · not installed` : name };
}

/** The model picker's side rail: one tab per agent, and Favorites and Message only where offered. */
export function ModelPickerRail({
  tabs,
  category,
  missing,
  searching,
  search,
  onPick,
}: {
  tabs: readonly Category[];
  category: Category;
  /** The agent isn't installed where the project runs. */
  missing: (agent: AgentProvider) => boolean;
  /** A search looks through every agent, so the rail steps aside. */
  searching: boolean;
  search: RefObject<HTMLInputElement | null>;
  onPick: (tab: Category) => void;
}) {
  return (
    <Toolbar.Root
      className="model-picker-rail"
      orientation="vertical"
      aria-label="Model providers"
      inert={searching}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          search.current?.focus();
        }
      }}
    >
      {tabs.map((tab) => {
        const notInstalled =
          tab !== "favorites" && tab !== "message" && missing(tab);
        const { label, title } = tabName(tab, notInstalled);
        return (
          <Toolbar.Button
            type="button"
            key={tab}
            aria-label={label}
            title={title}
            className="model-provider-tab"
            aria-pressed={category === tab}
            data-missing={notInstalled ? "" : undefined}
            onClick={() => onPick(tab)}
          >
            {tab === "favorites" ? (
              <Star className="provider-glyph" fill="currentColor" />
            ) : (
              <ProviderIcon provider={tab} />
            )}
            {notInstalled && (
              <ArrowDown
                className="model-provider-missing"
                size={9}
                strokeWidth={3}
                aria-hidden
              />
            )}
          </Toolbar.Button>
        );
      })}
    </Toolbar.Root>
  );
}
