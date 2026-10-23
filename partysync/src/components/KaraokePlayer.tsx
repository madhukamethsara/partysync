import { useEffect, useMemo, useRef, useState } from "react";
import YouTube from "react-youtube";
import type { PlaybackState } from "../shared/protocol";
import type { PartySocket } from "../socket";
import { GuestFollower, HostPublisher, SYNC_POLL_MS, type SyncPlayer } from "../sync/playback";
import { extractYoutubeId } from "../utils/youtube";

type Props = {
  videoId: string;
  playback: PlaybackState;
  isHost: boolean;
  canPublish: boolean;
  socket: PartySocket;
  clockOffset: number | null;
  refreshClock: () => Promise<void>;
  onPlayback: (playback: PlaybackState) => void;
};

type YouTubePlayer = SyncPlayer & {
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  getVideoUrl(): string;
};

export default function KaraokePlayer(props: Props) {
  const { videoId, isHost, canPublish, socket, clockOffset, refreshClock } = props;
  const [player, setPlayer] = useState<YouTubePlayer | null>(null);
  // react-youtube recreates the iframe whenever its videoId prop changes. Keep
  // that prop stable and cue subsequent songs through the existing native API.
  const [initialVideoId] = useState(videoId);
  const cuedVideoId = useRef(videoId);
  const [message, setMessage] = useState("Loading YouTube player…");
  const [needsStart, setNeedsStart] = useState(true);
  const [playerError, setPlayerError] = useState("");
  const latest = useRef(props);
  const publisher = useRef<HostPublisher | null>(null);
  const follower = useRef<GuestFollower | null>(null);
  const opts = useMemo(() => ({
    width: "100%", height: "100%",
    playerVars: { playsinline: 1, controls: isHost ? 1 : 0, disablekb: isHost ? 0 : 1,
      origin: window.location.origin },
  }), [isHost]);

  useEffect(() => { latest.current = props; });

  useEffect(() => {
    if (!player || playerError) return;
    if (isHost && !canPublish) return;
    const host = isHost ? new HostPublisher({
      player,
      playback: latest.current.playback,
      serverNow: () => latest.current.clockOffset === null ? null : Date.now() + latest.current.clockOffset,
      send: (update) => socket.timeout(5000).emitWithAck("playback:update", update),
      onPlayback: (playback) => latest.current.onPlayback(playback),
      onStatus: setMessage,
    }) : null;
    const guest = !isHost ? new GuestFollower({
      player,
      getPlayback: () => latest.current.playback,
      getVideoId: () => extractYoutubeId(player.getVideoUrl()),
      serverNow: () => latest.current.clockOffset === null ? null : Date.now() + latest.current.clockOffset,
      onStatus: setMessage,
      onNeedsStart: setNeedsStart,
    }) : null;
    publisher.current = host;
    follower.current = guest;

    function stateChanged() {
      if (host) host.publish();
      else guest?.sync();
    }
    const blocked = () => guest?.autoplayBlocked();
    player.addEventListener("onStateChange", stateChanged);
    player.addEventListener("onPlaybackRateChange", stateChanged);
    player.addEventListener("onAutoplayBlocked", blocked);
    const interval = window.setInterval(() => {
      try { host?.poll(); guest?.sync(); }
      catch { setMessage("Waiting for the video player…"); }
    }, SYNC_POLL_MS);
    return () => {
      window.clearInterval(interval);
      host?.dispose();
      guest?.dispose();
      publisher.current = null;
      follower.current = null;
      player.removeEventListener("onStateChange", stateChanged);
      player.removeEventListener("onPlaybackRateChange", stateChanged);
      player.removeEventListener("onAutoplayBlocked", blocked);
    };
  }, [player, playerError, isHost, canPublish, socket]);

  useEffect(() => {
    if (!player || cuedVideoId.current === videoId) return;
    cuedVideoId.current = videoId;
    setPlayerError("");
    setMessage("Loading the host's next song…");
    player.cueVideoById({ videoId, startSeconds: 0 });
  }, [player, videoId]);

  useEffect(() => {
    publisher.current?.accept(props.playback);
    follower.current?.sync();
  }, [props.playback, clockOffset]);

  function startFollowing() {
    // Call the IFrame API directly in the click handler to retain user activation.
    follower.current?.start();
  }

  function syncNow() {
    startFollowing();
    void refreshClock();
  }

  return (
    <section aria-label="Party playback">
      <YouTube
        videoId={initialVideoId}
        className="karaoke-player"
        iframeClassName="karaoke-frame"
        title="Shared karaoke song"
        opts={opts}
        onReady={(event) => {
          setMessage(isHost ? "Use the video controls to lead the party." : "Tap Join & Start to follow the host.");
          setPlayer(event.target as YouTubePlayer);
        }}
        onError={(event) => {
          setNeedsStart(true);
          const unavailable = [100, 101, 150, 153].includes(event.data);
          setPlayerError(unavailable
            ? "YouTube cannot play this video here. Ask the host to choose another song."
            : "The video could not load. Try another song or reload the page.");
        }}
      />
      <div className="playback-controls">
        <p className="playback-status" role={playerError ? "alert" : "status"}>
          {playerError || (!isHost && clockOffset === null ? "Connecting to the party clock…" : message)}
        </p>
        {!isHost && !playerError && (
          <>
            {needsStart && (
              <button type="button" onClick={startFollowing} disabled={!player || clockOffset === null}>
                Join &amp; Start
              </button>
            )}
            <button type="button" className="copy-btn" onClick={syncNow} disabled={!player}>
              Sync now
            </button>
            <p className="muted">The host controls playback.</p>
          </>
        )}
      </div>
    </section>
  );
}
