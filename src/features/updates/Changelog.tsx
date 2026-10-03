import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../lib/api";
import { useUpdates } from "./updates";
import { newerVersion, type ReleaseNote } from "../../../shared/updates";
import { ErrorBox, IconButton, Loading, RichText } from "../../ui/ui";
import "./changelog.css";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const longDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Settings → About's changelog: every release down the side, its notes beside. */
export function Changelog() {
  const { state } = useUpdates();
  const current = state?.current;
  // A newly found release brings its notes with it.
  const offered = state?.status === "available" ? state.version : undefined;
  const releases = useQuery({
    queryKey: ["release-notes", offered],
    queryFn: () => api.releaseNotes(),
    staleTime: 10 * 60 * 1000,
  });
  const [picked, setPicked] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const notes = useRef<HTMLDivElement>(null);

  const all = releases.data ?? [];
  const index = Math.max(
    0,
    all.findIndex((r) => r.version === picked),
  );
  const selected = all[index] as ReleaseNote | undefined;

  useEffect(() => {
    notes.current?.scrollTo({ top: 0 });
    list.current
      ?.querySelector<HTMLElement>(`[data-version="${selected?.version}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected?.version]);

  if (releases.isPending) return <Loading text="Loading the changelog…" />;
  if (releases.isError)
    return (
      <ErrorBox error={releases.error} retry={() => void releases.refetch()} />
    );
  if (!selected)
    return <p className="setting-muted">No releases published yet.</p>;

  const step = (by: number) => {
    const next = all[index + by];
    if (next) setPicked(next.version);
  };
  const relation = !current
    ? undefined
    : selected.version === current
      ? "Installed"
      : newerVersion(selected.version, current)
        ? "Newer than yours"
        : undefined;

  return (
    <div className="changelog">
      <div
        ref={list}
        className="changelog-versions"
        role="listbox"
        aria-label="Versions"
        tabIndex={0}
        aria-activedescendant={`changelog-${selected.version}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            step(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {all.map((release) => {
          const isNew = !!current && newerVersion(release.version, current);
          const installed = release.version === current;
          return (
            <div
              key={release.version}
              id={`changelog-${release.version}`}
              data-version={release.version}
              role="option"
              aria-selected={release === selected}
              className="changelog-version"
              onClick={() => setPicked(release.version)}
            >
              <span className="changelog-dot" data-new={isNew || undefined} />
              <span className="changelog-number">{release.version}</span>
              <span className="changelog-date">
                {installed ? "Installed" : shortDate(release.published)}
              </span>
            </div>
          );
        })}
      </div>
      <article className="changelog-notes" aria-live="polite">
        <header>
          <div>
            <h5>Relay {selected.version}</h5>
            <p>
              {longDate(selected.published)}
              {relation && ` · ${relation}`}
            </p>
          </div>
          <div className="changelog-steps">
            <IconButton
              label="Newer version"
              disabled={index === 0}
              onClick={() => step(-1)}
            >
              <ChevronUp size={15} />
            </IconButton>
            <IconButton
              label="Older version"
              disabled={index === all.length - 1}
              onClick={() => step(1)}
            >
              <ChevronDown size={15} />
            </IconButton>
          </div>
        </header>
        <div ref={notes} className="changelog-body">
          {selected.notes ? (
            <RichText text={selected.notes} />
          ) : (
            <p className="setting-muted">No notes for this release.</p>
          )}
        </div>
      </article>
    </div>
  );
}
