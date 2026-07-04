import { useEffect, useState } from 'react';
import type { DesktopWindowContext } from '../electron-types';
import type { WidgetId } from '../widgets/registry';
import { isWidgetId } from '../widgets/registry';

export function getWindowRoleFromLocationHash(locationHash: string): DesktopWindowContext['role'] {
  if (locationHash.includes('builder')) {
    return 'builder';
  }

  if (locationHash.includes('widget-picker')) {
    return 'widget-picker';
  }

  if (locationHash.includes('widget-popout')) {
    return 'widget-popout';
  }

  if (locationHash.includes('popover')) {
    return 'popover';
  }

  return 'overlay';
}

export function getWidgetIdFromLocationHash(locationHash: string): WidgetId | null {
  const widgetId = locationHash.match(/widget-popout\/([^/?]+)/)?.[1] ?? '';
  return isWidgetId(widgetId) ? widgetId : null;
}

export function getFallbackWindowContext(locationHash = window.location.hash): DesktopWindowContext {
  return {
    role: getWindowRoleFromLocationHash(locationHash),
    anchor: {
      x: 1100,
      y: 32,
      width: 86,
      height: 86,
      display: {
        x: 0,
        y: 0,
        width: 1440,
        height: 900
      }
    },
    platform: 'unknown',
    autoSizeToContent: false,
    widgetId: getWidgetIdFromLocationHash(locationHash)
  };
}

export const fallbackContext: DesktopWindowContext = getFallbackWindowContext();

export function returnToTeacherTools() {
  window.electronAPI?.returnToTeacherTools();
}

export function useWidgetPopoutIds() {
  const [openWidgetIds, setOpenWidgetIds] = useState<WidgetId[]>([]);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    let cancelled = false;
    window.electronAPI.getOpenWidgetPopouts().then((widgetIds) => {
      if (!cancelled) {
        setOpenWidgetIds(widgetIds.filter(isWidgetId));
      }
    });

    const unsubscribe = window.electronAPI.onWidgetPopoutsChanged((widgetIds) => {
      setOpenWidgetIds(widgetIds.filter(isWidgetId));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return openWidgetIds;
}
