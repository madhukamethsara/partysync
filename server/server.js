
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const allowedOrigins = FRONTEND_URL.split(",").map((origin) =>
  origin.trim().replace(/\/$/, "")
);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

// Store rooms in memory
const rooms = new Map();

// Generate unique six-character room code
function generateRoomCode() {
  let code;

  do {
    code = randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));

  return code;
}

// Validate participant name
function validateName(value) {
  if (typeof value !== "string") return null;

  const name = value.trim();

  if (!name || name.length > 24) return null;

  return name;
}

// Convert internal room data into a plain object
function getRoomData(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    participants: Array.from(room.participants.values()),
  };
}

// Notify everybody about updated participants
function broadcastRoom(room) {
  io.to(room.code).emit("room:updated", getRoomData(room));
}

// Remove a user from their current room
function leaveRoom(socket) {
  const code = socket.data.roomCode;

  if (!code) return;

  socket.data.roomCode = null;

  const room = rooms.get(code);

  if (!room) {
    socket.leave(code);
    return;
  }

  if (room.hostId === socket.id) {
    // Host leaving ends the party
    socket.to(code).emit("room:closed", {
      message: "The host ended the party.",
    });

    // Clear room membership of every guest
    for (const participant of room.participants.values()) {
      if (participant.id === socket.id) continue;

      const guestSocket = io.sockets.sockets.get(
        participant.id
      );

      if (guestSocket) {
        guestSocket.data.roomCode = null;
        guestSocket.leave(code);
      }
    }

    rooms.delete(code);

    console.log(`Room ${code} closed`);
  } else {
    // Guest leaves; room stays open
    room.participants.delete(socket.id);
    socket.leave(code);
    broadcastRoom(room);
  }

  socket.leave(code);
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "PartySync Backend Running",
    activeRooms: rooms.size,
  });
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.emit("server:welcome", {
    message: "Connected to PartySync backend!",
  });

  // EVENT 1: CREATE ROOM
  socket.on("room:create", (data, callback) => {
    if (typeof callback !== "function") return;

    const name = validateName(data?.name);

    if (!name) {
      return callback({
        success: false,
        message: "Enter a name with up to 24 characters.",
      });
    }

    if (socket.data.roomCode) {
      return callback({
        success: false,
        message: "Leave your current party first.",
      });
    }

    const code = generateRoomCode();

    const room = {
      code,
      hostId: socket.id,
      participants: new Map(),
    };

    room.participants.set(socket.id, {
      id: socket.id,
      name,
      role: "host",
    });

    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;

    console.log(`Room created: ${code}`);

    callback({
      success: true,
      room: getRoomData(room),
    });
  });

  // EVENT 2: JOIN ROOM
  socket.on("room:join", (data, callback) => {
    if (typeof callback !== "function") return;

    const name = validateName(data?.name);

    const code =
      typeof data?.code === "string"
        ? data.code.trim().toUpperCase()
        : "";

    if (!name) {
      return callback({
        success: false,
        message: "Please enter a valid name.",
      });
    }

    if (socket.data.roomCode) {
      return callback({
        success: false,
        message: "Leave your current party first.",
      });
    }

    const room = rooms.get(code);

    if (!room) {
      return callback({
        success: false,
        message: "Room not found. Check the code.",
      });
    }

    if (room.participants.size >= 30) {
      return callback({
        success: false,
        message: "This party is full.",
      });
    }

    // Add guest
    room.participants.set(socket.id, {
      id: socket.id,
      name,
      role: "guest",
    });

    socket.join(code);
    socket.data.roomCode = code;

    console.log(`${name} joined ${code}`);

    callback({
      success: true,
      room: getRoomData(room),
    });

    broadcastRoom(room);
  });

  // EVENT 3: LEAVE ROOM
  socket.on("room:leave", (callback) => {
    leaveRoom(socket);

    if (typeof callback === "function") {
      callback({ success: true });
    }
  });

  // EVENT 4: DISCONNECT
  socket.on("disconnect", () => {
    leaveRoom(socket);
    console.log("Disconnected:", socket.id);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(
    `PartySync server running on http://localhost:${PORT}`
  );
});
