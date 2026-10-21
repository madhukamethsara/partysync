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

1. Import this repository into Vercel. Set **Root Directory** to `partysync`
   and use the Vite preset. Its `vercel.json` sets installation, build, and output.
   Note the production frontend origin (for example `https://your-app.vercel.app`).
2. In Render, create a **Blueprint** from this repository using `render.yaml`.
   `FRONTEND_URL` is configured as `https://partysync-black.vercel.app`. The Blueprint installs
   and starts the backend from `server/` and checks `/api/health`.
3. Production builds default to `https://partysync.onrender.com`. To override this,
   set Vercel's `VITE_BACKEND_URL` to the Render HTTPS service URL, without `/api` or
   `/socket.io`. Redeploy the frontend after setting or changing this value.
4. Open the Vercel site, create a party, and join it from another browser.

For a manual Render Web Service, use root `server`, build `npm ci`, start
`npm start`, health check `/api/health`, and the environment variables in the
Blueprint. Render supplies `PORT`; the server listens on `0.0.0.0`.

`FRONTEND_URL` supports comma-separated exact origins for custom domains or
specific preview deployments. Add each origin you want to allow, then redeploy
the backend. `VITE_BACKEND_URL` is public build-time configuration, not a secret.

Rooms are stored in memory. Keep the backend at one instance; restarting or
redeploying clears rooms. Free Render services can sleep, so the initial
connection can take longer while the service wakes up.

## Playback foundation

Rooms now include timestamped playback snapshots, host-only playback updates,
sequence validation, and a clock synchronization endpoint. Shared TypeScript
event definitions live in `partysync/src/shared/protocol.ts`.

See [the playback protocol](docs/playback-protocol.md) for event payloads,
late-join timing, and clock offset calculations. Website playback synchronization
and the YouTube host extension are subsequent milestones.

After installing both apps' dependencies, run these checks from the repository root:

```sh
npm test
npm run check:server
npm run build
npm run lint
```
