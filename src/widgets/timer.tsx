import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react';
import type { AppSettings, TimerChimeSound, TimerSpeechVoice, WindowBounds } from '../electron-types';
import { useAppSettingsState } from '../app/appSettings';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { useNow, usePersistentState } from '../shared/persistence';
import { announce } from '../shared/uiKit';
import { clampNumber, formatDuration } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { WidgetSizeTier } from './dashboard';
import { WIDGET_DETAILS } from './registry';

export type TimerMode = 'countdown' | 'stopwatch';

export type TimerSnapshot = {
  baseDurationMs: number;
  endsAt: number | null;
  lastCompletionAcknowledgedAt: number | null;
  pausedRemainingMs: number;
  isPaused: boolean;
  lastCompletedAt: number | null;
  label: string;
  mode: TimerMode;
  stopwatchStartedAt: number | null;
  stopwatchAccumulatedMs: number;
  presetsMinutes: number[];
  repeatCount: number;
  currentRound: number;
  finalWarningMinutes: number;
  halfwayWarningEnabled: boolean;
};

export type TimerSoundAlertKind = 'done' | 'half' | 'ten-percent';

export type TimerAlertPreferences = Pick<
  AppSettings,
  'timerChimeEnabled' | 'timerChimeSound' | 'timerSpeechVoice' | 'timerVoiceEnabled'
>;

export const DEFAULT_TIMER_PRESET_MINUTES = [2, 5, 10, 15];

export const TIMER_PRESET_MIN_MINUTES = 1;

export const TIMER_REPEAT_MAX_ROUNDS = 12;

export const TIMER_FINAL_WARNING_MAX_MINUTES = 10;

export const DEFAULT_TIMER_FINAL_WARNING_MINUTES = 2;

export const CUSTOM_TIMER_MAX_MINUTES = 60;

export const CUSTOM_TIMER_SHORT_SECONDS = [10, 15, 30, 45];

export const TIMER_LABEL_MAX_LENGTH = 60;

export const TIMER_CHIME_SOUND_OPTIONS: { id: TimerChimeSound; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'bells', label: 'Bells' },
  { id: 'beeps', label: 'Beeps' },
  { id: 'chirp', label: 'Chirp' }
];

export const DEFAULT_TIMER: TimerSnapshot = {
  baseDurationMs: 5 * 60 * 1000,
  endsAt: null,
  lastCompletionAcknowledgedAt: null,
  pausedRemainingMs: 5 * 60 * 1000,
  isPaused: false,
  lastCompletedAt: null,
  label: '',
  mode: 'countdown',
  stopwatchStartedAt: null,
  stopwatchAccumulatedMs: 0,
  presetsMinutes: DEFAULT_TIMER_PRESET_MINUTES,
  repeatCount: 1,
  currentRound: 1,
  finalWarningMinutes: DEFAULT_TIMER_FINAL_WARNING_MINUTES,
  halfwayWarningEnabled: true
};

export function normalizeTimerChimeSound(value: unknown): TimerChimeSound {
  return value === 'bells' || value === 'beeps' || value === 'chirp' ? value : 'classic';
}

export function normalizeTimerSnapshot(raw: unknown, initialValue: TimerSnapshot): TimerSnapshot {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as Partial<TimerSnapshot>;
  const baseDurationMs =
    typeof nextRaw.baseDurationMs === 'number' && Number.isFinite(nextRaw.baseDurationMs)
      ? nextRaw.baseDurationMs
      : initialValue.baseDurationMs;
  const pausedRemainingMs =
    typeof nextRaw.pausedRemainingMs === 'number' && Number.isFinite(nextRaw.pausedRemainingMs)
      ? nextRaw.pausedRemainingMs
      : baseDurationMs;
  const endsAt =
    typeof nextRaw.endsAt === 'number' && Number.isFinite(nextRaw.endsAt) ? nextRaw.endsAt : null;
  const lastCompletedAt =
    typeof nextRaw.lastCompletedAt === 'number' && Number.isFinite(nextRaw.lastCompletedAt)
      ? nextRaw.lastCompletedAt
      : null;
  const presetsMinutes = DEFAULT_TIMER_PRESET_MINUTES.map((fallbackMinutes, index) => {
    const value = Array.isArray(nextRaw.presetsMinutes) ? nextRaw.presetsMinutes[index] : undefined;
    return typeof value === 'number' && Number.isFinite(value)
      ? clampNumber(Math.round(value), TIMER_PRESET_MIN_MINUTES, CUSTOM_TIMER_MAX_MINUTES)
      : fallbackMinutes;
  });
  const repeatCount =
    typeof nextRaw.repeatCount === 'number' && Number.isFinite(nextRaw.repeatCount)
      ? clampNumber(Math.round(nextRaw.repeatCount), 1, TIMER_REPEAT_MAX_ROUNDS)
      : 1;

  return {
    baseDurationMs,
    endsAt,
    lastCompletionAcknowledgedAt:
      typeof nextRaw.lastCompletionAcknowledgedAt === 'number' &&
      Number.isFinite(nextRaw.lastCompletionAcknowledgedAt)
        ? nextRaw.lastCompletionAcknowledgedAt
        : null,
    pausedRemainingMs,
    isPaused:
      typeof nextRaw.isPaused === 'boolean'
        ? nextRaw.isPaused
        : endsAt === null &&
          lastCompletedAt === null &&
          pausedRemainingMs > 0 &&
          pausedRemainingMs < baseDurationMs,
    lastCompletedAt,
    label: typeof nextRaw.label === 'string' ? nextRaw.label.slice(0, TIMER_LABEL_MAX_LENGTH) : '',
    mode: nextRaw.mode === 'stopwatch' ? 'stopwatch' : 'countdown',
    stopwatchStartedAt:
      typeof nextRaw.stopwatchStartedAt === 'number' && Number.isFinite(nextRaw.stopwatchStartedAt)
        ? nextRaw.stopwatchStartedAt
        : null,
    stopwatchAccumulatedMs:
      typeof nextRaw.stopwatchAccumulatedMs === 'number' &&
      Number.isFinite(nextRaw.stopwatchAccumulatedMs)
        ? Math.max(nextRaw.stopwatchAccumulatedMs, 0)
        : 0,
    presetsMinutes,
    repeatCount,
    currentRound:
      typeof nextRaw.currentRound === 'number' && Number.isFinite(nextRaw.currentRound)
        ? clampNumber(Math.round(nextRaw.currentRound), 1, repeatCount)
        : 1,
    finalWarningMinutes:
      typeof nextRaw.finalWarningMinutes === 'number' && Number.isFinite(nextRaw.finalWarningMinutes)
        ? clampNumber(Math.round(nextRaw.finalWarningMinutes), 0, TIMER_FINAL_WARNING_MAX_MINUTES)
        : DEFAULT_TIMER_FINAL_WARNING_MINUTES,
    halfwayWarningEnabled:
      typeof nextRaw.halfwayWarningEnabled === 'boolean' ? nextRaw.halfwayWarningEnabled : true
  };
}

