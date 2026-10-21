# PartySync

React/Vite frontend on Vercel and Express/Socket.IO backend on Render.

```text
partysync/          Frontend (Vercel project root)
  src/
  public/
  .env.example
  vercel.json
  package.json
server/             Backend (Render service root)
  .env.example
  server.js
  package.json
render.yaml         Render Blueprint
package.json        Convenience commands for local development
```

## Local development

Use Node.js 24. Install each app's dependencies from the repository root:

```sh
npm ci --prefix partysync
npm ci --prefix server
```

Run `npm run dev:server` and `npm run dev:client` in separate terminals.
Defaults connect http://localhost:5173 to http://localhost:3001.
Copy `partysync/.env.example` to `partysync/.env.local` to change the backend URL.
For backend overrides, set environment variables in your shell or run
`node --env-file=.env server.js` from `server/` after copying its example to `.env`.

## Deploy

1. Import this repository into Vercel and use the Vite preset. Leave **Root Directory**
   at the repository root: the root `vercel.json` installs frontend dependencies
   with `npm ci --prefix partysync --include=dev`, runs `npm run build`, and serves
   `partysync/dist`. Existing projects with **Root Directory** set to `partysync`
   are also supported by `partysync/vercel.json`, which installs with
   `npm ci --include=dev`, runs `npm run build`, and serves `dist`.
   Note the production frontend origin (for example `https://your-app.vercel.app`).
2. In Render, create a **Blueprint** from this repository using `render.yaml`.
   `FRONTEND_URL` is configured as `https://partysync-black.vercel.app`. The Blueprint installs
   and starts the backend from `server/` and checks `/api/health`.
3. Production builds default to `https://partysync.onrender.com`. To override this,
   set Vercel's `VITE_BACKEND_URL` to the Render HTTPS service URL, without `/api` or
   `/socket.io`. Redeploy the frontend after setting or changing this value.
4. Open the Vercel site, create a party, and join it from another browser.

If a Vercel build reports `tsc: command not found`, check the project's
**Settings > Build and Deployment** and use the commands for its root directory
listed above. Running only `npm ci` at the repository root does not install the
frontend's dependencies. Keep development dependencies enabled during builds:
TypeScript and Vite are required to compile the frontend. Redeploy after updating
the settings. An npm `Unknown env config "cache-dir"` warning is separate from
this missing compiler error; if you configured `NPM_CONFIG_CACHE_DIR`, remove it
or replace it with the supported `NPM_CONFIG_CACHE` setting.

For a manual Render Web Service, use root `server`, build `npm ci`, start
`npm start`, health check `/api/health`, and the environment variables in the
Blueprint. Render supplies `PORT`; the server listens on `0.0.0.0`.

`FRONTEND_URL` supports comma-separated exact origins for custom domains or
specific preview deployments. Add each origin you want to allow, then redeploy
the backend. `VITE_BACKEND_URL` is public build-time configuration, not a secret.

Rooms are stored in memory. Keep the backend at one instance; restarting or
redeploying clears rooms. Free Render services can sleep, so the initial
connection can take longer while the service wakes up.

## Website playback synchronization

Rooms now include timestamped playback snapshots, host-only playback updates,
sequence validation, and a clock synchronization endpoint. Shared TypeScript
event definitions live in `partysync/src/shared/protocol.ts`.

See [the playback protocol](docs/playback-protocol.md) for event payloads,
late-join timing, and clock offset calculations.

Hosts control the embedded YouTube player normally. Guests join the room and
tap **Join & Start** to follow the host's current position, play/pause, seeks,
and playback speed. **Sync now** forces a position correction and refreshes the
clock estimate. Guests must tap **Join & Start** again if their browser blocks
playback or a new song loads. Clock estimates refresh every 30 seconds; host
positions are shared at least every second while the player is active. Host
samples include their capture time in the synchronized server clock so the
backend can compensate for host-to-server travel time during playback.

Automatic corrections tolerate 0.35 seconds of playing drift (0.1 when paused)
and use a 2-second seek cooldown to avoid repeated buffering. Players are checked
every 250 ms. Host control
changes and manual synchronization can bypass the cooldown. Playback still
depends on YouTube availability, ads, buffering, and browser playback permissions;
frame-exact synchronization is not guaranteed. The host extension is milestone 3.

The delay reduction needs both the frontend and backend deployed from the latest
code. Older clients remain supported; clients without a synchronized capture
time use receipt-time playback snapshots.

After installing both apps' dependencies, run these checks from the repository root:

```sh
npm test
npm run check:server
npm run build
npm run lint
npm --prefix partysync run check:tests
```

`npm test` runs backend integration tests and deterministic frontend timing and
player-controller tests. Browser tests use the real website and backend with a
simulated YouTube IFrame API so they do not depend on ads or network media:

```sh
cd partysync
npx playwright install chromium
npm run test:e2e
```

Alternatively set `PLAYWRIGHT_CHANNEL=chrome` to use installed Google Chrome.
The browser suite starts isolated servers on ports 5178 and 3008 and checks a
mobile-sized guest, clock differences, late joining, controls, song changes,
blocked playback, buffering, and unavailable videos. For live YouTube verification,
use two browser profiles and a phone: play a karaoke video, join midway, seek
while playing and paused, change speed, switch songs, and confirm the guest can
resume using **Join & Start** after a playback restriction.
