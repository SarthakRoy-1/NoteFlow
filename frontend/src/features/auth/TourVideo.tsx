import { type SyntheticEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { activeTheme, subscribeTheme } from '../../lib/theme';

const NARROW = '(max-width: 720px)';
const FILES = { landscape: '/tour/noteflow-tour', portrait: '/tour/noteflow-tour-vertical' };
/** Each file has a dark render (same timing, NoteFlow's dark palette) with a `-dark` suffix. */
const themed = (base: string, theme: 'light' | 'dark') =>
  theme === 'dark' ? `${base}-dark` : base;

/** What the poster shows, for people who cannot see it. */
const DESCRIPTION =
  'A note reading “Remind Priya to share the Q4 roadmap by Friday 5pm. Also finish the budget ' +
  'draft tomorrow.” NoteFlow finds a reminder for Friday at 5:00 pm and a todo for tomorrow.';

/**
 * The sign-in page's product demonstration: a still of the note and what NoteFlow finds in it,
 * which is also the first frame of the 23-second tour. Pressing it plays the tour in the same
 * frame, so nothing moves. The MP4 is not requested until then, and sound is part of the tour so
 * it only ever starts from a click. Self-hosted so the `default-src 'self'` policy allows it.
 * Light and dark renders follow the app's active theme, and only the one showing is fetched.
 */
export function TourVideo() {
  const [playing, setPlaying] = useState<'landscape' | 'portrait' | null>(null);
  const open = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const wasPlaying = useRef(false);
  const theme = useSyncExternalStore(subscribeTheme, activeTheme);
  // Where playback was, so a theme switch mid-tour resumes the other render at the same moment.
  const resume = useRef({ time: 0, paused: false });

  // The control that was pressed is replaced, so hand focus to what takes its place.
  useEffect(() => {
    if (playing) {
      wasPlaying.current = true;
      resume.current = { time: 0, paused: false };
      video.current?.focus();
    } else if (wasPlaying.current) {
      open.current?.focus();
    }
  }, [playing]);

  const file = themed(FILES[playing ?? 'landscape'], theme);

  // Only while the current file is loaded: a source swap resets time to 0 with readyState 0.
  const remember = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.readyState > 0) resume.current = { time: v.currentTime, paused: v.paused };
  };

  return (
    <figure className="login-demo">
      <div className="tour-stage">
        {playing ? (
          <>
            <video
              ref={video}
              src={`${file}.mp4`}
              controls
              autoPlay
              playsInline
              poster={`${file}.jpg`}
              onTimeUpdate={remember}
              onPause={remember}
              onPlay={remember}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (resume.current.time > 0) v.currentTime = resume.current.time;
                if (resume.current.paused) v.pause();
              }}
              aria-label="NoteFlow tour: a note becomes todos and reminders, then Ask AI answers from it"
            >
              <track
                kind="captions"
                src="/tour/noteflow-tour.vtt"
                srcLang="en"
                label="English"
                default
              />
            </video>
            <button type="button" className="tour-cue tour-close" onClick={() => setPlaying(null)}>
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path
                  d="m6 6 12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
              Hide the tour
            </button>
          </>
        ) : (
          <button
            ref={open}
            type="button"
            className="tour-open"
            aria-describedby="tour-description"
            onClick={() => {
              const narrow = window.matchMedia?.(NARROW).matches === true;
              setPlaying(narrow ? 'portrait' : 'landscape');
            }}
          >
            <picture>
              <source media={NARROW} srcSet={`${themed(FILES.portrait, theme)}.jpg`} />
              <img
                src={`${themed(FILES.landscape, theme)}.jpg`}
                alt=""
                width="1920"
                height="1080"
              />
            </picture>
            {/* Sits on the empty paper of the still, so the play control is part of the picture. */}
            <span className="tour-cue tour-play">
              <span className="tour-glyph" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                </svg>
              </span>
              <span className="tour-label">
                Watch the 23-second tour
                <span className="tour-meta">Plays with sound</span>
              </span>
            </span>
          </button>
        )}
      </div>
      <p id="tour-description" className="sr-only">
        {DESCRIPTION}
      </p>
    </figure>
  );
}
