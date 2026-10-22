# PartySync for YouTube

Milestone 3 lets a host share a video directly from desktop YouTube. Guests use
the PartySync website, including on mobile, without installing an extension.

## Build and install

Use Node.js 24 and Google Chrome 116 or newer. From the repository root:

```sh
npm ci --prefix extension
npm run build:extension
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the generated `extension/dist` folder.
3. Open or refresh a normal `https://www.youtube.com/watch?v=...` video page.
4. Click **Host with PartySync** near the video title, enter your name, and click
   **Start party**. If the page layout has changed, the button appears at the
   bottom right instead.
5. Copy the invite link to friends. Guests enter a name, tap **Join Party**, then
   **Join & Start** to allow video playback on their device.

Keep the YouTube host tab open. Its normal play/pause, seeking, playback speed,
and video changes are shared. Closing the PartySync panel keeps the party
running; **End party** closes it for everyone.

After pulling an extension update, rebuild it, click **Reload** on its card in
`chrome://extensions`, and refresh YouTube. This ends any current party.

## Settings and deployment

Click the extension's toolbar icon or **Extension settings** in its panel.

| Setting | Default |
| --- | --- |
| PartySync website URL | `https://partysync-seven.vercel.app` |
| PartySync backend URL | `https://partysync.onrender.com` |

Use the backend's origin without `/api` or `/socket.io`. Custom servers must use
HTTPS; local development also accepts HTTP on `localhost` or `127.0.0.1`. Saving
a custom backend asks Chrome for access to that origin. End the current party
and start another to use changed settings; a YouTube refresh is unnecessary.

Deploy the frontend changes from this branch to prefill the room code from invite
links. Existing website builds can still join by entering the displayed code
manually. This extension works with the existing milestone 2 playback backend;
no additional backend environment variables are required. The website's
`VITE_BACKEND_URL` and backend's `FRONTEND_URL` must still match their deployments.
The extension is built separately from the Vercel website.

For local development, install frontend/server dependencies as described in the
root README, run `npm run dev:server` and `npm run dev:client`, then save
`http://localhost:5173` and `http://localhost:3001` in extension settings.

## Supported behavior and limits

- Normal desktop YouTube watch pages are supported. Shorts, live streams, embedded
  players, mobile YouTube pages, and other video sites are outside this milestone.
- Existing karaoke lyrics burned into a video follow its timeline. This milestone
  does not extract lyrics or synchronize YouTube caption preferences.
- Native player replacement and YouTube navigation to another watch video keep
  the room running. Each host tab can own its own room.
- Detected host ads pause guests without publishing the ad's timeline. Host
  buffering or a missing player also pauses guests. YouTube page changes may
  require updating the adapter; ad detection is best effort.
- Guests may see their own YouTube ads or playback restrictions. They must tap
  **Join & Start** when requested, including after a song change. Seek latency,
  buffering, and network differences prevent guaranteed frame-exact playback.
- Closing or fully reloading the host tab, reloading the extension, losing the
  backend connection, or restarting the backend ends the room. Reconnection and
  a host grace period belong to milestone 4.
- This is an unpacked development extension, not a Chrome Web Store release.

## Permissions and data

The content script runs on `www.youtube.com` to show the panel and observe the
native video. The service worker connects to the configured PartySync backend
after **Start party**, sharing the host name, video ID, playback position, state,
and speed. It never reads YouTube credentials or sends caption text. Settings
and the last host name are stored in Chrome's local extension storage.

Only the default backend has network permission at installation. The broad
optional HTTPS permission allows a user-selected backend; saving settings
requests access to that specific origin. All executable code is bundled locally.
No remotely hosted scripts are loaded by the extension.

## Verification

From the repository root, after installing all three packages:

```sh
npm run check:extension
npm run test:extension
npm run test:extension:e2e
```

The browser test requires a recent Chrome or Playwright Chromium with the CDP
`Extensions.loadUnpacked` command. To use installed Chrome in PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:extension:e2e
```

Alternatively, install Playwright Chromium with
`npm --prefix extension exec -- playwright install chromium`. The suite uses a
temporary browser profile and the `--enable-unsafe-extension-debugging` flag to
load the extension, without changing your normal Chrome profile. Only the
temporary test copy of the manifest pregrants access to the local backend.

The browser suite starts isolated servers on ports 3009 and 5179, loads the real
extension and backend, and simulates YouTube's page and media. It covers creating
a room, invite prefill, a mobile-sized guest, play/pause, seeks, speed, ads, panel
closure, navigation with player replacement, ending/restarting a party, and host
tab closure. It does not replace a live check against YouTube.

Before release, load the built extension in Chrome, host a real karaoke video,
join from a phone, pause and seek, change speed, navigate to another video, and
check behavior through an ad and buffering. Confirm that ending the party or
closing the host tab closes the guest room.
