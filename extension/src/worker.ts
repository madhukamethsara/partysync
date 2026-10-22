import { backendPermission, DEFAULT_SETTINGS, parseSettings } from "./config.ts";
import { validSample, type HostCommand, type HostView } from "./messages.ts";
import { HostSession } from "./session.ts";

const hosts = new Map<number, chrome.runtime.Port>();
chrome.action.onClicked.addListener(() => { void chrome.runtime.openOptionsPage(); });

chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id;
  let origin: string;
  try { origin = new URL(port.sender?.url ?? "").origin; } catch { port.disconnect(); return; }
  if (port.name !== "partysync-host" || tabId === undefined || origin !== "https://www.youtube.com") {
    port.disconnect(); return;
  }
  hosts.get(tabId)?.disconnect();
  hosts.set(tabId, port);
  let connected = true;
  let session: HostSession | null = null;
  const notify = (view: HostView) => { if (connected) port.postMessage({ type: "state", view }); };
  const initialized = chrome.storage.local.get("hostName").then((stored) => {
    // Idle views need no network permissions. Load and validate current settings
    // on each start so fixing settings does not require reloading the host tab.
    if (connected) session = new HostSession(DEFAULT_SETTINGS, notify, typeof stored.hostName === "string" ? stored.hostName : "");
  });
  const reportError = (error: unknown) => notify({ phase: "idle", code: null, invite: null, members: 0, name: "",
    message: error instanceof Error ? error.message : "Open extension settings to configure PartySync." });
  void initialized.catch(reportError);
  port.onMessage.addListener((value: unknown) => {
    if (!value || typeof value !== "object") return;
    const command = value as HostCommand;
    if (command.type === "settings") { void chrome.runtime.openOptionsPage(); return; }
    void initialized.then(async () => {
      if (!connected || !session) return;
      if (command.type === "start" && typeof command.name === "string" && validSample(command.sample)) {
        if (session.active) return;
        const settings = parseSettings((await chrome.storage.local.get("settings")).settings);
        if (!await chrome.permissions.contains({ origins: [backendPermission(settings.backendUrl)] })) {
          throw new Error("Open extension settings and allow access to your PartySync backend.");
        }
        if (!connected || session.active) return;
        session.dispose();
        session = new HostSession(settings, notify, command.name);
        await chrome.storage.local.set({ hostName: command.name.trim().slice(0, 24) });
        await session.start(command.name, command.sample);
      } else if (command.type === "sample" && (command.sample === null || validSample(command.sample))) {
        session.update(command.sample, command.immediate === true);
      } else if (command.type === "end") session.end();
    }).catch(reportError);
  });
  port.onDisconnect.addListener(() => {
    connected = false;
    session?.dispose();
    if (hosts.get(tabId) === port) hosts.delete(tabId);
  });
});
