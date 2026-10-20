import YouTube from "react-youtube";

export default function KaraokePlayer({ videoId }: { videoId: string }) {
  return (
    <YouTube
      key={videoId}
      videoId={videoId}
      className="karaoke-player"
      iframeClassName="karaoke-frame"
      title="Shared karaoke song"
      opts={{ width: "100%", height: "100%", playerVars: { playsinline: 1 } }}
    />
  );
}
