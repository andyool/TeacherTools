import { useEffect, useState } from 'react';
import type { AppSettings, TimerChimeSound, TimerSpeechVoice } from '../electron-types';

export const TIMER_CHIME_ENABLED_SETTINGS_KEY = 'teacher-tools.timer-chime-enabled';

export const TIMER_CHIME_SOUND_SETTINGS_KEY = 'teacher-tools.timer-chime-sound';

export const TIMER_SPEECH_VOICE_SETTINGS_KEY = 'teacher-tools.timer-speech-voice';

export const TIMER_VOICE_ENABLED_SETTINGS_KEY = 'teacher-tools.timer-voice-enabled';

export function getInitialAppSettingValue(key: string) {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.electronAPI?.getPersistentState?.(key)?.value;
}

export function getInitialTimerSpeechVoice(): TimerSpeechVoice {
  return getInitialAppSettingValue(TIMER_SPEECH_VOICE_SETTINGS_KEY) === 'female' ? 'female' : 'male';
}

export function getInitialTimerAlertEnabled(key: string) {
  return getInitialAppSettingValue(key) !== false;
}

export function getInitialTimerChimeSound(): TimerChimeSound {
  const value = getInitialAppSettingValue(TIMER_CHIME_SOUND_SETTINGS_KEY);
  return value === 'bells' || value === 'beeps' || value === 'chirp' ? value : 'classic';
}

export const fallbackAppSettings: AppSettings = {
  launchAtLogin: false,
  timerChimeEnabled: getInitialTimerAlertEnabled(TIMER_CHIME_ENABLED_SETTINGS_KEY),
  timerChimeSound: getInitialTimerChimeSound(),
  timerSpeechVoice: getInitialTimerSpeechVoice(),
  timerVoiceEnabled: getInitialTimerAlertEnabled(TIMER_VOICE_ENABLED_SETTINGS_KEY)
};

export function useAppSettingsState() {
  const [appSettings, setAppSettings] = useState<AppSettings>(fallbackAppSettings);

  useEffect(() => {
    if (!window.electronAPI?.getAppSettings || !window.electronAPI.onAppSettingsChanged) {
      return;
    }

    let cancelled = false;
    window.electronAPI.getAppSettings().then((settings) => {
      if (!cancelled) {
        setAppSettings(settings);
      }
    });

    const unsubscribe = window.electronAPI.onAppSettingsChanged((settings) => {
      setAppSettings(settings);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return [appSettings, setAppSettings] as const;
}
