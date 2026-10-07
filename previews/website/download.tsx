// The website's download page: each build of the current release, what to do
// at the first start, and the ways around a package (all releases, source).
// Open http://127.0.0.1:5177/previews/website/download/
import { StrictMode, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownToLine, ArrowUpRight, Sparkles } from "lucide-react";
import "../../src/styles.css";
import "./website.css";
import {
  applyToDocument,
  resolveChoice,
  type ThemeChoice,
} from "../../src/lib/themes";
import { Command, GitHubMark, SiteFooter, SiteHeader } from "./parts";
import {
  BUILD_GUIDE,
  firstStart,
  otherBuilds,
  platforms,
  RELEASES,
  releaseNotes,
  REPO,
  steps,
  VERSION,
} from "./content";
import {
  formatBytes,
  osName,
  timeAgo,
  useOs,
  useRelease,
  type Os,
  type Release,
} from "./live";

applyToDocument(resolveChoice("dark", { theme: "relay" } as ThemeChoice));

type Build = (typeof platforms)[number];

function Files({
  builds,
  os,
  release,
}: {
  builds: Build[];
  os: Os | null;
  release: Release | null;
}) {
  return (
    <div className="files">
      {builds.map((build, index) => {
        const asset = release?.assets[build.file];
        const yours = build.os !== undefined && build.os === os;
        return (
          <a
            key={build.system}
            href={build.href}
            data-yours={yours || undefined}
            style={{ "--i": index } as CSSProperties}
          >
            <strong>
              {build.system}
              {yours ? <em>Your system</em> : null}
            </strong>
            <code>{build.file}</code>
            <span>{build.status}</span>
            <small>{asset ? formatBytes(asset.size) : ""}</small>
            {build.href.includes("/releases/") ? (
              <ArrowDownToLine size={14} />
            ) : (
              <ArrowUpRight size={14} />
            )}
          </a>
        );
      })}
    </div>
  );
}

function DownloadPage() {
  const os = useOs();
  const release = useRelease();
  // The page is built for one version; live data for another would mislabel its files.
  const live = release?.version === VERSION ? release : null;
  const yours = platforms.find((p) => p.os === os);
  const size = yours && live?.assets[yours.file];
  return (
    <div className="site">
      <SiteHeader home="../" />

      <main id="main">
        <section className="centered dl-head">
          <span className="eyebrow">
            Version {VERSION}
            {live ? ` · released ${timeAgo(live.publishedAt)}` : ""}
          </span>
          <h1>Download Relay</h1>
          <p>
            Relay is free and open source. Select the build for your system.
          </p>
          <div className="hero-actions">
            {yours ? (
              <a className="cta" href={yours.href}>
                Download for {osName[yours.os!]}
                {size ? <small>{formatBytes(size.size)}</small> : null}
                <ArrowDownToLine size={15} />
              </a>
            ) : null}
            <a className="cta ghost" href={releaseNotes}>
              Release notes
              <ArrowUpRight size={15} />
            </a>
            <a className="cta ghost" href={REPO}>
              <GitHubMark />
              Source code
            </a>
          </div>
          {live?.summary ? (
            <a className="whats-new" href={releaseNotes}>
              <Sparkles size={14} />
              <span>
                <b>New in {live.version}:</b> {live.summary}
              </span>
            </a>
          ) : null}
        </section>

        <section className="centered dl-list">
          <h2>Desktop</h2>
          <Files builds={platforms} os={os} release={live} />
          <h2>Phone and other Macs</h2>
          <Files builds={otherBuilds} os={os} release={live} />
        </section>

        <section className="block dl-after">
          <div>
            <span className="eyebrow">First start</span>
            <h2>The builds have no code signature yet</h2>
            <p className="lede">
              The first start needs one more click. Later starts and updates
              need nothing.
            </p>
            <div className="promises">
              {firstStart.map((item) => (
                <div key={item.system}>
                  <h3>{item.system}</h3>
                  <p>{item.text}</p>
                  {item.command ? <Command text={item.command} /> : null}
                </div>
              ))}
            </div>
          </div>
          <div>
            <span className="eyebrow">Then</span>
            <h2>Start your first thread</h2>
            <ol className="dl-steps">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="block dl-more">
          <a href={RELEASES}>
            <h3>All releases</h3>
            <p>
              Earlier versions and the notes for each release are on GitHub.
            </p>
          </a>
          <a href={BUILD_GUIDE}>
            <h3>Build from source</h3>
            <p>
              Clone the repository, then run npm ci and npm run dev. You need
              Node.js 22.
            </p>
          </a>
        </section>
      </main>

      <SiteFooter home="../" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DownloadPage />
  </StrictMode>,
);
