# Shared playback protocol

The server stores one authoritative playback snapshot per room. Milestone 1
provides the protocol; milestone 2 connects the website's host and guest players.
Milestone 3 adds a desktop YouTube host extension using the same protocol.

## Shared types

`partysync/src/shared/protocol.ts` defines the room, playback, acknowledgement,
and Socket.IO event types. The website imports these types and the JavaScript
backend references them through JSDoc. The extension imports the same types
using type-only imports and reuses the website's host publisher. Keeping the source within the frontend
also preserves the existing Vercel project root; server references are erased
and add no runtime dependency on frontend files.

Run `npm run check:server` from the repository root after installing frontend
and server dependencies to check the backend against this contract. Run
`npm test` for integration tests and `npm run build` for the typed website build.

## Room state

Both `room:create` and `room:join` acknowledgements, plus `room:updated`, include
`room.playback`:

```ts
{
  videoId: string | null,
  position: number,       // seconds at updatedAt
  playing: boolean,
  playbackRate: number,   // 0.25 through 2, inclusive
  updatedAt: number,      // server Unix time in milliseconds
  sequence: number       // authoritative room-wide revision
}
```

New rooms start with no video, position zero, paused, speed 1, sequence zero,
and the room creation timestamp. The top-level `room.videoId` remains available
for existing clients and always matches `room.playback.videoId`.

`video:change` remains host-only. Every accepted change resets position to zero,
pauses playback, resets speed to 1, stamps server time, and increments sequence
(even when selecting the same video). It broadcasts both `room:updated` and
`playback:updated`. Its existing `{ success: true }` acknowledgement is unchanged.

## Host updates

After selecting a song, the host sends `playback:update` with an acknowledgement:

```ts
socket.timeout(5000).emitWithAck("playback:update", {
  videoId: "dQw4w9WgXcQ",
  position: 42.5,
  playing: true,
  playbackRate: 1,
  sequence: latestPlayback.sequence + 1,
  sampledAt: Date.now() + clockOffsetMs, // optional, after clock synchronization
});
```

The server validates membership, host identity, the selected video, a finite
nonnegative position, boolean playback status, supported speed range, and a
positive safe-integer sequence exactly one greater than the current revision.
The room is determined from the socket's membership, never from client-supplied
room or host identifiers. The optional `sampledAt` must be a finite nonnegative
number in estimated server Unix milliseconds. Other extra fields are ignored.

Accepted samples receive a server timestamp and are broadcast to **all** room
members, including the host, using `playback:updated`. The acknowledgement is
`{ success: true, playback }`. Playback-only updates do not rebroadcast the
participant list through `room:updated`.

Failures return `{ success: false, message }`. A video mismatch or sequence
conflict also includes the authoritative `playback` for recovery. Rejected
updates do not change state or broadcast playback. Clients should retain the
latest revision, serialize updates, and rebuild the next sample after a conflict.
Do not blindly resend the same sample after an uncertain acknowledgement.

The timestamp anchors the stored position at server acceptance. When a host
provides `sampledAt`, the server projects a playing sample forward by
`max(0, receivedAt - sampledAt) / 1000 * playbackRate` before storing it. This
accounts for the host-to-server travel time that otherwise leaves guests behind.
Only timestamps within two seconds before receipt or 250 ms after receipt are
used. Small future estimates are clamped to zero age; timestamps outside the
window fall back to receipt-time sampling. Paused samples never advance.
Clients without `sampledAt` retain the previous behavior. Clock estimates assume
roughly symmetric travel, and YouTube seek/buffering latency still applies;
exact frame synchronization is not guaranteed.

Late joins receive the latest stored snapshot with its original timestamp,
not a timestamp rewritten at join time. Consumers must project it forward.

## Clock synchronization

Any connected client, including one that has not joined a room, can request:

```ts
const clientSentAt = Date.now();
const response = await socket.timeout(5000).emitWithAck("clock:sync", { clientSentAt });
const clientReceivedAt = Date.now();
```

Success returns `{ success: true, clientSentAt, serverReceivedAt, serverSentAt }`.
All times are Unix milliseconds. Invalid or negative client timestamps return
`{ success: false, message }`. The echoed timestamp lets clients associate the
reply with a sample. Requests require acknowledgement callbacks.

For a successful sample, estimate:

