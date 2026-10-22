import { backendPermission, parseSettings } from "./config.ts";

const frontend = document.getElementById("frontend") as HTMLInputElement;
const backend = document.getElementById("backend") as HTMLInputElement;
const status = document.getElementById("status")!;
void chrome.storage.local.get("settings").then((stored) => {
  const settings = parseSettings(stored.settings);
  frontend.value = settings.frontendUrl;
  backend.value = settings.backendUrl;
}).catch(() => { status.textContent = "Could not load settings. Enter your website and backend URLs."; });

document.getElementById("settings-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});

async function save() {
  try {
    const settings = parseSettings({ frontendUrl: frontend.value, backendUrl: backend.value });
    // This request starts directly from the user's save click, before any await.
    const granted = await chrome.permissions.request({ origins: [backendPermission(settings.backendUrl)] });
    if (!granted) throw new Error("Backend access was not granted. Your previous settings are unchanged.");
    await chrome.storage.local.set({ settings });
    frontend.value = settings.frontendUrl;
    backend.value = settings.backendUrl;
    status.textContent = "Settings saved. End any current party, then start a new one to use these settings.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not save settings.";
  }
}
