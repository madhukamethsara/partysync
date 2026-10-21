import { useCallback, useEffect, useRef, useState } from "react";
import type { PartySocket } from "../socket";
import { clockSample } from "../utils/playback";

export function useServerClock(socket: PartySocket) {
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let generation = 0;
    let busy = false;
    let disposed = false;
    async function sampleClock() {
      if (busy || !socket.connected || disposed) return;
      busy = true;
      const current = generation;
      let best: { offsetMs: number; roundTripMs: number } | null = null;
      try {
        for (let count = 0; count < 5; count++) {
          const sentAt = Date.now();
          const response = await socket.timeout(2500).emitWithAck("clock:sync", { clientSentAt: sentAt });
          if (disposed || current !== generation) return;
          const sample = clockSample(response, sentAt, Date.now());
          if (sample && (!best || sample.roundTripMs < best.roundTripMs)) {
            best = sample;
            setOffsetMs(sample.offsetMs);
          }
        }
      } catch {
        // Retain the last usable estimate; retry periodically or through Sync now.
      } finally {
        if (current === generation) busy = false;
      }
    }
    function onConnect() {
      generation++;
      busy = false;
      setOffsetMs(null);
      void sampleClock();
    }
    function onDisconnect() { generation++; setOffsetMs(null); }
    refreshRef.current = sampleClock;
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) void sampleClock();
    const interval = window.setInterval(() => { void sampleClock(); }, 30000);
    return () => {
      disposed = true;
      generation++;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      window.clearInterval(interval);
      refreshRef.current = async () => {};
    };
  }, [socket]);

  return { offsetMs, refresh };
}