```text
offsetMs = ((serverReceivedAt - clientSentAt)
          + (serverSentAt - clientReceivedAt)) / 2
roundTripMs = (clientReceivedAt - clientSentAt)
            - (serverSentAt - serverReceivedAt)
serverNowMs = Date.now() + offsetMs
expectedPosition = playback.position + (playback.playing
  ? max(0, serverNowMs - playback.updatedAt) / 1000 * playback.playbackRate
  : 0)
```

This assumes roughly symmetric network delay. Consumers should collect several
samples, prefer samples with low round-trip time, and refresh after reconnecting.
The website collects five samples on connection, keeps the lowest round-trip
estimate in each batch, and refreshes every 30 seconds or on **Sync now**.

## Website consumers (milestone 2)

The host observes player state and rate changes immediately. A 250 ms poll
detects seeks (including paused seeks) and shares a heartbeat at least every
second once playback has started. Buffering publishes a non-playing sample
so guest timelines do not keep advancing while the host waits. Updates are
serialized; changes during an in-flight acknowledgement are coalesced into a
fresh sample. Sequence conflicts adopt the returned snapshot and subsequent
polls send fresh samples. A delayed reply after disposal cannot update the room.

Guests explicitly tap **Join & Start** after the player and clock are ready.
Guest corrections do not publish host events. Guests estimate the position from
the server clock and host speed, clamp it to known video duration, follow
play/pause and supported playback rates, and tolerate drift up to 0.75 seconds
when playing or 0.25 seconds when paused. Playing drift must persist for 1.5
seconds before correction, with at least 10 seconds between catch-up seeks and
a 3-second grace period after seeks or buffering recovery. A new host timeline
jump over 1.5 seconds is treated as a seek; normal heartbeat jitter no longer
bypasses the automatic correction safeguards. Play/pause, rate changes, and
explicit **Sync now** still apply immediately.

If an automatic seek fails to bring playing drift below the tolerance after
recovery, further automatic catch-up seeks are suspended. This prevents slow
players entering an endless seek/buffer loop. The guest sees a message suggesting
**Sync now**; a user retry, host control change, or song change resets this
suspension. Host control events remain active throughout. This trades a small
residual offset for continuous playback on devices with slow media seeks.

Blocked autoplay disables following until another user click. Guests keep the
same iframe and follower when the host changes videos. The native API cues the
next video; its reported URL must match the new snapshot before the follower
applies its timeline. Loading is not treated as an autoplay failure. Once ready,
the follower resets its seek/rate recovery state and resumes at the host's
current time, preserving the guest's earlier choice to follow. A browser block
still shows **Join & Start**. Selecting the same song resets the host player and
returns following guests to zero, paused. Player errors display a message;
selecting a different song clears the error and restores the guest controls.
Listeners, polling, and pending publishers are cleaned up when replaced or
leaving. Older room snapshots cannot overwrite a newer playback revision.
The YouTube API is documented at
https://developers.google.com/youtube/iframe_api_reference.

## Extension host (milestone 3)

The content script observes the native YouTube video element on `/watch` pages.
It sends timestamped samples through a tab-scoped Chrome runtime port, on player
events and every 250 ms. It follows YouTube navigation and replaces media event
listeners when YouTube replaces the video element. The extension does not control
the host's player or copy caption text: karaoke lyrics embedded in the video
follow its playback time.

The service worker owns a WebSocket-only Socket.IO connection to the existing
backend. It creates the room, selects the current video, and feeds samples to the
shared `HostPublisher`, preserving serialized updates, heartbeat timing, and
sequence recovery. Sample timestamps include the worker's estimated server clock
offset. It takes three clock samples when connecting, prefers the lowest round
trip, and repeats every 20 seconds. This also supplies WebSocket traffic needed
to keep an active Chrome 116+ extension service worker alive while paused.

Detected ads pause the guest timeline at the previous video's projected content
position; the ad's own timestamp is never published as the song position. A
missing player, navigation, and host buffering pause guests until samples resume.
Ad detection depends on YouTube's page structure and needs live verification.

Only the default backend is granted network access on installation. Custom HTTPS
backends or local development servers require an explicit permission grant in
the settings page. The content script runs on `www.youtube.com`; settings are
stored locally. Invite links target the configured frontend with `?room=CODE`,
which prefills the website's join form. Guests still enter their name and tap
**Join Party**, then **Join & Start**.

## Existing lifecycle

Rooms remain in memory on a single backend instance. Host disconnects still
close the room immediately. Reconnection tokens and a grace period are planned
for milestone 4. Closing or fully reloading the extension's host tab, ending the
party, or losing its connection ends the room. YouTube's navigation within the
same page keeps the session. Each host tab owns a separate room and connection.
