import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { formatDuration } from "../utils";
import { Waveform } from "./Waveform";

export interface AudioPlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

interface AudioPlayerProps {
  src: string;
  title: string;
  durationSeconds: number;
  peaks: number[];
}

const RATES = [1, 1.25, 1.5, 0.75];

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ src, title, durationSeconds, peaks }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(durationSeconds);
    const [rate, setRate] = useState(1);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      setCurrent(0);
      setDuration(durationSeconds);
      setPlaying(false);
      setError(null);
      const audio = audioRef.current;
      if (audio) {
        audio.playbackRate = rate;
      }
      // The source is the reset key; playback rate intentionally persists.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, durationSeconds]);

    useEffect(() => {
      if (audioRef.current) {
        audioRef.current.playbackRate = rate;
      }
    }, [rate]);

    const seekTo = (seconds: number, shouldPlay = false) => {
      const audio = audioRef.current;
      const bounded = Math.max(0, Math.min(duration, seconds));
      setCurrent(bounded);
      if (audio) {
        audio.currentTime = bounded;
        if (shouldPlay) {
          void audio.play().catch(() => {
            setError("Playback could not start in this browser.");
          });
        }
      }
    };

    useImperativeHandle(ref, () => ({
      seek: (seconds: number, play = false) => seekTo(seconds, play),
    }));

    const toggle = () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      if (audio.paused) {
        void audio.play().catch(() => {
          setError("Playback could not start in this browser.");
        });
      } else {
        audio.pause();
      }
    };

    const skip = (delta: number) => {
      seekTo(current + delta);
    };

    const progress = duration > 0 ? current / duration : 0;

    return (
      <div className="audio-player">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            const value = event.currentTarget.currentTime;
            if (Number.isFinite(value)) {
              setCurrent(value);
            }
          }}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) {
              setDuration(value);
            }
          }}
          onEnded={() => {
            setPlaying(false);
            setCurrent(duration);
          }}
          onError={() => {
            setError(
              "The audio could not be played. The file may have moved.",
            );
            setPlaying(false);
          }}
        />

        <div className="audio-player__stage">
          <button
            type="button"
            className="audio-player__toggle"
            onClick={toggle}
            aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          >
            {playing ? (
              <Pause size={22} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play
                size={22}
                fill="currentColor"
                aria-hidden="true"
                className="audio-player__play-icon"
              />
            )}
          </button>

          <div className="audio-player__wave">
            <Waveform peaks={peaks} progress={progress} />
            <input
              type="range"
              className="waveform-range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.01}
              value={Math.min(current, duration)}
              aria-label={`Seek through ${title}`}
              aria-valuetext={`${formatDuration(current)} of ${formatDuration(duration)}`}
              onChange={(event) => seekTo(Number(event.currentTarget.value))}
            />
          </div>
        </div>

        <div className="audio-player__controls">
          <div className="audio-player__time">
            <span className="tabular">{formatDuration(current)}</span>
            <span className="audio-player__time-rule" aria-hidden="true" />
            <span className="tabular">{formatDuration(duration)}</span>
          </div>
          <div className="audio-player__actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => skip(-10)}
              aria-label="Back 10 seconds"
              title="Back 10 seconds"
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => skip(10)}
              aria-label="Forward 10 seconds"
              title="Forward 10 seconds"
            >
              <RotateCw size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="speed-button"
              onClick={() => {
                const index = RATES.indexOf(rate);
                setRate(RATES[(index + 1) % RATES.length]);
              }}
              aria-label={`Playback speed ${rate} times. Change speed.`}
            >
              {rate}×
            </button>
          </div>
        </div>
        {error && (
          <p className="audio-player__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
