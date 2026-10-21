# Shared playback protocol (milestone 1)

The server stores one authoritative playback snapshot per room. This milestone
provides the protocol; observing the host player and controlling guest players
belong to milestone 2 (website) and milestone 3 (YouTube extension).

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
});
```

The server validates membership, host identity, the selected video, a finite
nonnegative position, boolean playback status, supported speed range, and a
positive safe-integer sequence exactly one greater than the current revision.
The room is determined from the socket's membership, never from client-supplied
room or host identifiers. Extra fields, including client timestamps, are ignored.

Accepted samples receive a server timestamp and are broadcast to **all** room
members, including the host, using `playback:updated`. The acknowledgement is
`{ success: true, playback }`. Playback-only updates do not rebroadcast the
participant list through `room:updated`.

Failures return `{ success: false, message }`. A video mismatch or sequence
conflict also includes the authoritative `playback` for recovery. Rejected
updates do not change state or broadcast playback. Clients should retain the
latest revision, serialize updates, and rebuild the next sample after a conflict.
Do not blindly resend the same sample after an uncertain acknowledgement.

The timestamp anchors the reported position at server acceptance. This version
does not compensate for the host-to-server travel time. Periodic fresh samples
and later drift correction improve alignment; exact frame synchronization is
not guaranteed. A paused position stays fixed; a playing position advances by
elapsed time multiplied by playback speed.

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
The website does not yet sample the clock or apply playback snapshots.

## Existing lifecycle

Rooms remain in memory on a single backend instance. Host disconnects still
close the room immediately. Reconnection tokens and a grace period are planned
for milestone 4. No extension origin permissions or extension files are added
in this milestone.
