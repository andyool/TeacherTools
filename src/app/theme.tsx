import { useEffect, useState } from 'react';
import { usePersistentState } from '../shared/persistence';

export type ThemeMode = 'light' | 'dark' | 'color';

export type ThemePreference = 'system' | ThemeMode;

export const THEME_CYCLE_ORDER: ThemePreference[] = ['system', 'light', 'dark', 'color'];

export function useThemePreferenceState() {
  return usePersistentState<ThemePreference>('teacher-tools.theme', 'system');
}

export function useResolvedTheme(preference: ThemePreference): ThemeMode {
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    };

    updateTheme();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateTheme);
      return () => mediaQuery.removeEventListener('change', updateTheme);
    }

    mediaQuery.addListener(updateTheme);
    return () => mediaQuery.removeListener(updateTheme);
  }, []);

  return preference === 'system' ? systemTheme : preference;
}

export function SettingsCogIcon() {
  return (
    <svg aria-hidden="true" className="settings-cog-icon" viewBox="0 0 16 16">
      <path
        d="M6.9 1.7h2.2l.4 1.7c.3.1.6.2.9.4l1.5-.9 1.6 1.6-.9 1.5c.2.3.3.6.4.9l1.7.4v2.2l-1.7.4c-.1.3-.2.6-.4.9l.9 1.5-1.6 1.6-1.5-.9c-.3.2-.6.3-.9.4l-.4 1.7H6.9l-.4-1.7c-.3-.1-.6-.2-.9-.4l-1.5.9-1.6-1.6.9-1.5c-.2-.3-.3-.6-.4-.9l-1.7-.4V7.3L3 6.9c.1-.3.2-.6.4-.9l-.9-1.5 1.6-1.6 1.5.9c.3-.2.6-.3.9-.4l.4-1.7Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.15"
      />
      <circle cx="8" cy="8.4" fill="none" r="2.1" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function ThemeCycleIcon({ preference }: { preference: ThemePreference }) {
  if (preference === 'light') {
    return (
      <svg aria-hidden="true" className="theme-icon" viewBox="0 0 16 16">
        <circle cx="8" cy="8" fill="none" r="3.1" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M8 1.4v2.1M8 12.5v2.1M1.4 8h2.1M12.5 8h2.1M3.2 3.2l1.5 1.5M11.3 11.3l1.5 1.5M12.8 3.2l-1.5 1.5M4.7 11.3l-1.5 1.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.2"
        />
      </svg>
    );
  }

  if (preference === 'dark') {
    return (
      <svg aria-hidden="true" className="theme-icon" viewBox="0 0 16 16">
        <path
          d="M10.9 1.7a5.8 5.8 0 1 0 3.4 10.4A6.4 6.4 0 0 1 10.9 1.7Z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.3"
        />
      </svg>
    );
  }

  if (preference === 'color') {
    return (
      <svg aria-hidden="true" className="theme-icon" viewBox="0 0 16 16">
        <circle cx="4.2" cy="5" fill="currentColor" opacity="0.92" r="1.5" />
        <circle cx="11.8" cy="5" fill="currentColor" opacity="0.74" r="1.5" />
        <circle cx="5.2" cy="11.2" fill="currentColor" opacity="0.62" r="1.5" />
        <circle cx="10.8" cy="11.2" fill="currentColor" opacity="0.84" r="1.5" />
        <circle cx="8" cy="8" fill="none" opacity="0.9" r="2.1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="theme-icon" viewBox="0 0 16 16">
      <rect
        fill="none"
        height="9.2"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.2"
        width="11.2"
        x="2.4"
        y="3.4"
      />
      <path
        d="M8 4.2v7.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getNextThemePreference(preference: ThemePreference) {
  const currentIndex = THEME_CYCLE_ORDER.indexOf(preference);
  return THEME_CYCLE_ORDER[(currentIndex + 1) % THEME_CYCLE_ORDER.length];
}

export function getThemePreferenceLabel(preference: ThemePreference) {
  if (preference === 'system') {
    return 'Auto';
  }

  if (preference === 'light') {
    return 'Light';
  }

  if (preference === 'dark') {
    return 'Dark';
  }

  return 'Colour';
}