export function hasUnacknowledgedTimerCompletion(timer: Pick<TimerSnapshot, 'lastCompletedAt' | 'lastCompletionAcknowledgedAt'>) {
  return (
    timer.lastCompletedAt !== null &&
    timer.lastCompletedAt !== (timer.lastCompletionAcknowledgedAt ?? null)
  );
}

export function formatTimerRunDurationLabel(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export const TIMER_SOUND_ALERT_CLAIMS_KEY = 'teacher-tools.timer-sound-alert-claims';

export const TIMER_BROWSER_VOICE_CANDIDATES: Record<TimerSpeechVoice, string[]> = {
  female: ['samantha', 'karen', 'flo', 'shelley'],
  male: ['daniel', 'reed', 'eddy', 'ralph', 'albert', 'alex']
};

export const timerSoundFallbackClaims = new Set<string>();

export let timerAudioContext: AudioContext | null = null;

export let activeTimerSpeechUtterance: SpeechSynthesisUtterance | null = null;

export function getTimerSoundRunKey(timer: Pick<TimerSnapshot, 'baseDurationMs' | 'endsAt'>) {
  return timer.endsAt === null ? null : `${timer.endsAt}:${timer.baseDurationMs}`;
}

export function claimTimerSoundAlert(runKey: string, kind: TimerSoundAlertKind) {
  const claimKey = `${runKey}:${kind}`;

  try {
    const rawClaims = window.localStorage.getItem(TIMER_SOUND_ALERT_CLAIMS_KEY);
    const parsedClaims = rawClaims ? JSON.parse(rawClaims) : {};
    const claims =
      parsedClaims && typeof parsedClaims === 'object'
        ? (parsedClaims as Record<string, number>)
        : {};

    if (claims[claimKey]) {
      return false;
    }

    const now = Date.now();
    const freshClaims = Object.fromEntries(
      Object.entries(claims)
        .filter(([, claimedAt]) => typeof claimedAt === 'number' && now - claimedAt < 24 * 60 * 60 * 1000)
        .slice(-64)
    );

    freshClaims[claimKey] = now;
    window.localStorage.setItem(TIMER_SOUND_ALERT_CLAIMS_KEY, JSON.stringify(freshClaims));
    return true;
  } catch {
    if (timerSoundFallbackClaims.has(claimKey)) {
      return false;
    }

    timerSoundFallbackClaims.add(claimKey);
    return true;
  }
}

export function getTimerAudioContext() {
  if (!timerAudioContext) {
    timerAudioContext = new AudioContext();
  }

  return timerAudioContext;
}

export function primeTimerAudio() {
  try {
    void getTimerAudioContext().resume();
  } catch {
    // Audio can be unavailable in restricted renderer contexts.
  }
}

export function formatTimerSpeechDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export function getTimerSpeechMessage(
  kind: TimerSoundAlertKind,
  alertRemainingMs?: number,
  timerRunLabel?: string
) {
  if (kind === 'done') {
    return timerRunLabel ? `Time is up for ${timerRunLabel}` : 'Time is up';
  }

  const timeRemaining = formatTimerSpeechDuration(alertRemainingMs ?? 0);
  return kind === 'half'
    ? `Halfway, ${timeRemaining} remaining`
    : `${timeRemaining} remaining`;
}

export function getPreferredBrowserTimerVoice(voice: TimerSpeechVoice) {
  if (!('speechSynthesis' in window)) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();

  if (voices.length === 0) {
    return null;
  }

  const englishVoices = voices.filter((candidate) => candidate.lang.toLowerCase().startsWith('en'));
  const voicePool = englishVoices.length > 0 ? englishVoices : voices;
  const preferredNames = TIMER_BROWSER_VOICE_CANDIDATES[voice];

  for (const preferredName of preferredNames) {
    const matchedVoice = voicePool.find((candidate) =>
      candidate.name.toLowerCase().includes(preferredName)
    );

    if (matchedVoice) {
      return matchedVoice;
    }
  }

  return voicePool.find((candidate) => candidate.default) ?? voicePool[0] ?? null;
}

export function speakTimerAlertWithBrowserVoice(
  message: string,
  kind: TimerSoundAlertKind,
  voice: TimerSpeechVoice
) {
  try {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(message);
    const selectedVoice = getPreferredBrowserTimerVoice(voice);

    utterance.lang = selectedVoice?.lang || 'en-US';
    utterance.rate = kind === 'done' ? 0.82 : 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    utterance.onend = () => {
      if (activeTimerSpeechUtterance === utterance) {
        activeTimerSpeechUtterance = null;
      }
    };
    utterance.onerror = () => {
      if (activeTimerSpeechUtterance === utterance) {
        activeTimerSpeechUtterance = null;
      }
    };
    activeTimerSpeechUtterance = utterance;
    window.speechSynthesis.cancel();
    window.setTimeout(() => window.speechSynthesis.speak(utterance), 0);
  } catch {
    // Speech is optional and shouldn't block the visual timer state.
  }
}

export function speakTimerAlert(
  kind: TimerSoundAlertKind,
  timerSpeechVoice: TimerSpeechVoice,
  alertRemainingMs?: number,
  timerRunLabel?: string
) {
  const message = getTimerSpeechMessage(kind, alertRemainingMs, timerRunLabel);
  const speakWithBrowserVoice = () => speakTimerAlertWithBrowserVoice(message, kind, timerSpeechVoice);
  const speakTimerAlertWithNativeVoice = window.electronAPI?.speakTimerAlert;

  if (!speakTimerAlertWithNativeVoice) {
    speakWithBrowserVoice();
    return;
  }

  void speakTimerAlertWithNativeVoice(message)
    .then((didSpeak) => {
      if (!didSpeak) {
        speakWithBrowserVoice();
      }
    })
    .catch(() => {
      speakWithBrowserVoice();
    });
}

type TimerChimeNote = {
  duration: number;
  frequency: number;
  offset: number;
  sweepTo?: number;
};

type TimerChimeSpec = {
  oscillator: OscillatorType;
  peak: number;
  notes: TimerChimeNote[];
};

const TIMER_CHIME_SPECS: Record<TimerChimeSound, Record<TimerSoundAlertKind, TimerChimeSpec>> = {
  classic: {
    done: {
      oscillator: 'square',
      peak: 0.34,
      notes: [
        { duration: 0.18, frequency: 784, offset: 0 },
        { duration: 0.18, frequency: 988, offset: 0.2 },
        { duration: 0.18, frequency: 1175, offset: 0.4 },
        { duration: 0.42, frequency: 1568, offset: 0.62 }
      ]
    },
    half: {
      oscillator: 'triangle',
      peak: 0.24,
      notes: [
        { duration: 0.2, frequency: 523, offset: 0 },
        { duration: 0.2, frequency: 659, offset: 0.22 },
        { duration: 0.28, frequency: 784, offset: 0.44 }
      ]
    },
    'ten-percent': {
      oscillator: 'square',
      peak: 0.24,
      notes: [
        { duration: 0.12, frequency: 880, offset: 0 },
        { duration: 0.12, frequency: 1319, offset: 0.14 },
        { duration: 0.12, frequency: 880, offset: 0.28 },
        { duration: 0.22, frequency: 1319, offset: 0.42 }
      ]
    }
  },
  bells: {
    done: {
      oscillator: 'sine',
      peak: 0.42,
      notes: [
        { duration: 0.9, frequency: 523, offset: 0 },
        { duration: 0.9, frequency: 659, offset: 0.34 },
        { duration: 1.1, frequency: 784, offset: 0.68 },
        { duration: 1.6, frequency: 1047, offset: 1.02 }
      ]
    },
    half: {
      oscillator: 'sine',
      peak: 0.32,
      notes: [
        { duration: 0.8, frequency: 659, offset: 0 },
        { duration: 1.1, frequency: 784, offset: 0.4 }
      ]
    },
    'ten-percent': {
      oscillator: 'sine',
      peak: 0.32,
      notes: [
        { duration: 0.5, frequency: 880, offset: 0 },
        { duration: 0.9, frequency: 1047, offset: 0.3 }
      ]
    }
  },
  beeps: {
    done: {
      oscillator: 'square',
      peak: 0.3,
      notes: [
        { duration: 0.09, frequency: 1245, offset: 0 },
        { duration: 0.09, frequency: 1245, offset: 0.16 },
        { duration: 0.09, frequency: 1245, offset: 0.32 },
        { duration: 0.3, frequency: 1245, offset: 0.55 }
      ]
    },
    half: {
      oscillator: 'square',
      peak: 0.22,
      notes: [
        { duration: 0.09, frequency: 932, offset: 0 },
        { duration: 0.09, frequency: 932, offset: 0.16 }
      ]
    },
    'ten-percent': {
      oscillator: 'square',
      peak: 0.22,
      notes: [
        { duration: 0.07, frequency: 1109, offset: 0 },
        { duration: 0.07, frequency: 1109, offset: 0.12 },
        { duration: 0.07, frequency: 1109, offset: 0.24 }
      ]
    }
  },
  chirp: {
    done: {
      oscillator: 'triangle',
      peak: 0.3,
      notes: [
        { duration: 0.32, frequency: 523, offset: 0, sweepTo: 1568 },
        { duration: 0.32, frequency: 659, offset: 0.38, sweepTo: 1976 },
        { duration: 0.5, frequency: 784, offset: 0.76, sweepTo: 2349 }
      ]
    },
    half: {
      oscillator: 'triangle',
      peak: 0.24,
      notes: [{ duration: 0.3, frequency: 523, offset: 0, sweepTo: 1047 }]
    },
    'ten-percent': {
      oscillator: 'triangle',
      peak: 0.24,
      notes: [
        { duration: 0.2, frequency: 659, offset: 0, sweepTo: 1319 },
        { duration: 0.2, frequency: 659, offset: 0.28, sweepTo: 1319 }
      ]
    }
  }
};

export function playTimerChime(kind: TimerSoundAlertKind, sound: TimerChimeSound = 'classic') {
  try {
    const audioContext = getTimerAudioContext();
    void audioContext.resume();
    const startedAt = audioContext.currentTime + 0.02;
    const spec = TIMER_CHIME_SPECS[normalizeTimerChimeSound(sound)][kind];

    spec.notes.forEach((note) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const noteStart = startedAt + note.offset;
      const noteEnd = noteStart + note.duration;

      oscillator.type = spec.oscillator;
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      if (note.sweepTo) {
        oscillator.frequency.exponentialRampToValueAtTime(note.sweepTo, noteEnd);
      }
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(spec.peak, noteStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    });
  } catch {
    // The visual timer state still completes even if sound playback is blocked.
  }
}

export function triggerTimerAlert(
  kind: TimerSoundAlertKind,
  alertPreferences: TimerAlertPreferences,
  alertRemainingMs?: number,
  timerRunLabel?: string
) {
  if (alertPreferences.timerChimeEnabled) {
    playTimerChime(kind, alertPreferences.timerChimeSound);
  }

  if (!alertPreferences.timerVoiceEnabled) {
    return;
  }

  const speechDelayMs = alertPreferences.timerChimeEnabled ? (kind === 'done' ? 1050 : 700) : 0;
  window.setTimeout(
    () => speakTimerAlert(kind, alertPreferences.timerSpeechVoice, alertRemainingMs, timerRunLabel),
    speechDelayMs
  );
}

export function useTimerSoundAlerts(
  timer: TimerSnapshot,
  remainingMs: number,
  setTimer: ReturnType<typeof usePersistentState<TimerSnapshot>>[1]
) {
  const [appSettings] = useAppSettingsState();
  const isRunning = timer.endsAt !== null && remainingMs > 0;
  const announcedAlertsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (appSettings.timerVoiceEnabled || !('speechSynthesis' in window)) {
      return;
    }

    activeTimerSpeechUtterance = null;
    window.speechSynthesis.cancel();
  }, [appSettings.timerVoiceEnabled]);

  useEffect(() => {
    if (!isRunning || timer.baseDurationMs <= 0) {
      return;
    }

    const runKey = getTimerSoundRunKey(timer);
    if (!runKey) {
      return;
    }

    const finalWarningRemainingMs = timer.finalWarningMinutes * 60 * 1000;
    const halfwayRemainingMs = timer.baseDurationMs * 0.5;

    if (
      finalWarningRemainingMs > 0 &&
      finalWarningRemainingMs < timer.baseDurationMs &&
      remainingMs <= finalWarningRemainingMs
    ) {
      if (claimTimerSoundAlert(runKey, 'ten-percent')) {
        triggerTimerAlert('ten-percent', appSettings, finalWarningRemainingMs);
      }

      if (!announcedAlertsRef.current.has(`${runKey}:final`)) {
        announcedAlertsRef.current.add(`${runKey}:final`);
        announce(getTimerSpeechMessage('ten-percent', finalWarningRemainingMs));
      }
      return;
    }

    if (
      timer.halfwayWarningEnabled &&
      remainingMs <= halfwayRemainingMs &&
      claimTimerSoundAlert(runKey, 'half')
    ) {
      triggerTimerAlert('half', appSettings, halfwayRemainingMs);
    }
  }, [appSettings, isRunning, remainingMs, timer]);

  useEffect(() => {
    if (!timer.endsAt || remainingMs !== 0) {
      return;
    }

    const runKey = getTimerSoundRunKey(timer);
    if (runKey && claimTimerSoundAlert(runKey, 'done')) {
      triggerTimerAlert('done', appSettings, undefined, timer.label);
    }

    if (runKey && !announcedAlertsRef.current.has(`${runKey}:done`)) {
      announcedAlertsRef.current.add(`${runKey}:done`);
      const isRepeating = timer.repeatCount > 1 && timer.currentRound < timer.repeatCount;
      announce(
        isRepeating
          ? `Round ${timer.currentRound} finished. Starting round ${timer.currentRound + 1} of ${timer.repeatCount}`
          : getTimerSpeechMessage('done', undefined, timer.label)
      );
    }

    setTimer((current) => {
      if (current.endsAt === null || current.endsAt > Date.now()) {
        return current;
      }

      if (current.repeatCount > 1 && current.currentRound < current.repeatCount) {
        return {
          ...current,
          endsAt: Date.now() + current.baseDurationMs,
          pausedRemainingMs: current.baseDurationMs,
          isPaused: false,
          currentRound: current.currentRound + 1,
          lastCompletedAt: null
        };
      }

      return {
        ...current,
        endsAt: null,
        pausedRemainingMs: 0,
        isPaused: false,
        currentRound: 1,
        lastCompletedAt: Date.now()
      };
    });
  }, [appSettings, remainingMs, setTimer, timer]);
}

