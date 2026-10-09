import { chromium } from "playwright";
const [, , src, out, w = "1000"] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: 200 }, deviceScaleFactor: 2 });
await p.goto("file://" + src);
await p.screenshot({ path: out, fullPage: true });
await b.close();
