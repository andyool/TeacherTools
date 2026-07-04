import { useLayoutEffect, useMemo } from 'react';
import { getWidgetIdFromLocationHash, getWindowRoleFromLocationHash } from './windowContext';
import { getInitialPersistentState, usePersistentState } from '../shared/persistence';
import { clampNumber } from '../shared/utils';

export type InterfaceScaleControlsState = {
  canDecreaseInterfaceScale: boolean;
  canIncreaseInterfaceScale: boolean;
  decreaseInterfaceScale: () => void;
  increaseInterfaceScale: () => void;
  interfaceScale: number;
};

export const DEFAULT_INTERFACE_SCALE = 1;

export const INTERFACE_SCALE_STORAGE_KEY = 'teacher-tools.interface-scale';

export const INTERFACE_SCALE_STEP = 0.1;

export const INTERFACE_SCALE_MIN = 0.5;

export const INTERFACE_SCALE_MAX = 2;

// Keep the main dashboard zoom key stable while giving each zoomable popout its own saved level.
export function getInterfaceScaleStorageKey(locationHash = window.location.hash) {
  const role = getWindowRoleFromLocationHash(locationHash);

  if (role === 'widget-popout') {
    const widgetId = getWidgetIdFromLocationHash(locationHash);
    return widgetId
      ? `${INTERFACE_SCALE_STORAGE_KEY}.widget-popout.${widgetId}`
      : `${INTERFACE_SCALE_STORAGE_KEY}.widget-popout`;
  }

  if (role === 'builder' || role === 'widget-picker') {
    return `${INTERFACE_SCALE_STORAGE_KEY}.${role}`;
  }

  return INTERFACE_SCALE_STORAGE_KEY;
}

export function getInitialInterfaceScaleValue(storageKey: string) {
  if (storageKey === INTERFACE_SCALE_STORAGE_KEY) {
    return DEFAULT_INTERFACE_SCALE;
  }

  return getInitialPersistentState<number>(
    INTERFACE_SCALE_STORAGE_KEY,
    DEFAULT_INTERFACE_SCALE,
    normalizeInterfaceScale
  ).value;
}

export function useInterfaceScaleState() {
  const storageKey = useMemo(() => getInterfaceScaleStorageKey(), []);
  const initialValue = useMemo(() => getInitialInterfaceScaleValue(storageKey), [storageKey]);

  return usePersistentState<number>(storageKey, initialValue, {
    normalize: normalizeInterfaceScale
  });
}

export function useInterfaceScaleControls() {
  const [interfaceScale, setInterfaceScale] = useInterfaceScaleState();

  useLayoutEffect(() => {
    document.body.style.zoom = String(interfaceScale);

    return () => {
      document.body.style.zoom = '1';
    };
  }, [interfaceScale]);

  return {
    canDecreaseInterfaceScale: interfaceScale > INTERFACE_SCALE_MIN,
    canIncreaseInterfaceScale: interfaceScale < INTERFACE_SCALE_MAX,
    decreaseInterfaceScale: () =>
      setInterfaceScale((current) => shiftInterfaceScale(current, -INTERFACE_SCALE_STEP)),
    increaseInterfaceScale: () =>
      setInterfaceScale((current) => shiftInterfaceScale(current, INTERFACE_SCALE_STEP)),
    interfaceScale
  };
}

export function InterfaceScaleControls({
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
  scale
}: {
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  scale: number;
}) {
  const nextDecreaseScale = shiftInterfaceScale(scale, -INTERFACE_SCALE_STEP);
  const nextIncreaseScale = shiftInterfaceScale(scale, INTERFACE_SCALE_STEP);

  return (
    <div aria-label="Interface zoom" className="zoom-controls" role="group">
      <button
        aria-label={
          canDecrease
            ? `Zoom out to ${formatInterfaceScaleLabel(nextDecreaseScale)}`
            : 'Minimum zoom reached'
        }
        className="icon-button button-tone--utility"
        data-tooltip-content={
          canDecrease
            ? `Zoom out to ${formatInterfaceScaleLabel(nextDecreaseScale)}`
            : 'Minimum zoom reached'
        }
        disabled={!canDecrease}
        onClick={(event) => {
          event.stopPropagation();
          onDecrease();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        type="button"
      >
        −
      </button>
      <button
        aria-label={
          canIncrease
            ? `Zoom in to ${formatInterfaceScaleLabel(nextIncreaseScale)}`
            : 'Maximum zoom reached'
        }
        className="icon-button button-tone--utility"
        data-tooltip-content={
          canIncrease
            ? `Zoom in to ${formatInterfaceScaleLabel(nextIncreaseScale)}`
            : 'Maximum zoom reached'
        }
        disabled={!canIncrease}
        onClick={(event) => {
          event.stopPropagation();
          onIncrease();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        type="button"
      >
        +
      </button>
    </div>
  );
}

export function normalizeInterfaceScale(raw: unknown, initialValue: number) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return initialValue;
  }

  return clampInterfaceScale(raw);
}

export function shiftInterfaceScale(scale: number, delta: number) {
  return clampInterfaceScale(scale + delta);
}

export function clampInterfaceScale(scale: number) {
  return Math.round(clampNumber(scale, INTERFACE_SCALE_MIN, INTERFACE_SCALE_MAX) * 10) / 10;
}

export function formatInterfaceScaleLabel(scale: number) {
  return `${Math.round(scale * 100)}%`;
}