export function getCustomTimerDurationMs(customTimerMinutes: number) {
  return Math.round(customTimerMinutes * 60) * 1000;
}

export function getCustomTimerLabel(customTimerMinutes: number) {
  const totalSeconds = Math.round(customTimerMinutes * 60);
  if (totalSeconds <= 0) {
    return '0';
  }

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = totalSeconds / 60;
  return Number.isInteger(minutes) ? `${minutes}` : `${minutes.toFixed(1)}m`;
}

export function getCustomTimerAriaLabel(customTimerMinutes: number) {
  const totalSeconds = Math.round(customTimerMinutes * 60);
  if (totalSeconds <= 0) {
    return 'Custom timer is not set';
  }

  if (totalSeconds < 60) {
    return `Use ${totalSeconds} second custom timer`;
  }

  const minutes = totalSeconds / 60;
  return `Use ${minutes} minute custom timer`;
}

export function normalizeCustomTimerMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const totalSeconds = Math.round(value * 60);
  if (totalSeconds < 60) {
    const nearestShortSecond =
      CUSTOM_TIMER_SHORT_SECONDS.find((seconds) => totalSeconds <= seconds) ??
      CUSTOM_TIMER_SHORT_SECONDS[CUSTOM_TIMER_SHORT_SECONDS.length - 1];
    return nearestShortSecond / 60;
  }

  return clampNumber(Math.round(totalSeconds / 60), 1, CUSTOM_TIMER_MAX_MINUTES);
}

