import { createHash } from "node:crypto";
import { roomProtocol } from "../shared/rooms";

const style = `:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f4f6;color:#242429}body{margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(440px,calc(100% - 64px));padding:48px 0} .icon{font-size:32px;color:#7772ad}h1{font-size:32px;letter-spacing:-1px;margin:24px 0 12px}p{line-height:1.65;color:#777782}a{display:block;padding:14px 20px;background:#7772ad;color:white;text-align:center;text-decoration:none;border-radius:12px;font-weight:600;margin:30px 0 18px}a[hidden]{display:none}small{display:block;color:#777782;line-height:1.6}footer{margin-top:48px;font-size:12px;color:#9999a2}@media(prefers-color-scheme:dark){:root{background:#202024;color:#eeeef2}}`;
const script = `const button=document.querySelector('a'),status=document.querySelector('#status');
const params=new URLSearchParams(location.hash.slice(1));
if (/^[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}$/i.test(params.get('join')||'')) {
 const server=location.origin+location.pathname.replace(/\\/$/,'');
 button.href='${roomProtocol}://join?server='+encodeURIComponent(server)+location.hash;
 button.hidden=false;
 status.textContent='Opening your project invitation. If your browser asks, choose Open Review Relay.';
 location.href=button.href;
} else if(location.hash) status.textContent='This invitation link is incomplete. Ask your colleague for a new link.';`;
const hash = (text: string) =>
  createHash("sha256").update(text).digest("base64");
export const landingPolicy = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;
export const landingHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Review together · Review Relay</title><style>${style}</style></head><body><main><div class="icon" aria-hidden="true">↗</div><h1>Review it together.</h1><p id="status">Open a project invitation from your colleague to join the conversation beside the code.</p><a hidden>Open Review Relay</a><small>Use the current Review Relay Experimental app for macOS or Linux. If it isn’t installed yet, install it and open this invitation again.</small><footer>Your own Gitea login. Your own agent. One shared conversation.</footer></main><script>${script}</script></body></html>`;
