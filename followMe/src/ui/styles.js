'use strict';
/*
 * followMe's styles, one string per layer. BASE_CSS (colours, buttons, fields) goes
 * into every layer; light and dark follow the system.
 */

const BASE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.fm {
  --bg: #ffffff; --bg2: #f4f6f9; --fg: #1d232b; --muted: #6a7480; --line: #dfe4ea;
  --accent: #e8590c; --accent-fg: #fff; --accent-soft: #fff0e6; --ok: #2f9e44; --bad: #e03131;
  --mark: #e8590c; --shadow: 0 10px 30px rgba(0,0,0,.18);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .fm { --bg: #1b1f24; --bg2: #23282f; --fg: #e6e9ee; --muted: #9aa4b0; --line: #343b44;
    --accent: #ff8a3d; --accent-fg: #1b1f24; --accent-soft: #3a2a1e; --shadow: 0 10px 30px rgba(0,0,0,.5); }
}
button { font: inherit; color: inherit; cursor: pointer; }
.btn { border: 1px solid var(--line); background: var(--bg); border-radius: 7px; padding: 5px 10px; }
.btn:hover { background: var(--bg2); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
.btn.danger { color: var(--bad); }
.btn.ghost { border-color: transparent; background: transparent; }
.btn.small { padding: 2px 7px; font-size: 12px; }
.btn:disabled { opacity: .45; cursor: default; }
input, select { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 7px; min-width: 0; }
input[type=number] { width: 62px; }
input.secs { width: 58px; }
input[type=checkbox] { width: auto; accent-color: var(--accent); }
.muted { color: var(--muted); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.grow { flex: 1; }
.badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px;
  border-radius: 11px; background: var(--mark); color: #fff; font-weight: 700; font-size: 12px; }
`;

const PANEL_CSS = `
.panel { position: fixed; top: 0; bottom: 0; width: 370px; max-width: 100vw; background: var(--bg); border-left: 1px solid var(--line);
  box-shadow: var(--shadow); display: flex; flex-direction: column; }
.panel.right { right: 0; } .panel.left { left: 0; border-left: 0; border-right: 1px solid var(--line); }
/* A phone-sized window (or a tab shown as a phone): the panel becomes a sheet at the bottom. */
@media (max-width: 600px) {
  .panel, .panel.left, .panel.right { left: 0; right: 0; top: auto; width: auto; height: 55vh; border: 0; border-top: 1px solid var(--line); border-radius: 12px 12px 0 0; }
}
.unsaved { margin-left: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); }
.note { padding: 6px 8px; border-radius: 6px; background: var(--bg2); } .note.bad { color: var(--bad); }
.howto { margin: 0; padding-left: 18px; } .howto a { color: var(--accent); }
a.btn { text-decoration: none; color: inherit; display: inline-block; }
/* In Chrome's side panel: fill it (and never become the phone-width bottom sheet). */
.panel.in-side, .panel.in-side.left, .panel.in-side.right { position: fixed !important; inset: 0 !important; width: auto !important;
  height: auto !important; max-width: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
.net { border: 0; background: transparent; font-size: 11px; color: var(--muted); padding: 2px 4px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.net::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.net.on::before { background: var(--ok); } .net.off { color: var(--bad); } .net.off::before { background: var(--bad); }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.logo { font-weight: 800; letter-spacing: -.02em; font-size: 15px; } .logo b { color: var(--accent); }
.site { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.foot { border-top: 1px solid var(--line); padding: 8px 12px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.status { padding: 8px 12px; border-top: 1px solid var(--line); background: var(--accent-soft); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.status.done { background: var(--bg2); } .status.failed { background: #ffe3e3; color: #a51d1d; }
@media (prefers-color-scheme: dark) { .status.failed { background: #3b1e1e; color: #ffb3b3; } }
.status .text { flex: 1; }
.status[hidden] { display: none; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: var(--bg); }
.card.clickable { cursor: pointer; } .card.clickable:hover { border-color: var(--accent); }
.card h3 { margin: 0; font-size: 14px; }
.empty { text-align: center; color: var(--muted); padding: 24px 8px; }
.empty b { color: var(--fg); }
.name { font-weight: 600; font-size: 15px; border-color: transparent; width: 100%; padding: 3px 6px; }
.name:hover, .name:focus { border-color: var(--line); }
.steps { display: flex; flex-direction: column; gap: 8px; }
.step { border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
.step.current { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.step.off { opacity: .55; }
.step-head { display: flex; gap: 8px; align-items: center; padding: 8px 10px; cursor: pointer; }
.step-head .what { flex: 1; min-width: 0; }
.step-head .title { font-weight: 600; }
.step-head .desc { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-body { border-top: 1px solid var(--line); padding: 10px; display: flex; flex-direction: column; gap: 10px; background: var(--bg2); border-radius: 0 0 10px 10px; }
.section > .label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; margin-bottom: 4px; }
.screen { position: relative; width: 120px; height: 76px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); flex: none; }
.screen.tiny { width: 40px; height: 26px; border-radius: 3px; }
.screen .dot { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--mark); }
.screen.tiny .dot { width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; }
.check { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px 8px; border: 1px dashed var(--line); border-radius: 8px; background: var(--bg); }
.check .kind { font-weight: 600; flex: 1; min-width: 120px; }
.how { font-size: 12px; color: var(--muted); }
.hits { font-size: 12px; } .hits code { font: 12px ui-monospace, monospace; background: var(--bg); padding: 1px 4px; border-radius: 4px; }
.flow { color: var(--muted); font-size: 12px; text-align: center; }
textarea { font: 12px ui-monospace, monospace; width: 100%; min-height: 160px; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
`;

const TAB_CSS = `
.tab { position: fixed; width: 30px; height: 64px; background: var(--accent); color: var(--accent-fg); border: 0; box-shadow: var(--shadow);
  font-weight: 800; font-size: 12px; writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center; opacity: .85; }
.tab:hover { opacity: 1; }
.tab.right { right: 0; border-radius: 10px 0 0 10px; } .tab.left { left: 0; border-radius: 0 10px 10px 0; }
.tab.running { animation: fm-pulse 1s infinite; }
@keyframes fm-pulse { 50% { opacity: .5; } }
`;

const MARKS_CSS = `
.marks { position: fixed; inset: 0; pointer-events: none; }
.marks svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.marks line { stroke: var(--mark); stroke-width: 2; stroke-dasharray: 5 5; opacity: .6; }
.mark { position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; pointer-events: auto; cursor: grab;
  background: rgba(232, 89, 12, .22); border: 2px solid var(--mark); display: flex; align-items: center; justify-content: center;
  color: #fff; font: 700 12px system-ui, sans-serif; text-shadow: 0 0 3px #000, 0 0 2px #000; user-select: none; touch-action: none; }
.mark::after { content: ""; position: absolute; width: 4px; height: 4px; border-radius: 50%; background: var(--mark); left: 11px; top: 11px; }
.mark span { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); background: var(--mark); border-radius: 9px; padding: 0 6px;
  font-size: 11px; line-height: 16px; text-shadow: none; white-space: nowrap; }
.mark.selected { border-width: 3px; background: rgba(232, 89, 12, .38); }
.mark.active { animation: fm-ping .8s infinite; }
.mark.off { opacity: .35; }
.mark.dragging { cursor: grabbing; }
@keyframes fm-ping { 0% { box-shadow: 0 0 0 0 rgba(232, 89, 12, .7); } 100% { box-shadow: 0 0 0 16px rgba(232, 89, 12, 0); } }
`;

const PICKER_CSS = `
.picker { position: fixed; inset: 0; cursor: crosshair; background: rgba(0, 0, 0, .04); }
.hline, .vline { position: absolute; background: var(--mark); opacity: .6; pointer-events: none; }
.hline { left: 0; right: 0; height: 1px; } .vline { top: 0; bottom: 0; width: 1px; }
.info { position: absolute; pointer-events: none; background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: var(--shadow);
  border-radius: 8px; padding: 6px 9px; font-size: 12px; max-width: 320px; }
.info b { color: var(--accent); }
.banner { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); border-radius: 20px;
  padding: 7px 14px; font-weight: 600; pointer-events: none; box-shadow: var(--shadow); }
`;