export function getNextCustomTimerMinutes(customTimerMinutes: number) {
  const totalSeconds = Math.round(customTimerMinutes * 60);
  if (totalSeconds <= 0) {
    return CUSTOM_TIMER_SHORT_SECONDS[0] / 60;
  }

  if (totalSeconds < 60) {
    const nextShortSecond = CUSTOM_TIMER_SHORT_SECONDS.find((seconds) => seconds > totalSeconds);
    return nextShortSecond ? nextShortSecond / 60 : 1;
  }

  return clampNumber(Math.round(totalSeconds / 60) + 1, 1, CUSTOM_TIMER_MAX_MINUTES);
}

export function getPreviousCustomTimerMinutes(customTimerMinutes: number) {
  const totalSeconds = Math.round(customTimerMinutes * 60);
  if (totalSeconds <= CUSTOM_TIMER_SHORT_SECONDS[0]) {
    return 0;
  }

  if (totalSeconds <= 60) {
    const previousShortSeconds = [...CUSTOM_TIMER_SHORT_SECONDS]
      .reverse()
      .find((seconds) => seconds < totalSeconds);
    return previousShortSeconds ? previousShortSeconds / 60 : 0;
  }

  return Math.round(totalSeconds / 60) - 1;
}

const HOLD_REPEAT_INITIAL_DELAY_MS = 400;

const HOLD_REPEAT_INTERVAL_MS = 80;

const HOLD_REPEAT_MIN_INTERVAL_MS = 45;

function HoldRepeatButton({
  children,
  onStep,
  ...buttonProps
}: { onStep: () => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>) {
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const repeatTimeoutRef = useRef<number | null>(null);
  const didHoldRepeatRef = useRef(false);

  const stopRepeat = useCallback(() => {
    if (repeatTimeoutRef.current !== null) {
      window.clearTimeout(repeatTimeoutRef.current);
      repeatTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => stopRepeat, [stopRepeat]);

  const scheduleRepeat = (delayMs: number) => {
    repeatTimeoutRef.current = window.setTimeout(() => {
      didHoldRepeatRef.current = true;
      stepRef.current();
      scheduleRepeat(
        delayMs > HOLD_REPEAT_INTERVAL_MS
          ? HOLD_REPEAT_INTERVAL_MS
          : Math.max(delayMs * 0.92, HOLD_REPEAT_MIN_INTERVAL_MS)
      );
    }, delayMs);
  };

  return (
    <button
      {...buttonProps}
      onClick={() => {
        if (didHoldRepeatRef.current) {
          didHoldRepeatRef.current = false;
          return;
        }

        stepRef.current();
      }}
      onPointerCancel={stopRepeat}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }

        didHoldRepeatRef.current = false;
        stopRepeat();
        scheduleRepeat(HOLD_REPEAT_INITIAL_DELAY_MS);
        window.addEventListener('pointerup', stopRepeat, { once: true });
      }}
      onPointerLeave={stopRepeat}
      onPointerUp={stopRepeat}
      type="button"
    >
      {children}
    </button>
  );
}

const PRESET_LONG_PRESS_MS = 500;

