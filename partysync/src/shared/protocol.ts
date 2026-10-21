/** Shared wire contract for the website, backend, and future host extension. */
export type Participant = {
  id: string;
  name: string;
  role: "host" | "guest";
};

export type PlaybackState = {
  videoId: string | null;
  /** Seconds at updatedAt, not seconds at receipt. */
  position: number;
  playing: boolean;
  playbackRate: number;
  /** Server Unix time in milliseconds. */
  updatedAt: number;
  /** Room-wide revision; increments on playback updates and song changes. */
  sequence: number;
};

export type PlaybackUpdate = {
  videoId: string;
  position: number;
  playing: boolean;
  playbackRate: number;
  /** Must equal the latest authoritative sequence + 1. */
  sequence: number;
};

export type Room = {
  code: string;
  hostId: string;
  /** Kept for compatibility with existing clients; mirrors playback.videoId. */
  videoId: string | null;
  playback: PlaybackState;
  participants: Participant[];
};

export type Failure = { success: false; message: string };
export type ActionResponse = { success: true } | Failure;
export type RoomResponse = { success: true; room: Room } | Failure;
export type PlaybackResponse =
  | { success: true; playback: PlaybackState }
  | (Failure & { playback?: PlaybackState });
export type ClockSyncResponse =
  | {
      success: true;
      clientSentAt: number;
      serverReceivedAt: number;
      serverSentAt: number;
    }
  | Failure;

export interface ClientToServerEvents {
  "room:create": (data: { name: string }, ack: (response: RoomResponse) => void) => void;
  "room:join": (data: { name: string; code: string }, ack: (response: RoomResponse) => void) => void;
  "room:leave": (ack: (response: ActionResponse) => void) => void;
  "video:change": (data: { videoId: string }, ack: (response: ActionResponse) => void) => void;
  "playback:update": (data: PlaybackUpdate, ack: (response: PlaybackResponse) => void) => void;
  "clock:sync": (data: { clientSentAt: number }, ack: (response: ClockSyncResponse) => void) => void;
}

export interface ServerToClientEvents {
  "server:welcome": (data: { message: string }) => void;
  "room:updated": (room: Room) => void;
  "room:closed": (data: { message: string }) => void;
  "playback:updated": (playback: PlaybackState) => void;
}
