# Shared playback protocol (milestone 1)

The server stores one authoritative playback snapshot per room. Milestone 1
provides the protocol; milestone 2 connects the website's host and guest players.
The YouTube host extension is milestone 3.

## Shared types

`partysync/src/shared/protocol.ts` defines the room, playback, acknowledgement,
and Socket.IO event types. The website imports these types and the JavaScript
backend references them through JSDoc. The future extension should import the
same types using a type-only import. Keeping the source within the frontend
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
play/pause and supported playback rates, and correct drift over 0.35 seconds when
playing or 0.1 seconds when paused. Automatic seeks use a 2-second cooldown;
new host control changes and explicit **Sync now** can bypass it. Buffering
guests wait for recovery before attempting automatic drift corrections.

Blocked autoplay disables following until another user click. Video changes
create a new player and require another **Join & Start**. Selecting the same
song resets the host player and returns following guests to zero, paused. Player
errors display a message; listeners, polling, and pending publishers are cleaned
up on song changes or leaving. Older room snapshots cannot overwrite a newer
playback revision. The YouTube API is documented at
https://developers.google.com/youtube/iframe_api_reference.

## Existing lifecycle

Rooms remain in memory on a single backend instance. Host disconnects still
close the room immediately. Reconnection tokens and a grace period are planned
for milestone 4. No extension origin permissions or extension files are added
in this milestone.