function TimerPresetChip({
  active,
  minutes,
  onEdit,
  onSelect
}: {
  active: boolean;
  minutes: number;
  onEdit: () => void;
  onSelect: () => void;
}) {
  const longPressTimeoutRef = useRef<number | null>(null);
  const didLongPressRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  return (
    <button
      aria-label={`${minutes} minute preset`}
      aria-pressed={active}
      className={`text-toggle timer-preset-toggle ${active ? 'timer-preset-toggle--active' : ''}`}
      data-tooltip-content="Right-click or hold to edit"
      onClick={() => {
        if (didLongPressRef.current) {
          didLongPressRef.current = false;
          return;
        }

        onSelect();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        clearLongPress();
        onEdit();
      }}
      onPointerCancel={clearLongPress}
      onPointerDown={() => {
        didLongPressRef.current = false;
        clearLongPress();
        longPressTimeoutRef.current = window.setTimeout(() => {
          didLongPressRef.current = true;
          onEdit();
        }, PRESET_LONG_PRESS_MS);
      }}
      onPointerLeave={clearLongPress}
      onPointerUp={clearLongPress}
      type="button"
    >
      {minutes}m
    </button>
  );
}

export function TimerWidgetContent({ controller }: { controller: TimerWidgetController }) {
  const {
    customTimerActive,
    customTimerMinutes,
    customTimerMs,
    extendTimer,
    isStopwatch,
    isTimerFinished,
    isTimerPaused,
    isTimerRunning,
    pauseTimer,
    resetTimer,
    resumeTimer,
    runAgainDurationLabel,
    setFinalWarningMinutes,
    setMode,
    setPreset,
    setRepeatCount,
    startTimer,
    timer,
    timerLabel,
    timerProgress,
    toggleHalfwayWarning,
    toggleStartPause,
    updateCustomTimer,
    updatePresetMinutes,
    updateTimerLabel
  } = controller;
  const customTimerLabel = getCustomTimerLabel(customTimerMinutes);
  const nextCustomTimerMinutes = getNextCustomTimerMinutes(customTimerMinutes);
  const previousCustomTimerMinutes = getPreviousCustomTimerMinutes(customTimerMinutes);
  const [editingPresetIndex, setEditingPresetIndex] = useState<number | null>(null);
  const customStepperRef = useRef<HTMLDivElement | null>(null);
  const wheelStepsRef = useRef({ stepDown: () => {}, stepUp: () => {} });
  wheelStepsRef.current = {
    stepDown: () => updateCustomTimer(previousCustomTimerMinutes),
    stepUp: () => updateCustomTimer(nextCustomTimerMinutes)
  };

  useEffect(() => {
    const stepperElement = customStepperRef.current;
    if (!stepperElement) {
      return;
    }

    let accumulatedDelta = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      accumulatedDelta += event.deltaY;
      if (Math.abs(accumulatedDelta) < 25) {
        return;
      }

      if (accumulatedDelta < 0) {
        wheelStepsRef.current.stepUp();
      } else {
        wheelStepsRef.current.stepDown();
      }
      accumulatedDelta = 0;
    };

    stepperElement.addEventListener('wheel', onWheel, { passive: false });
    return () => stepperElement.removeEventListener('wheel', onWheel);
  }, [isStopwatch]);

  const handleRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea')) {
      return;
    }

    event.currentTarget.focus();
  };

  const handleRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea')) {
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      toggleStartPause();
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      resetTimer();
    }
  };

  return (
    <div
      className="timer-widget-body"
      onKeyDown={handleRootKeyDown}
      onPointerDown={handleRootPointerDown}
      tabIndex={-1}
    >
      <div className="timer-toolbar widget-top-controls">
        <div aria-label="Timer mode" className="timer-mode-row" role="group">
          {(['countdown', 'stopwatch'] as const).map((mode) => (
            <button
              aria-pressed={timer.mode === mode}
              className={`text-toggle timer-mode-toggle ${
                timer.mode === mode ? 'timer-preset-toggle--active' : ''
              }`}
              key={mode}
              onClick={() => setMode(mode)}
              type="button"
            >
              {mode === 'countdown' ? 'Timer' : 'Stopwatch'}
            </button>
          ))}
        </div>
        <input
          aria-label="Name this run"
          className="text-field timer-name-input"
          maxLength={TIMER_LABEL_MAX_LENGTH}
          onChange={(event) => updateTimerLabel(event.currentTarget.value)}
          placeholder="Name it, e.g. Silent reading"
          type="text"
          value={timer.label}
        />
      </div>

      <div className="timer-display-row">
        <div
          aria-live="off"
          className={`timer-readout ${isTimerFinished ? 'timer-readout--overtime' : ''}`}
          role="timer"
        >
          {timerLabel}
        </div>
        {!isStopwatch ? (
          <div
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(clampNumber(timerProgress, 0, 1) * 100)}
            className="progress"
            role="progressbar"
          >
            <span
              className={`progress__fill ${isTimerFinished ? 'progress__fill--overtime' : ''}`}
              style={{ transform: `scaleX(${timerProgress})` }}
            />
          </div>
        ) : null}
        <div className="action-row widget-primary-actions">
          {isTimerFinished ? (
            <button
              aria-label={`Run ${runAgainDurationLabel} again`}
              className="primary-link"
              data-compact-icon="▶"
              onClick={startTimer}
              type="button"
            >
              Run {runAgainDurationLabel} again
            </button>
          ) : (
            <>
              {!isTimerRunning && !isTimerPaused && (
                <button
                  aria-label={isStopwatch ? 'Start stopwatch' : 'Start timer'}
                  className="primary-link"
                  data-compact-icon="▶"
                  onClick={startTimer}
                  type="button"
                >
                  Start
                </button>
              )}
              {isTimerRunning && (
                <button
                  aria-label={isStopwatch ? 'Pause stopwatch' : 'Pause timer'}
                  className="primary-link"
                  data-compact-icon="❚❚"
                  onClick={pauseTimer}
                  type="button"
                >
                  Pause
                </button>
              )}
              {isTimerPaused && (
                <button
                  aria-label={isStopwatch ? 'Resume stopwatch' : 'Resume timer'}
                  className="primary-link"
                  data-compact-icon="▶"
                  onClick={resumeTimer}
                  type="button"
                >
                  Resume
                </button>
              )}
            </>
          )}
          {!isStopwatch && (isTimerRunning || isTimerPaused) && (
            <button
              aria-label="Add one minute"
              className="secondary-link timer-extend-button"
              data-compact-icon="+1"
              onClick={() => extendTimer(60 * 1000)}
              type="button"
            >
              +1:00
            </button>
          )}
          <button
            aria-label={isStopwatch ? 'Reset stopwatch' : 'Reset timer'}
            className="secondary-link"
            data-compact-icon="↻"
            onClick={resetTimer}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>

      {!isStopwatch ? (
        <div className="segmented-row timer-quickset widget-top-controls">
          {timer.presetsMinutes.map((presetMinutes, index) =>
            editingPresetIndex === index ? (
              <div
                className="stepper timer-preset-editor"
                data-tooltip-content="Preset minutes"
                key={`preset-editor-${index}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setEditingPresetIndex(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' || event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingPresetIndex(null);
                  }
                }}
              >
                <HoldRepeatButton
                  aria-label="Decrease preset minutes"
                  className="stepper__button"
                  disabled={presetMinutes <= TIMER_PRESET_MIN_MINUTES}
                  onStep={() => updatePresetMinutes(index, presetMinutes - 1)}
                >
                  −
                </HoldRepeatButton>
                <button
                  aria-label={`Save ${presetMinutes} minute preset`}
                  autoFocus
                  className="stepper__value timer-preset-editor__value"
                  onClick={() => setEditingPresetIndex(null)}
                  type="button"
                >
                  {presetMinutes}m
                </button>
                <HoldRepeatButton
                  aria-label="Increase preset minutes"
                  className="stepper__button"
                  disabled={presetMinutes >= CUSTOM_TIMER_MAX_MINUTES}
                  onStep={() => updatePresetMinutes(index, presetMinutes + 1)}
                >
                  +
                </HoldRepeatButton>
              </div>
            ) : (
              <TimerPresetChip
                active={timer.baseDurationMs === presetMinutes * 60 * 1000}
                key={`preset-${index}`}
                minutes={presetMinutes}
                onEdit={() => setEditingPresetIndex(index)}
                onSelect={() => setPreset(presetMinutes * 60 * 1000)}
              />
            )
          )}
          <div
            className="stepper timer-quickset__stepper"
            data-tooltip-content="Custom duration"
            ref={customStepperRef}
          >
            <HoldRepeatButton
              aria-label="Decrease custom timer"
              className="stepper__button"
              disabled={customTimerMinutes === 0}
              onStep={() => updateCustomTimer(previousCustomTimerMinutes)}
            >
              −
            </HoldRepeatButton>
            <button
              aria-label={getCustomTimerAriaLabel(customTimerMinutes)}
              aria-pressed={customTimerActive}
              className={`stepper__value timer-stepper__value ${
                customTimerActive ? 'timer-stepper__value--active' : ''
              }`}
              disabled={customTimerMinutes === 0}
              onClick={() => {
                if (customTimerMinutes > 0) {
                  setPreset(customTimerMs);
                }
              }}
              type="button"
            >
              {customTimerLabel}
            </button>
            <HoldRepeatButton
              aria-label="Increase custom timer"
              className="stepper__button"
              disabled={customTimerMinutes === CUSTOM_TIMER_MAX_MINUTES}
              onStep={() => updateCustomTimer(nextCustomTimerMinutes)}
            >
              +
            </HoldRepeatButton>
          </div>
          <div
            aria-label="Repeat rounds"
            className="stepper timer-quickset__stepper timer-repeat-stepper"
            data-tooltip-content="Repeat rounds"
            role="group"
          >
            <HoldRepeatButton
              aria-label="Fewer repeat rounds"
              className="stepper__button"
              disabled={timer.repeatCount <= 1}
              onStep={() => setRepeatCount(timer.repeatCount - 1)}
            >
              −
            </HoldRepeatButton>
            <span className="stepper__value timer-repeat-stepper__value">
              ×{timer.repeatCount}
            </span>
            <HoldRepeatButton
              aria-label="More repeat rounds"
              className="stepper__button"
              disabled={timer.repeatCount >= TIMER_REPEAT_MAX_ROUNDS}
              onStep={() => setRepeatCount(timer.repeatCount + 1)}
            >
              +
            </HoldRepeatButton>
          </div>
        </div>
      ) : null}

      {!isStopwatch ? (
        <div className="timer-alerts-row widget-top-controls">
          <span className="timer-alerts-row__label">Alerts</span>
          <div
            aria-label="Final warning minutes"
            className="stepper timer-alerts-row__stepper"
            data-tooltip-content="Final warning, minutes remaining"
            role="group"
          >
            <HoldRepeatButton
              aria-label="Decrease final warning minutes"
              className="stepper__button"
              disabled={timer.finalWarningMinutes <= 0}
              onStep={() => setFinalWarningMinutes(timer.finalWarningMinutes - 1)}
            >
              −
            </HoldRepeatButton>
            <span className="stepper__value timer-alerts-row__value">
              {timer.finalWarningMinutes === 0 ? 'Off' : `${timer.finalWarningMinutes}m`}
            </span>
            <HoldRepeatButton
              aria-label="Increase final warning minutes"
              className="stepper__button"
              disabled={timer.finalWarningMinutes >= TIMER_FINAL_WARNING_MAX_MINUTES}
              onStep={() => setFinalWarningMinutes(timer.finalWarningMinutes + 1)}
            >
              +
            </HoldRepeatButton>
          </div>
          <button
            aria-label="Halfway alert"
            aria-pressed={timer.halfwayWarningEnabled}
            className={`text-toggle timer-alerts-row__toggle ${
              timer.halfwayWarningEnabled ? 'timer-preset-toggle--active' : ''
            }`}
            data-tooltip-content="Halfway alert"
            onClick={toggleHalfwayWarning}
            type="button"
          >
            ½
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TimerClassDisplay({
  controller,
  onExit
}: {
  controller: TimerWidgetController;
  onExit: () => void;
}) {
  const {
    extendTimer,
    isStopwatch,
    isTimerFinished,
    isTimerPaused,
    isTimerRunning,
    pauseTimer,
    resetTimer,
    resumeTimer,
    runAgainDurationLabel,
    startTimer,
    timer,
    timerLabel,
    timerProgress
  } = controller;

  return (
    <section aria-label="Timer class display" className="timer-class-display">
      <header className="timer-class-display__top">
        <span className="timer-class-display__label">
          {timer.label || (isStopwatch ? 'Stopwatch' : 'Timer')}
        </span>
        <button
          aria-label="Exit class display"
          className="secondary-link timer-class-display__exit"
          onClick={onExit}
          type="button"
        >
          Exit display
        </button>
      </header>
      <div
        aria-live="off"
        className={`timer-class-display__readout ${
          isTimerFinished ? 'timer-class-display__readout--overtime' : ''
        }`}
        role="timer"
      >
        {timerLabel}
      </div>
      <div className="timer-class-display__controls">
        {isTimerFinished ? (
          <button className="primary-link" onClick={startTimer} type="button">
            Run {runAgainDurationLabel} again
          </button>
        ) : (
          <>
            {!isTimerRunning && !isTimerPaused && (
              <button className="primary-link" onClick={startTimer} type="button">
                Start
              </button>
            )}
            {isTimerRunning && (
              <button className="primary-link" onClick={pauseTimer} type="button">
                Pause
              </button>
            )}
            {isTimerPaused && (
              <button className="primary-link" onClick={resumeTimer} type="button">
                Resume
              </button>
            )}
          </>
        )}
        {!isStopwatch && (isTimerRunning || isTimerPaused) && (
          <button
            aria-label="Add one minute"
            className="secondary-link"
            onClick={() => extendTimer(60 * 1000)}
            type="button"
          >
            +1:00
          </button>
        )}
        <button className="secondary-link" onClick={resetTimer} type="button">
          Reset
        </button>
      </div>
      {!isStopwatch ? (
        <div
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(clampNumber(timerProgress, 0, 1) * 100)}
          className="progress timer-class-display__progress"
          role="progressbar"
        >
          <span
            className={`progress__fill ${isTimerFinished ? 'progress__fill--overtime' : ''}`}
            style={{ transform: `scaleX(${timerProgress})` }}
          />
        </div>
      ) : null}
    </section>
  );
}

export function ClassDisplayIcon() {
  return (
    <svg aria-hidden="true" className="popout-icon" viewBox="0 0 16 16">
      <path
        d="M6.1 2.9H3.4a.5.5 0 0 0-.5.5v2.7M9.9 2.9h2.7a.5.5 0 0 1 .5.5v2.7M6.1 13.1H3.4a.5.5 0 0 1-.5-.5V9.9M9.9 13.1h2.7a.5.5 0 0 0 .5-.5V9.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

export function TimerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const controller = useTimerWidgetState();
  const [isClassDisplay, setIsClassDisplay] = useState(false);
  const preDisplayBoundsRef = useRef<WindowBounds | null>(null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && target.closest('button, input, select, textarea')) {
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        controllerRef.current.toggleStartPause();
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        controllerRef.current.resetTimer();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const enterClassDisplay = () => {
    setIsClassDisplay(true);

    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    void electronAPI.getCurrentWindowBounds().then((bounds) => {
      preDisplayBoundsRef.current = bounds;

      const screenInfo = window.screen as Screen & { availLeft?: number; availTop?: number };
      const width = Math.round(screenInfo.availWidth * 0.92);
      const height = Math.round(screenInfo.availHeight * 0.92);

      electronAPI.setCurrentWindowBounds({
        x: Math.round((screenInfo.availLeft ?? 0) + (screenInfo.availWidth - width) / 2),
        y: Math.round((screenInfo.availTop ?? 0) + (screenInfo.availHeight - height) / 2),
        width,
        height
      });
    });
  };

  const exitClassDisplay = useCallback(() => {
    setIsClassDisplay(false);

    const previousBounds = preDisplayBoundsRef.current;
    preDisplayBoundsRef.current = null;
    if (previousBounds) {
      window.electronAPI?.setCurrentWindowBounds(previousBounds);
    }
  }, []);

  useEffect(() => {
    if (!isClassDisplay) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      exitClassDisplay();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [exitClassDisplay, isClassDisplay]);

  if (isClassDisplay) {
    return <TimerClassDisplay controller={controller} onExit={exitClassDisplay} />;
  }

  return (
    <WidgetCard
      badge={controller.timerStatusLabel}
      badgeTone={controller.isTimerFinished ? 'alert' : 'default'}
      collapsed={false}
      description={WIDGET_DETAILS.timer.description}
      headerActions={
        <>
          <button
            aria-label="Class display"
            className="widget-icon-button"
            data-tooltip-content="Class display"
            onClick={(event) => {
              event.stopPropagation();
              enterClassDisplay();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            type="button"
          >
            <ClassDisplayIcon />
          </button>
          <PopoutWidgetActions
            interfaceScaleControls={interfaceScaleControls}
            title={WIDGET_DETAILS.timer.title}
            widgetId="timer"
          />
        </>
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      sizeTier={sizeTier}
      title={WIDGET_DETAILS.timer.title}
      widgetId="timer"
    >
      <TimerWidgetContent controller={controller} />
    </WidgetCard>
  );
}

export function useTimerWidgetState() {
  const [timer, setTimer] = usePersistentState<TimerSnapshot>('teacher-tools.timer', DEFAULT_TIMER, {
    normalize: normalizeTimerSnapshot
  });
  const [customTimerMinutes, setCustomTimerMinutes] = usePersistentState<number>(
    'teacher-tools.custom-timer-minutes',
    0
  );
  const isStopwatch = timer.mode === 'stopwatch';
  const isTimerFinished = !isStopwatch && timer.endsAt === null && timer.lastCompletedAt !== null;
  const liveNowUntil = isStopwatch
    ? timer.stopwatchStartedAt !== null
      ? Number.MAX_SAFE_INTEGER
      : null
    : timer.endsAt ?? (timer.lastCompletedAt !== null ? Number.MAX_SAFE_INTEGER : null);
  const now = useNow(liveNowUntil);
  const remainingMs = timer.endsAt ? Math.max(timer.endsAt - now, 0) : timer.pausedRemainingMs;
  const overtimeMs = isTimerFinished ? Math.max(now - (timer.lastCompletedAt ?? now), 0) : 0;
  const stopwatchElapsedMs =
    timer.stopwatchAccumulatedMs +
    (timer.stopwatchStartedAt !== null ? Math.max(now - timer.stopwatchStartedAt, 0) : 0);
  const isTimerRunning = isStopwatch
    ? timer.stopwatchStartedAt !== null
    : timer.endsAt !== null && remainingMs > 0;
  const isTimerPaused = isStopwatch
    ? timer.stopwatchStartedAt === null && timer.stopwatchAccumulatedMs > 0
    : timer.endsAt === null &&
      timer.lastCompletedAt === null &&
      timer.isPaused &&
      timer.pausedRemainingMs > 0;
  const timerProgress = isTimerFinished
    ? 1
    : timer.baseDurationMs === 0
      ? 0
      : remainingMs / timer.baseDurationMs;
  const customTimerMs = getCustomTimerDurationMs(customTimerMinutes);
  const customTimerActive =
    customTimerMinutes > 0 &&
    timer.baseDurationMs === customTimerMs &&
    !timer.presetsMinutes.some((presetMinutes) => presetMinutes * 60 * 1000 === customTimerMs);
  useTimerSoundAlerts(timer, remainingMs, setTimer);

  const startTimer = () => {
    primeTimerAudio();
    setTimer((current) =>
      current.mode === 'stopwatch'
        ? {
            ...current,
            stopwatchStartedAt: Date.now(),
            stopwatchAccumulatedMs: 0
          }
        : {
            ...current,
            endsAt: Date.now() + current.baseDurationMs,
            pausedRemainingMs: current.baseDurationMs,
            isPaused: false,
            currentRound: 1,
            lastCompletedAt: null
          }
    );
  };

  const pauseTimer = () => {
    setTimer((current) =>
      current.mode === 'stopwatch'
        ? {
            ...current,
            stopwatchStartedAt: null,
            stopwatchAccumulatedMs:
              current.stopwatchAccumulatedMs +
              (current.stopwatchStartedAt !== null
                ? Math.max(Date.now() - current.stopwatchStartedAt, 0)
                : 0)
          }
        : {
            ...current,
            endsAt: null,
            pausedRemainingMs: current.endsAt ? Math.max(current.endsAt - Date.now(), 0) : 0,
            isPaused: current.endsAt !== null
          }
    );
  };

  const resumeTimer = () => {
    primeTimerAudio();
    setTimer((current) =>
      current.mode === 'stopwatch'
        ? {
            ...current,
            stopwatchStartedAt: Date.now()
          }
        : {
            ...current,
            endsAt: Date.now() + current.pausedRemainingMs,
            isPaused: false,
            lastCompletedAt: null
          }
    );
  };

  const resetTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: null,
      pausedRemainingMs: current.baseDurationMs,
      isPaused: false,
      currentRound: 1,
      lastCompletedAt: null,
      stopwatchStartedAt: null,
      stopwatchAccumulatedMs: 0
    }));
  };

  const setPreset = (durationMs: number) => {
    setTimer((current) => ({
      ...current,
      baseDurationMs: durationMs,
      endsAt: null,
      pausedRemainingMs: durationMs,
      isPaused: false,
      currentRound: 1,
      lastCompletedAt: null
    }));
  };

  const setMode = (mode: TimerMode) => {
    setTimer((current) =>
      current.mode === mode
        ? current
        : {
            ...current,
            mode,
            endsAt: null,
            pausedRemainingMs: current.baseDurationMs,
            isPaused: false,
            currentRound: 1,
            lastCompletedAt: null,
            stopwatchStartedAt: null,
            stopwatchAccumulatedMs: 0
          }
    );
  };

  const toggleStartPause = () => {
    if (isTimerRunning) {
      pauseTimer();
    } else if (isTimerPaused) {
      resumeTimer();
    } else {
      startTimer();
    }
  };

  const extendTimer = (extraMs: number) => {
    setTimer((current) => {
      if (current.mode === 'stopwatch') {
        return current;
      }

      if (current.endsAt !== null) {
        return {
          ...current,
          baseDurationMs: current.baseDurationMs + extraMs,
          endsAt: current.endsAt + extraMs
        };
      }

      if (current.isPaused && current.lastCompletedAt === null) {
        return {
          ...current,
          baseDurationMs: current.baseDurationMs + extraMs,
          pausedRemainingMs: current.pausedRemainingMs + extraMs
        };
      }

      return current;
    });
  };

  const updatePresetMinutes = (index: number, minutes: number) => {
    const clampedMinutes = clampNumber(
      Math.round(minutes),
      TIMER_PRESET_MIN_MINUTES,
      CUSTOM_TIMER_MAX_MINUTES
    );
    setTimer((current) => ({
      ...current,
      presetsMinutes: current.presetsMinutes.map((presetMinutes, presetIndex) =>
        presetIndex === index ? clampedMinutes : presetMinutes
      )
    }));
  };

  const setRepeatCount = (count: number) => {
    const clampedCount = clampNumber(Math.round(count), 1, TIMER_REPEAT_MAX_ROUNDS);
    setTimer((current) => ({
      ...current,
      repeatCount: clampedCount,
      currentRound: Math.min(current.currentRound, clampedCount)
    }));
  };

  const setFinalWarningMinutes = (minutes: number) => {
    const clampedMinutes = clampNumber(Math.round(minutes), 0, TIMER_FINAL_WARNING_MAX_MINUTES);
    setTimer((current) => ({
      ...current,
      finalWarningMinutes: clampedMinutes
    }));
  };

  const toggleHalfwayWarning = () => {
    setTimer((current) => ({
      ...current,
      halfwayWarningEnabled: !current.halfwayWarningEnabled
    }));
  };

  const updateTimerLabel = (label: string) => {
    setTimer((current) => ({
      ...current,
      label: label.slice(0, TIMER_LABEL_MAX_LENGTH)
    }));
  };

  const updateCustomTimer = (nextMinutes: number) => {
    const clampedMinutes = normalizeCustomTimerMinutes(nextMinutes);
    const previousCustomTimerMs = getCustomTimerDurationMs(customTimerMinutes);
    const nextDurationMs = getCustomTimerDurationMs(clampedMinutes);

    setCustomTimerMinutes(clampedMinutes);

    if (clampedMinutes > 0) {
      setTimer((current) => {
        if (current.mode !== 'stopwatch' && current.endsAt !== null) {
          // Adjust the live run in place instead of restarting it.
          const durationDelta = nextDurationMs - current.baseDurationMs;
          return {
            ...current,
            baseDurationMs: nextDurationMs,
            endsAt: Math.max(current.endsAt + durationDelta, Date.now())
          };
        }

        if (current.mode !== 'stopwatch' && current.isPaused && current.lastCompletedAt === null) {
          const durationDelta = nextDurationMs - current.baseDurationMs;
          return {
            ...current,
            baseDurationMs: nextDurationMs,
            pausedRemainingMs: Math.max(current.pausedRemainingMs + durationDelta, 0)
          };
        }

        return {
          ...current,
          baseDurationMs: nextDurationMs,
          endsAt: null,
          pausedRemainingMs: nextDurationMs,
          isPaused: false,
          currentRound: 1,
          lastCompletedAt: null
        };
      });
      return;
    }

    if (timer.baseDurationMs === previousCustomTimerMs && timer.endsAt === null && !timer.isPaused) {
      setPreset(DEFAULT_TIMER.baseDurationMs);
    }
  };

  return {
    customTimerActive,
    customTimerMinutes,
    customTimerMs,
    extendTimer,
    isStopwatch,
    isTimerFinished,
    isTimerPaused,
    isTimerRunning,
    now,
    overtimeMs,
    pauseTimer,
    resetTimer,
    resumeTimer,
    runAgainDurationLabel: formatTimerRunDurationLabel(timer.baseDurationMs),
    setFinalWarningMinutes,
    setMode,
    setPreset,
    setRepeatCount,
    startTimer,
    timer,
    timerLabel: isStopwatch
      ? formatDuration(stopwatchElapsedMs)
      : isTimerFinished
        ? `+${formatDuration(overtimeMs)}`
        : formatDuration(remainingMs),
    timerProgress,
    timerStatusLabel: isTimerFinished
      ? 'Done'
      : isTimerRunning
        ? !isStopwatch && timer.repeatCount > 1
          ? `Round ${timer.currentRound}/${timer.repeatCount}`
          : 'Live'
        : isTimerPaused
          ? 'Paused'
          : 'Ready',
    toggleHalfwayWarning,
    toggleStartPause,
    updateCustomTimer,
    updatePresetMinutes,
    updateTimerLabel
  };
}

export type TimerWidgetController = ReturnType<typeof useTimerWidgetState>;
