import { useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Moon,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type {
  ThemeExtension,
  ThemeSearchPage,
  VsCodeTheme,
} from "../../shared/open-vsx";
import { api } from "../lib/api";
import { setMode, setThemeChoice, useAppearance } from "../lib/appearance";
import {
  extensionKey,
  installExtension,
  removeExtension,
  themeIds,
  useImportedExtensions,
  type ImportedExtension,
} from "../lib/imported-themes";
import { kindOf } from "../lib/vscode-theme";
import { themeById, type ThemeKind } from "../lib/themes";
import { SettingsCard, SettingsFooter, SettingsRow } from "./SettingsCard";
import { ErrorBox, IconButton, Spinner } from "./ui";

const downloads = new Intl.NumberFormat("en", { notation: "compact" });

/** The themes an extension brings, each marked with its mode. */
function Variants({
  themes,
}: {
  themes: Pick<VsCodeTheme, "label" | "uiTheme">[];
}) {
  return (
    <span className="theme-import-variants">
      {themes.map((theme) => (
        <span key={theme.label}>
          {kindOf(theme) === "light" ? <Sun size={11} /> : <Moon size={11} />}
          {theme.label}
        </span>
      ))}
    </span>
  );
}

/**
 * One line per installed extension, its themes as swatches: the theme's
 * background with its accent in the middle. Clicking one switches to it; the
 * caption names whichever swatch is under the pointer.
 */
function InstalledThemes({
  installed,
  inUse,
  onUse,
  onRemove,
}: {
  installed: ImportedExtension[];
  inUse: (id: string) => boolean;
  onUse: (id: string, kind: ThemeKind) => void;
  onRemove: (extension: ImportedExtension) => void;
}) {
  const [hovered, setHovered] = useState<string>();
  const swatches = installed.flatMap((extension) => {
    const ids = themeIds(extension);
    return extension.themes.map((theme, i) => ({
      id: ids[i],
      extension,
      label: theme.label,
      kind: kindOf(theme),
    }));
  });
  const used = swatches.filter((s) => inUse(s.id));
  return (
    <SettingsCard>
      {installed.map((extension) => (
        <div key={extensionKey(extension)} className="theme-import-installed">
          <strong>{extension.displayName}</strong>
          <small>{extension.namespace}</small>
          <span
            className="theme-import-swatches"
            onMouseLeave={() => setHovered(undefined)}
          >
            {swatches
              .filter((s) => s.extension === extension)
              .map(({ id, label, kind }) => {
                const palette = themeById(id)[kind]!;
                const selected = inUse(id);
                return (
                  <button
                    key={id}
                    className={`theme-import-swatch ${selected ? "selected" : ""}`}
                    title={label}
                    aria-label={`Use ${label}`}
                    aria-pressed={selected}
                    onMouseEnter={() => setHovered(label)}
                    onFocus={() => setHovered(label)}
                    onBlur={() => setHovered(undefined)}
                    onClick={() => onUse(id, kind)}
                    style={{
                      background: `radial-gradient(circle, ${palette.accent} 0 3px, ${palette.surface} 3.5px)`,
                    }}
                  />
                );
              })}
          </span>
          <IconButton
            label={`Remove ${extension.displayName}`}
            onClick={() => onRemove(extension)}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <p className="theme-import-caption">
        {hovered ??
          (used.length
            ? `Using ${used.map((s) => s.label).join(" and ")}.`
            : "Click a swatch to use that theme.")}
      </p>
    </SettingsCard>
  );
}

/**
 * Search Open VSX for VS Code colour themes and install them. An installed
 * extension's themes join the light and dark theme lists; installing one
 * switches to it straight away, the way VS Code offers to.
 */
export function ThemeImportSettings() {
  const installed = useImportedExtensions();
  const appearance = useAppearance();
  const [tab, setTab] = useState<"browse" | "installed">(() =>
    installed.length ? "installed" : "browse",
  );
  const browsing = tab === "browse" || !installed.length;
  const [query, setQuery] = useState("");
  // Where each page seen so far starts, so Previous goes back exactly.
  const [starts, setStarts] = useState([0]);
  const [page, setPage] = useState<ThemeSearchPage>();
  const [searching, setSearching] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();

  const start = starts[starts.length - 1];
  useEffect(() => {
    // Open VSX is only asked once someone browses.
    if (!browsing) return;
    let current = true;
    setSearching(true);
    // Typing waits for a pause; turning a page doesn't.
    const timer = setTimeout(
      () =>
        api.searchThemes(query, start).then(
          (found) => {
            if (!current) return;
            setPage(found);
            setError(undefined);
            setSearching(false);
          },
          (reason) => {
            if (!current) return;
            setError(reason);
            setSearching(false);
          },
        ),
      start ? 0 : 350,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [browsing, query, start, attempt]);
  const search = (text: string) => {
    setQuery(text);
    setStarts([0]);
  };

  const use = (id: string, kind: ThemeKind) => {
    setThemeChoice(kind, {
      theme: id,
      accent: undefined,
      background: undefined,
      foreground: undefined,
    });
    if (kind !== appearance.palette.kind && appearance.value.mode !== "system")
      setMode(kind);
  };
  const inUse = (id: string) =>
    appearance.value.light.theme === id || appearance.value.dark.theme === id;

  const install = async (extension: ThemeExtension) => {
    const key = extensionKey(extension);
    setBusy(key);
    setError(undefined);
    try {
      const themes = await api.fetchThemes(extension);
      installExtension(extension, themes);
      // The theme for the mode on screen, if the extension has one.
      const ids = themeIds({ ...extension, themes });
      const kinds = themes.map(kindOf);
      const at = Math.max(0, kinds.indexOf(appearance.palette.kind));
      use(ids[at], kinds[at]);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(undefined);
    }
  };

  const remove = (extension: ImportedExtension) => {
    const ids = themeIds(extension);
    removeExtension(extensionKey(extension));
    for (const kind of ["light", "dark"] as const)
      if (ids.includes(appearance.value[kind].theme))
        setThemeChoice(kind, {
          theme: "relay",
          accent: undefined,
          background: undefined,
          foreground: undefined,
        });
  };

  const byKey = new Map(installed.map((e) => [extensionKey(e), e]));
  return (
    <div className="theme-import">
      {installed.length > 0 && (
        <div
          className="segmented settings-segmented theme-import-tabs"
          role="tablist"
          aria-label="VS Code themes"
        >
          {(
            [
              ["browse", "Browse Open VSX"],
              ["installed", `Installed · ${installed.length}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={(value === "browse") === browsing}
              className={(value === "browse") === browsing ? "active" : ""}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!browsing && (
        <InstalledThemes
          installed={installed}
          inUse={inUse}
          onUse={use}
          onRemove={remove}
        />
      )}
      {browsing && (
        <>
          <div className="settings-search">
            <Search size={14} />
            <input
              aria-label="Search VS Code themes"
              placeholder="Search VS Code themes on Open VSX"
              value={query}
              onChange={(e) => search(e.target.value)}
            />
            {searching ? (
              <Spinner size={12} />
            ) : (
              query && (
                <button aria-label="Clear search" onClick={() => search("")}>
                  <X size={12} />
                </button>
              )
            )}
          </div>
          {!!error && (
            <ErrorBox error={error} retry={() => setAttempt((n) => n + 1)} />
          )}
          {page && (
            <SettingsCard className={searching ? "theme-import-loading" : ""}>
              {page.extensions.length === 0 && (
                <SettingsRow
                  label="No colour themes found"
                  hint="Open VSX has no theme extension matching that."
                />
              )}
              {page.extensions.map((extension: ThemeExtension) => {
                const key = extensionKey(extension);
                const have = byKey.get(key);
                const current = have?.version === extension.version;
                return (
                  <SettingsRow
                    key={key}
                    label={extension.displayName}
                    hint={
                      <>
                        {extension.namespace} ·{" "}
                        {downloads.format(extension.downloads)} downloads
                        {extension.description && (
                          <span className="theme-import-description">
                            {extension.description}
                          </span>
                        )}
                        <Variants themes={extension.themes} />
                      </>
                    }
                  >
                    {busy === key ? (
                      <span className="setting-muted theme-import-status">
                        <Spinner size={12} steady />
                        Installing…
                      </span>
                    ) : current ? (
                      <span className="setting-muted theme-import-status">
                        <Check size={13} />
                        Installed
                      </span>
                    ) : (
                      <button
                        disabled={!!busy}
                        onClick={() => void install(extension)}
                      >
                        {have ? "Update" : "Install"}
                      </button>
                    )}
                  </SettingsRow>
                );
              })}
              {(starts.length > 1 || page.next !== null) && (
                <SettingsFooter note={`Page ${starts.length}`}>
                  <button
                    disabled={searching || starts.length === 1}
                    onClick={() => setStarts(starts.slice(0, -1))}
                  >
                    <ChevronLeft size={13} />
                    Previous
                  </button>
                  <button
                    disabled={searching || page.next === null}
                    onClick={() => setStarts([...starts, page.next!])}
                  >
                    Next
                    <ChevronRight size={13} />
                  </button>
                </SettingsFooter>
              )}
            </SettingsCard>
          )}
        </>
      )}
    </div>
  );
}
