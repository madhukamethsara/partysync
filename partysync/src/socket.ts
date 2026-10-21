import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./shared/protocol";

export type PartySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const backendUrl = import.meta.env.VITE_BACKEND_URL || (
  import.meta.env.PROD ? "https://partysync.onrender.com" : "http://localhost:3001"
);

export const socket: PartySocket = io(backendUrl, { autoConnect: false });
