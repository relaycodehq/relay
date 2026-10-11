// The website's compare page: what only Relay does, Relay beside each other
// app, and where the others are ahead. The words live in compare-data.ts.
// Open http://127.0.0.1:5177/previews/website/compare/
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownToLine } from "lucide-react";
import "../../src/styles.css";
import "./website.css";
import { initSiteTheme } from "./theme";
import { SiteFooter, SiteHeader } from "./parts";
import { CompareTable } from "./compare-table";
import { ahead, only } from "./compare-data";

initSiteTheme();

function ComparePage() {
  return (
    <div className="site">
      <SiteHeader home="../" />

      <main id="main">
        <section className="centered cmp-head">
          <span className="eyebrow">How Relay compares</span>
          <h1>Relay and the other agent apps</h1>
          <p>
            Most of them run agents in worktrees and show you the diff. They
            differ in who you pay, where the agents run and what sits between
            you and your phone.
          </p>
          <div className="hero-actions">
            <a className="cta" href="../download/">
              Download Relay
              <ArrowDownToLine size={15} />
            </a>
            <a className="cta ghost" href="#table">
              See the table
            </a>
          </div>
        </section>

        <section className="block cmp-only">
          <span className="eyebrow">Only in Relay</span>
          <h2>What you get nowhere else, together</h2>
          <div className="promises">
            {only.map((item) => (
              <div key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="wide cmp-section" id="table">
          <CompareTable linked />
        </section>

        <section className="block cmp-ahead">
          <span className="eyebrow">Where others are ahead</span>
          <h2>What Relay doesn't do</h2>
          <p className="lede">
            If one of these matters most to you, one of the others may suit you
            better.
          </p>
          <div className="promises">
            {ahead.map((item) => (
              <div key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter home="../" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ComparePage />
  </StrictMode>,
);
