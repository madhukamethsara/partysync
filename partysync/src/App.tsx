
import { useEffect, useState, type FormEvent } from "react";
import { io } from "socket.io-client";
import "./App.css";

type Participant = {
  id: string;
  name: string;
  role: "host" | "guest";
};

type Room = {
  code: string;
  hostId: string;
  participants: Participant[];
};

type RoomResponse =
  | { success: true; room: Room }
  | { success: false; message: string };

type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:3001", {
  autoConnect: false,
});

function App() {
  const [status, setStatus] =
    useState<ConnectionStatus>("connecting");

  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onConnect() {
      setStatus("connected");
      setError("");
    }

    function onDisconnect() {
      setStatus("disconnected");
      setRoom(null);
      setLoading(false);
      setError(
        "Connection lost. Please create or join a party again."
      );
    }

    function onConnectError() {
      setStatus("disconnected");
      setError("Unable to connect to the backend.");
    }

    function onRoomUpdated(updatedRoom: Room) {
      setRoom(updatedRoom);
    }

    function onRoomClosed(data: { message: string }) {
      setRoom(null);
      setNotice(data.message);
      setLoading(false);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:updated", onRoomUpdated);
    socket.on("room:closed", onRoomClosed);

    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:updated", onRoomUpdated);
      socket.off("room:closed", onRoomClosed);
      socket.disconnect();
    };
  }, []);

  async function handleCreate(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = (await socket
        .timeout(5000)
        .emitWithAck("room:create", {
          name: name.trim(),
        })) as RoomResponse;

      if (!response.success) {
        setError(response.message);
        return;
      }

      setRoom(response.room);
    } catch {
      setError("Server did not respond. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!name.trim() || !joinCode.trim()) {
      setError("Enter your name and room code.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = (await socket
        .timeout(5000)
        .emitWithAck("room:join", {
          name: name.trim(),
          code: joinCode.trim().toUpperCase(),
        })) as RoomResponse;

      if (!response.success) {
        setError(response.message);
        return;
      }

      setRoom(response.room);
    } catch {
      setError("Could not join. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLeave() {
    setLoading(true);
    setError("");

    try {
      await socket
        .timeout(5000)
        .emitWithAck("room:leave");

      setRoom(null);
      setNotice("You left the party.");
    } catch {
      setError("Could not leave the party.");
    } finally {
      setLoading(false);
    }
  }

  const isHost =
    room !== null && room.hostId === socket.id;

  return (
    <main className="app">
      <div className="container">
        <header className="header">
          <h1>🎤 PartySync</h1>

          <p className="subtitle">
            One Song. Many Screens. Everyone Sings.
          </p>

          <div className={`status ${status}`}>
            ● Backend {status}
          </div>
        </header>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        {notice && !room && (
          <div className="alert notice" role="status">
            {notice}
          </div>
        )}

        {!room ? (
          <section className="welcome-card">
            <h2>Start Singing Together 🎶</h2>

            <div className="field">
              <label htmlFor="nickname">
                Your Name
              </label>

              <input
                id="nickname"
                type="text"
                placeholder="Enter your name"
                value={name}
                maxLength={24}
                onChange={(event) =>
                  setName(event.target.value)
                }
              />
            </div>

            <div className="action-grid">
              <form
                className="action-card"
                onSubmit={handleCreate}
              >
                <h3>🎉 Create Party</h3>

                <p>
                  Start a new karaoke room
                  and invite friends.
                </p>

                <button
                  type="submit"
                  disabled={
                    loading ||
                    status !== "connected" ||
                    !name.trim()
                  }
                >
                  Create Party
                </button>
              </form>

              <form
                className="action-card"
                onSubmit={handleJoin}
              >
                <h3>🎵 Join Party</h3>

                <p>
                  Have a room code?
                  Join your friends.
                </p>

                <input
                  type="text"
                  placeholder="Enter room code"
                  aria-label="Room code"
                  value={joinCode}
                  maxLength={6}
                  onChange={(event) =>
                    setJoinCode(
                      event.target.value.toUpperCase()
                    )
                  }
                />

                <button
                  type="submit"
                  disabled={
                    loading ||
                    status !== "connected" ||
                    !name.trim() ||
                    !joinCode.trim()
                  }
                >
                  Join Party
                </button>
              </form>
            </div>
          </section>
        ) : (
          <section className="room-card">
            <span className="role-label">
              {isHost ? "👑 Party Host" : "🎤 Guest"}
            </span>

            <h2>Karaoke Party</h2>

            <p className="muted">
              Share this code with your friends
            </p>

            <div className="room-code">
              {room.code}
            </div>

            <button
              className="copy-btn"
              onClick={() =>
                navigator.clipboard
                  .writeText(room.code)
                  .then(() =>
                    setNotice("Room code copied!")
                  )
                  .catch(() =>
                    setError("Could not copy room code.")
                  )
              }
            >
              Copy Room Code
            </button>

            {notice && (
              <p className="muted" role="status">
                {notice}
              </p>
            )}

            <div className="participants">
              <h3>
                Party Members ({room.participants.length})
              </h3>

              <ul>
                {room.participants.map((person) => (
                  <li key={person.id}>
                    <span>
                      👤 {person.name}
                    </span>

                    <span className="member-role">
                      {person.role === "host"
                        ? "Host"
                        : "Guest"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              className="leave-btn"
              disabled={loading}
              onClick={handleLeave}
            >
              {isHost ? "End Party" : "Leave Party"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
