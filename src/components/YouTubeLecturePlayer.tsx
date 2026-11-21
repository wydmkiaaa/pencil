import React, { useEffect, useId, useRef, useState } from 'react';
import { formatVideoTimestamp } from '../lib/spacedRepetition';

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v');
      }
      if (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/')) {
        return u.pathname.split('/')[2] || null;
      }
    }
    if (host === 'youtu.be') {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    return null;
  } catch {
    return null;
  }
}

interface YTPlayerInstance {
  getCurrentTime?: () => number;
  getDuration?: () => number;
  destroy?: () => void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayerInstance }) => void;
        onStateChange?: (e: { data: number; target: YTPlayerInstance }) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState?: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __pencilYtReadyQueue?: Array<() => void>;
  }
}

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window unavailable'));
      return;
    }
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    window.__pencilYtReadyQueue = window.__pencilYtReadyQueue || [];
    window.__pencilYtReadyQueue.push(() => {
      if (window.YT) resolve(window.YT);
    });

    const existingScript = document.querySelector('script[data-yt-iframe-api="1"]');
    if (!existingScript) {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        const queue = window.__pencilYtReadyQueue || [];
        window.__pencilYtReadyQueue = [];
        queue.forEach((cb) => cb());
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ytIframeApi = '1';
      script.onerror = () => reject(new Error('Failed to load YouTube player API'));
      document.head.appendChild(script);
    }
  });
}

interface YouTubeLecturePlayerProps {
  title: string;
  url: string;
  initialWatchedSeconds?: number;
  initialTotalSeconds?: number;
  onProgressChange: (watchedSeconds: number, totalSeconds: number) => void;
}

export const YouTubeLecturePlayer: React.FC<YouTubeLecturePlayerProps> = ({
  title,
  url,
  initialWatchedSeconds = 0,
  initialTotalSeconds = 0,
  onProgressChange,
}) => {
  const videoId = extractYouTubeVideoId(url);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerInstanceRef = useRef<YTPlayerInstance | null>(null);
  const onProgressRef = useRef(onProgressChange);
  onProgressRef.current = onProgressChange;

  const lastSavedRef = useRef<{ watched: number; total: number }>({
    watched: Math.round(initialWatchedSeconds),
    total: Math.round(initialTotalSeconds),
  });
  const [liveWatched, setLiveWatched] = useState(Math.round(initialWatchedSeconds));
  const [liveTotal, setLiveTotal] = useState(Math.round(initialTotalSeconds));
  const [apiFailed, setApiFailed] = useState(false);
  const playerDomId = useId().replace(/:/g, '_');

  useEffect(() => {
    setLiveWatched(Math.round(initialWatchedSeconds));
    setLiveTotal(Math.round(initialTotalSeconds));
    lastSavedRef.current = {
      watched: Math.round(initialWatchedSeconds),
      total: Math.round(initialTotalSeconds),
    };
  }, [url, initialWatchedSeconds, initialTotalSeconds]);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    let pollInterval: number | null = null;

    const flushProgress = (force = false) => {
      const inst = playerInstanceRef.current;
      if (!inst) return;
      const cur = Math.max(0, Math.round(inst.getCurrentTime?.() || 0));
      const dur = Math.max(0, Math.round(inst.getDuration?.() || lastSavedRef.current.total || 0));
      if (dur > 0) setLiveTotal(dur);
      setLiveWatched(cur);

      const prev = lastSavedRef.current;
      const watchedChanged = Math.abs(cur - prev.watched) >= (force ? 1 : 4);
      const totalChanged = dur > 0 && dur !== prev.total;
      if (watchedChanged || totalChanged) {
        lastSavedRef.current = { watched: cur, total: dur };
        onProgressRef.current(cur, dur);
      }
    };

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !playerHostRef.current) return;
        const startSec = Math.max(0, Math.floor(initialWatchedSeconds || 0));
        const hostEl = document.createElement('div');
        hostEl.id = `yt_${playerDomId}`;
        hostEl.className = 'w-full h-full';
        playerHostRef.current.innerHTML = '';
        playerHostRef.current.appendChild(hostEl);

        playerInstanceRef.current = new YT.Player(hostEl, {
          videoId,
          playerVars: {
            start: startSec,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              const dur = Math.round(e.target.getDuration?.() || 0);
              if (dur > 0) {
                setLiveTotal(dur);
                if (dur !== lastSavedRef.current.total) {
                  lastSavedRef.current = { watched: lastSavedRef.current.watched, total: dur };
                  onProgressRef.current(lastSavedRef.current.watched, dur);
                }
              }
            },
            onStateChange: (e) => {
              if (cancelled) return;
              // 1 = PLAYING, 2 = PAUSED, 0 = ENDED
              if (e.data === 1) {
                if (pollInterval === null) {
                  pollInterval = window.setInterval(() => flushProgress(false), 4000);
                }
              } else {
                if (pollInterval !== null) {
                  window.clearInterval(pollInterval);
                  pollInterval = null;
                }
                flushProgress(true);
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setApiFailed(true);
      });

    return () => {
      cancelled = true;
      if (pollInterval !== null) {
        window.clearInterval(pollInterval);
      }
      flushProgress(true);
      try {
        playerInstanceRef.current?.destroy?.();
      } catch {
        // ignore player cleanup error
      }
      playerInstanceRef.current = null;
    };
  }, [videoId, playerDomId]);

  if (!videoId) {
    return null;
  }

  const startSec = Math.max(0, Math.floor(initialWatchedSeconds || 0));
  const fallbackSrc = `https://www.youtube.com/embed/${videoId}?rel=0${startSec > 0 ? `&start=${startSec}` : ''}`;

  return (
    <div className="space-y-2">
      <div className="aspect-video rounded-2xl overflow-hidden border border-[var(--pastel-border)] bg-black">
        {apiFailed ? (
          <iframe
            src={fallbackSrc}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        ) : (
          <div ref={playerHostRef} className="w-full h-full" />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--pastel-muted)] px-1">
        <span className="font-semibold text-[var(--pastel-ink)] truncate max-w-md">{title}</span>
        <span className="font-mono-tabular">
          Watched till: {formatVideoTimestamp(liveWatched)}
          {liveTotal > 0 ? ` / Total: ${formatVideoTimestamp(liveTotal)}` : ''}
        </span>
      </div>
    </div>
  );
};
