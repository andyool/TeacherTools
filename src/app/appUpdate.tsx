import { useEffect, useState } from 'react';
import type { AppUpdateState } from '../electron-types';

export const fallbackAppUpdateState: AppUpdateState = {
  availableVersion: null,
  currentVersion: 'dev',
  message: 'Updates are available in installed desktop builds.',
  progressPercent: null,
  status: 'unsupported'
};

export function useAppUpdateState() {
  const [appUpdate, setAppUpdate] = useState<AppUpdateState>(fallbackAppUpdateState);

  useEffect(() => {
    if (!window.electronAPI?.getAppUpdateState || !window.electronAPI.onAppUpdateStateChanged) {
      return;
    }

    let cancelled = false;
    window.electronAPI.getAppUpdateState().then((state) => {
      if (!cancelled) {
        setAppUpdate(state);
      }
    });

    const unsubscribe = window.electronAPI.onAppUpdateStateChanged((state) => {
      setAppUpdate(state);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return [appUpdate, setAppUpdate] as const;
}

export function getAppUpdateButtonLabel(appUpdate: AppUpdateState) {
  switch (appUpdate.status) {
    case 'checking':
      return 'Checking…';
    case 'available':
      return 'Downloading…';
    case 'downloading':
      return appUpdate.progressPercent !== null
        ? `Downloading ${Math.round(appUpdate.progressPercent)}%`
        : 'Downloading…';
    case 'downloaded':
      return 'Restart to install';
    case 'up-to-date':
      return 'Check again';
    case 'error':
      return 'Retry update';
    default:
      return 'Update app';
  }
}

export function getAppUpdateStatusLabel(appUpdate: AppUpdateState) {
  switch (appUpdate.status) {
    case 'checking':
      return 'Looking';
    case 'available':
      return appUpdate.availableVersion ? `v${appUpdate.availableVersion}` : 'Found';
    case 'downloading':
      return appUpdate.progressPercent !== null ? `${Math.round(appUpdate.progressPercent)}%` : 'Fetch';
    case 'downloaded':
      return appUpdate.availableVersion ? `v${appUpdate.availableVersion}` : 'Ready';
    case 'up-to-date':
      return 'Current';
    case 'error':
      return 'Retry';
    case 'unsupported':
      return 'Installed only';
    default:
      return `v${appUpdate.currentVersion}`;
  }
}

export function getAppUpdateStatusTone(appUpdate: AppUpdateState) {
  switch (appUpdate.status) {
    case 'checking':
    case 'available':
    case 'downloading':
      return 'info';
    case 'downloaded':
      return 'success';
    case 'error':
    case 'unsupported':
      return 'warning';
    default:
      return 'default';
  }
}

export function getAppUpdateTooltip(appUpdate: AppUpdateState) {
  const versionSummary = appUpdate.availableVersion
    ? ` Current v${appUpdate.currentVersion}. Update v${appUpdate.availableVersion}.`
    : ` Current v${appUpdate.currentVersion}.`;

  return `${appUpdate.message}${versionSummary}`;
}

export function getAppUpdateActionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'The update action failed. Restart TeacherTools and try again.';
}
