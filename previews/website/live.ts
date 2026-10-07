// What the page learns at runtime: the visitor's system, and the latest
// release and star count from GitHub's public API. Everything here degrades
// to nothing: a failed fetch leaves the page as it was built.
import { useEffect, useState } from "react";
import { REPO } from "./content";

export type Os = "mac" | "win" | "linux" | "android";

export const osName: Record<Os, string> = {
  mac: "macOS",
  win: "Windows",
  linux: "Linux",
  android: "Android",
};

/** The visitor's system, from the user agent; an iPhone counts as a Mac. */
export function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "win";
  if (/Linux|CrOS/i.test(ua)) return "linux";
  return "mac";
}

export function useOs(): Os | null {
  const [os, setOs] = useState<Os | null>(null);
  useEffect(() => setOs(detectOs()), []);
  return os;
}

export type Release = {
  version: string;
  publishedAt: string;
  /** The first line of the notes without its "TL;DR:" label. */
  summary: string;
  assets: Record<string, { size: number; downloads: number }>;
};

const RELEASES_API =
  "https://api.github.com/repos/lubomirmolin/relay-releases/releases/latest";
const REPO_API = REPO.replace(
  "https://github.com/",
  "https://api.github.com/repos/",
);

/** Fetches JSON once per half hour per tab; `null` when the request fails. */
async function cached<T>(key: string, url: string): Promise<T | null> {
  const stored = sessionStorage.getItem(key);
  if (stored) {
    const { at, value } = JSON.parse(stored) as { at: number; value: T | null };
    if (Date.now() - at < 30 * 60_000) return value;
  }
  let value: T | null = null;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (response.ok) value = (await response.json()) as T;
  } catch {
    // Offline, or the API is rate limited: the page keeps its built-in text.
  }
  sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  return value;
}

type ReleaseJson = {
  tag_name: string;
  published_at: string;
  body?: string;
  assets: { name: string; size: number; download_count: number }[];
};

export function useRelease(): Release | null {
  const [release, setRelease] = useState<Release | null>(null);
  useEffect(() => {
    let live = true;
    cached<ReleaseJson>("relay-site:release", RELEASES_API).then((json) => {
      if (!live || !json) return;
      const first =
        (json.body ?? "")
          .split("\n")
          .find((line) => line.trim())
          ?.trim() ?? "";
      setRelease({
        version: json.tag_name.replace(/^v/, ""),
        publishedAt: json.published_at,
        summary: first.replace(/^\**TL;DR:?\**\s*/i, ""),
        assets: Object.fromEntries(
          json.assets.map((asset) => [
            asset.name,
            { size: asset.size, downloads: asset.download_count },
          ]),
        ),
      });
    });
    return () => {
      live = false;
    };
  }, []);
  return release;
}

/** The repository's stars, or `null` while unknown or while the repo is private. */
export function useStars(): number | null {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    cached<{ stargazers_count: number }>("relay-site:repo", REPO_API).then(
      (json) => {
        if (live && json) setStars(json.stargazers_count);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return stars;
}

export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatCount(count: number): string {
  return count >= 1000
    ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`
    : String(count);
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "4 months ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "a year ago" : `${years} years ago`;
}
