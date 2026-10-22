import type { ClockSyncResponse, PlaybackState, Room } from "../shared/protocol.ts";

export function clockSample(
  response: ClockSyncResponse,
  clientSentAt: number,
  clientReceivedAt: number,
) {
  if (!response.success || response.clientSentAt !== clientSentAt) return null;
  const roundTripMs = clientReceivedAt - clientSentAt
    - (response.serverSentAt - response.serverReceivedAt);
  const offsetMs = ((response.serverReceivedAt - clientSentAt)
    + (response.serverSentAt - clientReceivedAt)) / 2;
  if (!Number.isFinite(offsetMs) || !Number.isFinite(roundTripMs) || roundTripMs < 0) return null;
  return { offsetMs, roundTripMs };
}

export function expectedPosition(playback: PlaybackState, serverNow: number, duration = 0) {
  const elapsed = playback.playing ? Math.max(0, serverNow - playback.updatedAt) / 1000 : 0;
  const position = Math.max(0, playback.position + elapsed * playback.playbackRate);
  return duration > 0 ? Math.min(position, duration) : position;
}

export function applyPlayback(room: Room | null, playback: PlaybackState): Room | null {
  if (!room || playback.sequence <= room.playback.sequence) return room;
  return { ...room, videoId: playback.videoId, playback };
}

export function mergeRoom(current: Room | null, incoming: Room): Room {
  if (current?.code !== incoming.code || incoming.playback.sequence >= current.playback.sequence) {
    return incoming;
  }
  return { ...incoming, videoId: current.videoId, playback: current.playback };
}

export function inviteRoomCode(search: string): string {
  const code = new URLSearchParams(search).get("room")?.trim().toUpperCase() ?? "";
  return /^[A-F0-9]{6}$/.test(code) ? code : "";
}
