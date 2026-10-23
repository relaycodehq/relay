export const annotationStyle = `
:host { all: initial; position: fixed; inset: 0; margin: 0; padding: 0; border: 0; width: 100%; height: 100%; background: transparent; overflow: visible; pointer-events: auto; z-index: 2147483647; color-scheme: dark; font: 14px/1.4 system-ui, sans-serif; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.outline { position: fixed; border: 2px solid #667cff; background: #667cff0a; pointer-events: none; }
.details { position: fixed; width: max-content; max-width: calc(100vw - 24px); padding: 10px 14px; border-radius: 14px; background: #202331f5; color: #f5f5f8; box-shadow: 0 6px 20px #0003; font: 13px/1.6 ui-monospace, monospace; }
.details div { display: flex; justify-content: space-between; gap: 24px; }
.details span:first-child { color: #b8b9c5; }
.details b { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.details .tag { color: #f5f5f8; }
.editor { position: fixed; display: flex; align-items: center; gap: 8px; width: 360px; max-width: calc(100vw - 24px); padding: 8px; border: 1px solid #ffffff20; border-radius: 27px; background: #2d2d30; color: #fff; box-shadow: 0 8px 28px #0003; pointer-events: auto; }
textarea { all: unset; display: block; box-sizing: border-box; flex: 1; min-width: 0; height: 24px; max-height: 120px; margin: 4px 2px 4px 8px; overflow-y: auto; color: #fff; caret-color: #fff; font: 14px/24px system-ui, sans-serif; resize: none; }
.editor:focus-within { border-color: #a0adff80; }
textarea:focus-visible { outline: none; }
textarea::placeholder { color: #b9b9bf; }
button { all: unset; box-sizing: border-box; display: grid; place-items: center; flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%; color: #d9d9df; cursor: pointer; font: 18px/1 system-ui, sans-serif; pointer-events: auto; }
button:hover { background: #ffffff15; }
button:focus-visible { outline: 2px solid #8ea5ff; outline-offset: 3px; }
.save { background: #fff; color: #202024; }
.save:hover { background: #e7e7ee; }
.save:disabled { opacity: .4; cursor: default; }
.pin { position: fixed; width: 30px; height: 30px; border: 2px solid #fff; border-radius: 50% 50% 50% 5px; background: #6398f4; color: #fff; font-size: 12px; box-shadow: 0 2px 8px #0003; }
.pin:hover { background: #507fe8; }
.status { position: fixed; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 12px; padding: 7px 8px 7px 13px; border: 1px solid #ffffff20; border-radius: 24px; background: #25252bf5; color: #e9e9ee; font: 12px/1.4 system-ui, sans-serif; pointer-events: auto; }
.status button { width: auto; height: 28px; padding: 0 10px; border-radius: 14px; font-size: 12px; background: #ffffff15; }
`;
