import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { WindowBounds } from '../electron-types';
import { getTodayDateKey } from '../shared/dates';
import { useNow, usePersistentState } from '../shared/persistence';
import { getLiveBellScheduleStatus, useBellScheduleState } from '../widgets/bellSchedule';
import type { TimerSnapshot } from '../widgets/timer';
import { DEFAULT_TIMER, hasUnacknowledgedTimerCompletion, normalizeTimerSnapshot, useTimerSoundAlerts } from '../widgets/timer';

/**
 * Ticks every second only while a live period needs a countdown; otherwise a
 * lazy 15s tick keeps the dot cheap — it previously re-rendered 1×/sec forever.
 */
function useAdaptiveClockNow(bellSchedule: ReturnType<typeof useBellScheduleState>[0]) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const isHot = Boolean(getLiveBellScheduleStatus(bellSchedule, now)?.isActive);
    const interval = window.setInterval(() => setNow(Date.now()), isHot ? 1000 : 15_000);
    return () => window.clearInterval(interval);
  }, [bellSchedule, now]);

  return now;
}

export function OverlayDot() {
  const overlayBoundsRef = useRef<WindowBounds>({
    x: 0,
    y: 0,
    width: 86,
    height: 86
  });
  const [timer, setTimer] = usePersistentState<TimerSnapshot>('teacher-tools.timer', DEFAULT_TIMER, {
    normalize: normalizeTimerSnapshot
  });
  const dragStateRef = useRef<{
    moved: boolean;
    pointerId: number;
    startBounds: WindowBounds;
    startPointerX: number;
    startPointerY: number;
  } | null>(null);
  const pendingOverlayPositionRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDragAnimationFrameRef = useRef<number | null>(null);
  const notifiedPeriodAlertsRef = useRef<Set<string>>(new Set());
  const [bellSchedule] = useBellScheduleState();
  const clockNow = useAdaptiveClockNow(bellSchedule);
  const now = useNow(timer.endsAt);
  const remainingMs = timer.endsAt ? Math.max(timer.endsAt - now, 0) : timer.pausedRemainingMs;
  const isTimerAlertActive = hasUnacknowledgedTimerCompletion(timer);
  useTimerSoundAlerts(timer, remainingMs, setTimer);
  const liveBellStatus = getLiveBellScheduleStatus(bellSchedule, clockNow);
  const liveBellRemainingMinutes = liveBellStatus
    ? Math.max(1, Math.ceil(liveBellStatus.remainingMs / 60000))
    : 0;
  const showPeriodCountdown = Boolean(liveBellStatus?.isActive) && !isTimerAlertActive;

  useEffect(() => {
    const endOfPeriodAlert = bellSchedule.endOfPeriodAlert;

    if (!endOfPeriodAlert.enabled || !liveBellStatus?.isActive) {
      return;
    }

    const thresholdMs = endOfPeriodAlert.minutesBefore * 60 * 1000;

    if (liveBellStatus.remainingMs > thresholdMs || liveBellStatus.remainingMs <= 0) {
      return;
    }

    const alertKey = `${getTodayDateKey()}:${liveBellStatus.definition.id}`;

    if (notifiedPeriodAlertsRef.current.has(alertKey)) {
      return;
    }

    notifiedPeriodAlertsRef.current.add(alertKey);

    try {
      const minutesLeft = Math.max(1, Math.ceil(liveBellStatus.remainingMs / 60000));
      new Notification('TeacherTools', {
        body: `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} left in ${liveBellStatus.definition.label}.`
      });
    } catch {
      // Notifications are best-effort; ignore platforms that block them.
    }
  }, [bellSchedule.endOfPeriodAlert, liveBellStatus]);

  const setOverlayInteractive = (interactive: boolean) => {
    window.electronAPI?.setOverlayInteractive(interactive);
  };

  useEffect(() => {
    window.electronAPI?.getOverlayBounds().then((bounds) => {
      overlayBoundsRef.current = bounds;
    });

    setOverlayInteractive(false);

    return () => {
      if (overlayDragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayDragAnimationFrameRef.current);
      }

      setOverlayInteractive(false);
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (!window.electronAPI) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.screenX,
      startPointerY: event.screenY,
      startBounds: overlayBoundsRef.current,
      moved: false
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - dragState.startPointerX;
    const deltaY = event.screenY - dragState.startPointerY;

    if (!dragState.moved && Math.hypot(deltaX, deltaY) >= 6) {
      dragState.moved = true;
    }

    if (!dragState.moved) {
      return;
    }

    const nextBounds = {
      ...dragState.startBounds,
      x: Math.round(dragState.startBounds.x + deltaX),
      y: Math.round(dragState.startBounds.y + deltaY)
    };

    overlayBoundsRef.current = nextBounds;
    pendingOverlayPositionRef.current = {
      x: nextBounds.x,
      y: nextBounds.y
    };

    if (overlayDragAnimationFrameRef.current === null) {
      overlayDragAnimationFrameRef.current = window.requestAnimationFrame(() => {
        overlayDragAnimationFrameRef.current = null;
        const pendingPosition = pendingOverlayPositionRef.current;
        pendingOverlayPositionRef.current = null;

        if (pendingPosition) {
          window.electronAPI?.setOverlayPosition(pendingPosition);
        }
      });
    }
  };

  const finishPointerInteraction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - dragState.startPointerX;
    const deltaY = event.screenY - dragState.startPointerY;
    const dragged = dragState.moved || Math.hypot(deltaX, deltaY) >= 6;

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!dragged) {
      setTimer((current) =>
        hasUnacknowledgedTimerCompletion(current)
          ? {
              ...current,
              lastCompletionAcknowledgedAt: current.lastCompletedAt
            }
          : current
      );
      window.electronAPI?.togglePopover();
    }
  };

  const cancelPointerInteraction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <main
      className="overlay-shell"
      onMouseLeave={() => {
        if (!dragStateRef.current) {
          setOverlayInteractive(false);
        }
      }}
    >
      <div className="overlay-shell__dock">
        <button
          aria-label="Open teacher tools"
          className={`overlay-dot${isTimerAlertActive ? ' overlay-dot--timer-alert' : ''}`}
          onMouseEnter={() => {
            setOverlayInteractive(true);
          }}
          onMouseMove={() => {
            setOverlayInteractive(true);
          }}
          onPointerCancel={cancelPointerInteraction}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerInteraction}
          type="button"
        >
          <span
            aria-hidden="true"
            className="overlay-dot__alert"
          />
          {isTimerAlertActive && timer.label ? (
            <span className="overlay-dot__alert-label" title={timer.label}>
              {timer.label}
            </span>
          ) : null}
          {showPeriodCountdown && liveBellStatus ? (
            <span
              aria-label={`${liveBellRemainingMinutes} minutes left in ${liveBellStatus.definition.label}`}
              className="overlay-dot__period"
            >
              {liveBellStatus.definition.shortLabel} · {liveBellRemainingMinutes}m
            </span>
          ) : null}
          <svg
            aria-hidden="true"
            className="overlay-dot__art"
            viewBox="0 0 86 86"
          >
            <defs>
              <radialGradient id="overlay-dot-ambient" cx="50%" cy="50%" r="50%">
                <stop
                  offset="0%"
                  stopColor="rgba(215, 255, 246, 0.95)"
                />
                <stop
                  offset="18%"
                  stopColor="rgba(171, 255, 239, 0.82)"
                />
                <stop
                  offset="44%"
                  stopColor="rgba(103, 245, 225, 0.46)"
                />
                <stop
                  offset="68%"
                  stopColor="rgba(44, 170, 180, 0.18)"
                />
                <stop
                  offset="100%"
                  stopColor="rgba(44, 170, 180, 0)"
                />
              </radialGradient>
              <radialGradient id="overlay-dot-core" cx="34%" cy="30%" r="58%">
                <stop
                  offset="0%"
                  stopColor="#ffffff"
                />
                <stop
                  offset="28%"
                  stopColor="rgba(241, 255, 251, 0.98)"
                />
                <stop
                  offset="60%"
                  stopColor="rgba(145, 242, 223, 0.9)"
                />
                <stop
                  offset="100%"
                  stopColor="rgba(72, 187, 191, 0.84)"
                />
              </radialGradient>
              <radialGradient id="overlay-dot-highlight" cx="50%" cy="50%" r="50%">
                <stop
                  offset="0%"
                  stopColor="rgba(255, 255, 255, 0.94)"
                />
                <stop
                  offset="100%"
                  stopColor="rgba(255, 255, 255, 0)"
                />
              </radialGradient>
              <filter
                id="overlay-dot-blur"
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feGaussianBlur stdDeviation="5.5" />
              </filter>
              <filter
                id="overlay-dot-soft-blur"
                x="-22%"
                y="-22%"
                width="144%"
                height="144%"
              >
                <feGaussianBlur stdDeviation="2.6" />
              </filter>
            </defs>
            <circle
              cx="43"
              cy="43"
              r="28"
              fill="url(#overlay-dot-ambient)"
              filter="url(#overlay-dot-blur)"
              opacity="0.95"
            />
            <circle
              cx="43"
              cy="43"
              r="24"
              fill="url(#overlay-dot-ambient)"
              filter="url(#overlay-dot-soft-blur)"
              opacity="0.82"
            />
            <circle
              cx="43"
              cy="43"
              r="22"
              fill="url(#overlay-dot-core)"
            />
            <circle
              cx="35.5"
              cy="35"
              r="9"
              fill="url(#overlay-dot-highlight)"
              opacity="0.78"
            />
          </svg>
        </button>

        <button
          aria-label="Hide or quit TeacherTools"
          className="overlay-exit"
          onClick={(event) => {
            event.stopPropagation();
            if (window.electronAPI?.showOverlayMenu) {
              window.electronAPI.showOverlayMenu();
            } else {
              window.electronAPI?.quitApp();
            }
          }}
          type="button"
        >
          ×
        </button>
      </div>
    </main>
  );
}
