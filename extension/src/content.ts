import { SYNC_POLL_MS } from "../../partysync/src/sync/playback.ts";
import type { HostCommand, HostView } from "./messages.ts";
import { readVideoSample, watchVideoId } from "./youtube.ts";

if (!document.getElementById("partysync-extension-root")) install();

function install() {
  const root = document.createElement("div");
  root.id = "partysync-extension-root";
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{display:block;margin:12px 0;font:14px/1.5 Arial,sans-serif;color:#f4f0ff;color-scheme:dark;max-width:460px}
      :host([data-floating]){position:fixed;bottom:24px;right:24px;z-index:2147483646;width:min(380px,calc(100vw - 48px))}
      *{box-sizing:border-box}button,input{font:inherit;border-radius:9px;padding:10px 14px}
      button{background:#8b5cf6;color:white;border:0;cursor:pointer;font-weight:600}button:hover{background:#7c3aed}
      button:disabled{opacity:.55;cursor:wait}input{width:100%;background:#11111d;border:1px solid #555268;color:white}
      button:focus-visible,input:focus-visible{outline:2px solid #c4b5fd;outline-offset:3px}
      .panel{margin-top:8px;padding:18px;border:1px solid #51456a;border-radius:12px;background:#181824;box-shadow:0 6px 24px #0005}
      [hidden]{display:none!important}h2{font-size:18px;margin:0 0 8px}p{margin:10px 0;color:#d0c5e0}
      label{display:block;margin-bottom:6px}form{display:grid;gap:10px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
      .secondary{background:#39334b}.end{background:#b22d48}.code{font-size:28px;letter-spacing:4px;color:#c4b5fd;margin:8px 0}
      .status{font-size:13px}.settings{margin-top:12px;font-size:12px;padding:6px 10px}
    </style>
    <button type="button" id="toggle" aria-expanded="false" aria-controls="panel">Host with PartySync</button>
    <section class="panel" id="panel" aria-label="PartySync host" hidden>
      <h2>PartySync</h2>
      <p class="status" id="status" role="status">Host this video and invite friends to PartySync.</p>
      <form id="start-form">
        <label for="host-name">Your name</label><input id="host-name" maxlength="24" autocomplete="nickname" required>
        <button id="start" type="submit">Start party</button>
      </form>
      <div id="party" hidden>
        <p>Room code</p><div class="code" id="code"></div>
        <label for="invite">Invite link</label><input id="invite" readonly>
        <p id="members"></p>
        <div class="actions"><button type="button" id="copy">Copy invite link</button>
          <button type="button" id="end" class="end">End party</button></div>
      </div>
      <button type="button" id="settings" class="settings secondary">Extension settings</button>
    </section>`;
  const element = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;
  const toggle = element<HTMLButtonElement>("toggle");
  const panel = element<HTMLElement>("panel");
  const name = element<HTMLInputElement>("host-name");
  const start = element<HTMLButtonElement>("start");
  const invite = element<HTMLInputElement>("invite");
  const status = element<HTMLElement>("status");
  let view: HostView = { phase: "idle", code: null, invite: null, members: 0, name: "", message: status.textContent! };
  let port: chrome.runtime.Port | null = null;
  let video: HTMLVideoElement | null = null;
  let navigating = false;
  let destroyed = false;

  function connect() {
    if (port || destroyed) return;
    try {
      const active = chrome.runtime.connect({ name: "partysync-host" });
      port = active;
      active.onMessage.addListener((message: { type: string; view?: HostView }) => {
        if (port !== active || message.type !== "state" || !message.view) return;
        view = message.view;
        render();
      });
      active.onDisconnect.addListener(() => {
        // Read lastError so an extension update does not log an unchecked error.
        void chrome.runtime.lastError;
        if (port !== active) return;
        port = null;
        const activeParty = view.phase !== "idle";
        view = { ...view, phase: "idle", code: null, invite: null, members: 0,
          message: activeParty ? "Host connection closed. Start a new party to continue." : view.message };
        render();
      });
    } catch {
      status.textContent = "The extension was updated. Refresh this YouTube tab to continue.";
    }
  }

  function send(command: HostCommand) {
    connect();
    try { port?.postMessage(command); }
    catch { port = null; status.textContent = "Refresh this YouTube tab to reconnect PartySync."; }
  }

  function sample() { return navigating ? null : readVideoSample(document, location.href); }
  function publish(immediate = false) {
    if (view.phase !== "idle") send({ type: "sample", sample: sample(), immediate });
  }
  const playbackEvent = () => publish(true);
  const videoEvents = ["play", "pause", "seeking", "seeked", "ratechange", "waiting", "playing", "ended", "loadedmetadata"];
  function bindVideo() {
    const next = document.querySelector<HTMLVideoElement>("#movie_player video.html5-main-video, ytd-player video");
    if (video === next) return;
    for (const event of videoEvents) {
      video?.removeEventListener(event, playbackEvent);
      next?.addEventListener(event, playbackEvent);
    }
    video = next;
  }

  function render() {
    const hosting = view.phase === "hosting";
    toggle.textContent = hosting ? `PartySync · ${view.code}` : "Host with PartySync";
    status.textContent = view.message;
    element("start-form").hidden = hosting;
    element("party").hidden = !hosting;
    start.disabled = view.phase === "connecting" || !sample();
    start.textContent = view.phase === "connecting" ? "Connecting…" : "Start party";
    name.disabled = view.phase === "connecting";
    if (!name.value && view.name) name.value = view.name;
    element("code").textContent = view.code ?? "";
    invite.value = view.invite ?? "";
    element("members").textContent = `${view.members} ${view.members === 1 ? "member" : "members"} in the party`;
  }

  function mount() {
    const watch = watchVideoId(location.href) !== null;
    root.hidden = !watch && view.phase === "idle";
    const anchor = watch ? document.querySelector("ytd-watch-metadata #top-row, ytd-watch-metadata #title, #below") : null;
    if (anchor && root.parentElement !== anchor) { anchor.append(root); root.removeAttribute("data-floating"); }
    else if (!anchor) {
      root.setAttribute("data-floating", "");
      if (root.parentElement !== document.body) document.body.append(root);
    }
    bindVideo();
    start.disabled = view.phase === "connecting" || !sample();
  }

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) { connect(); if (view.phase === "idle") name.focus(); }
  });
  element("start-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const current = sample();
    if (!current) { status.textContent = "Wait for the YouTube video to load, then try again."; return; }
    send({ type: "start", name: name.value, sample: current });
  });
  element("end").addEventListener("click", () => send({ type: "end" }));
  element("settings").addEventListener("click", () => send({ type: "settings" }));
  element("copy").addEventListener("click", () => {
    if (!view.invite) return;
    void navigator.clipboard.writeText(view.invite).then(() => { status.textContent = "Invite link copied."; })
      .catch(() => { invite.focus(); invite.select(); status.textContent = "Select and copy the invite link above."; });
  });
  document.addEventListener("yt-navigate-start", () => { navigating = true; publish(true); });
  document.addEventListener("yt-navigate-finish", () => { navigating = false; mount(); publish(true); });
  document.addEventListener("visibilitychange", () => publish(true));
  const interval = window.setInterval(() => { mount(); publish(); }, SYNC_POLL_MS);
  window.addEventListener("pagehide", () => {
    destroyed = true;
    window.clearInterval(interval);
    port?.disconnect();
    for (const event of videoEvents) video?.removeEventListener(event, playbackEvent);
  }, { once: true });
  mount();
}
