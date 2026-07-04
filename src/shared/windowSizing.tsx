import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { WindowBounds } from '../electron-types';
import { clampNumber } from './utils';
import type { WidgetSizeTier } from '../widgets/dashboard';
import { WIDGET_SIZE_MAX } from '../widgets/dashboard';
import type { WidgetId } from '../widgets/registry';
import { WIDGET_POPOUT_DEFAULT_SIZES, WIDGET_POPOUT_MIN_SIZES } from '../widgets/registry';

export type ResizeCorner = 'bottom-left' | 'bottom-right';

export const MIN_POPOVER_WIDTH = 260;

export const MIN_POPOVER_HEIGHT = 300;

export const WINDOW_EDGE_MARGIN = 14;

export function useWindowResizeHandles({
  minHeight,
  minWidth,
  onResizeStart
}: {
  minHeight: number;
  minWidth: number;
  onResizeStart?: () => void;
}) {
  const resizeStateRef = useRef<{
    corner: ResizeCorner;
    pointerId: number;
    startBounds: WindowBounds;
    startPointerX: number;
    startPointerY: number;
  } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const queuedBoundsRef = useRef<WindowBounds | null>(null);
  const lastSentBoundsRef = useRef<WindowBounds | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const flushQueuedBounds = () => {
    animationFrameRef.current = null;

    const queuedBounds = queuedBoundsRef.current;
    if (!queuedBounds) {
      return;
    }

    if (
      lastSentBoundsRef.current &&
      queuedBounds.x === lastSentBoundsRef.current.x &&
      queuedBounds.y === lastSentBoundsRef.current.y &&
      queuedBounds.width === lastSentBoundsRef.current.width &&
      queuedBounds.height === lastSentBoundsRef.current.height
    ) {
      return;
    }

    lastSentBoundsRef.current = queuedBounds;
    window.electronAPI?.setCurrentWindowBounds(queuedBounds);
  };

  const scheduleResize = (nextBounds: WindowBounds) => {
    queuedBoundsRef.current = nextBounds;

    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(flushQueuedBounds);
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!document.body) {
      return;
    }

    if (isResizing) {
      document.body.dataset.windowResizing = 'true';
      return () => {
        delete document.body.dataset.windowResizing;
      };
    }

    delete document.body.dataset.windowResizing;
    return undefined;
  }, [isResizing]);

  const getLiveWindowBounds = () => {
    const width = Math.round(window.outerWidth);
    const height = Math.round(window.outerHeight);

    if (!(width > 0 && height > 0)) {
      return null;
    }

    return {
      x: Math.round(window.screenX),
      y: Math.round(window.screenY),
      width,
      height
    };
  };

  const beginResize = (corner: ResizeCorner, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!window.electronAPI) {
      return;
    }

    onResizeStart?.();

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startPointerX = event.screenX;
    const startPointerY = event.screenY;

    handle.setPointerCapture(pointerId);
    setIsResizing(true);

    const beginWithBounds = (startBounds: WindowBounds) => {
      if (!handle.hasPointerCapture(pointerId)) {
        return;
      }

      resizeStateRef.current = {
        corner,
        pointerId,
        startPointerX,
        startPointerY,
        startBounds
      };
      queuedBoundsRef.current = startBounds;
      lastSentBoundsRef.current = startBounds;
    };

    const liveBounds = getLiveWindowBounds();
    if (liveBounds) {
      beginWithBounds(liveBounds);
      return;
    }

    window.electronAPI.getCurrentWindowBounds().then(beginWithBounds);
  };

  const continueResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const deltaX = event.screenX - resizeState.startPointerX;
    const deltaY = event.screenY - resizeState.startPointerY;
    const widthDelta = resizeState.corner === 'bottom-right' ? deltaX : -deltaX;
    const nextWidth = clampNumber(
      Math.round(resizeState.startBounds.width + widthDelta),
      minWidth,
      2400
    );
    const nextHeight = clampNumber(
      Math.round(resizeState.startBounds.height + deltaY),
      minHeight,
      2400
    );
    const nextX =
      resizeState.corner === 'bottom-left'
        ? Math.round(resizeState.startBounds.x + (resizeState.startBounds.width - nextWidth))
        : resizeState.startBounds.x;

    scheduleResize({
      x: nextX,
      y: resizeState.startBounds.y,
      width: nextWidth,
      height: nextHeight
    });
  };

  const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      queuedBoundsRef.current = null;
      setIsResizing(false);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      flushQueuedBounds();
    }

    resizeStateRef.current = null;
    queuedBoundsRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    beginResize,
    continueResize,
    endResize,
    isResizing
  };
}

export function getWidgetPopoutSizeTier(widgetId: WidgetId, width: number, height: number): WidgetSizeTier {
  const minSize = WIDGET_POPOUT_MIN_SIZES[widgetId];
  const defaultSize = WIDGET_POPOUT_DEFAULT_SIZES[widgetId];
  const minimumRatio = Math.min(
    minSize.minWidth / defaultSize.width,
    minSize.minHeight / defaultSize.height
  );
  const currentRatio = clampNumber(
    Math.min(width / defaultSize.width, height / defaultSize.height),
    minimumRatio,
    1.25
  );
  const normalizedRatio = clampNumber(
    (currentRatio - minimumRatio) / Math.max(1 - minimumRatio, 0.001),
    0,
    1
  );

  if (normalizedRatio <= 0.14) {
    return 1;
  }

  if (normalizedRatio <= 0.34) {
    return 2;
  }

  if (normalizedRatio <= 0.58) {
    return 3;
  }

  if (normalizedRatio <= 0.82) {
    return 4;
  }

  return 5;
}

export function useResponsiveWidgetPopoutSizeTier({
  scale,
  stageRef,
  widgetId
}: {
  scale: number;
  stageRef: RefObject<HTMLElement>;
  widgetId: WidgetId | null;
}) {
  const [sizeTier, setSizeTier] = useState<WidgetSizeTier>(WIDGET_SIZE_MAX);

  useLayoutEffect(() => {
    if (!widgetId || !stageRef.current) {
      setSizeTier(WIDGET_SIZE_MAX);
      return;
    }

    const stage = stageRef.current;
    let frameId = 0;

    const updateSizeTier = () => {
      const bounds = stage.getBoundingClientRect();
      const nextSizeTier = getWidgetPopoutSizeTier(widgetId, bounds.width, bounds.height);
      setSizeTier((current) => (current === nextSizeTier ? current : nextSizeTier));
    };

    const scheduleSizeTierUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateSizeTier);
    };

    updateSizeTier();

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', scheduleSizeTierUpdate);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.removeEventListener('resize', scheduleSizeTierUpdate);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleSizeTierUpdate();
    });

    resizeObserver.observe(stage);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [scale, stageRef, widgetId]);

  return sizeTier;
}

export function useAutoFitWindowToContent({
  enabled,
  panelRef,
  scale,
  stageRef
}: {
  enabled: boolean;
  panelRef: RefObject<HTMLElement>;
  scale: number;
  stageRef: RefObject<HTMLElement>;
}) {
  const lastRequestedSizeRef = useRef<{ height: number; width: number } | null>(null);
  const autoFitDisabledRef = useRef(!enabled);
  const programmaticResizeUntilRef = useRef(0);

  useEffect(() => {
    autoFitDisabledRef.current = !enabled;
    lastRequestedSizeRef.current = null;
    programmaticResizeUntilRef.current = 0;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleResize = () => {
      if (Date.now() <= programmaticResizeUntilRef.current) {
        return;
      }

      autoFitDisabledRef.current = true;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [enabled]);

  useLayoutEffect(() => {
    const electronAPI = window.electronAPI;

    if (!enabled || !electronAPI || !stageRef.current || !panelRef.current) {
      return;
    }

    const stage = stageRef.current;
    const panel = panelRef.current;
    let cancelled = false;

    const reportSize = () => {
      if (cancelled || autoFitDisabledRef.current) {
        return;
      }

      const stageStyles = window.getComputedStyle(stage);
      const stagePaddingX =
        parseFloat(stageStyles.paddingLeft || '0') + parseFloat(stageStyles.paddingRight || '0');
      const stagePaddingY =
        parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
      const desiredWidth = Math.ceil(Math.max(panel.scrollWidth, panel.offsetWidth) + stagePaddingX);
      const desiredHeight = Math.ceil(
        Math.max(panel.scrollHeight, panel.offsetHeight) + stagePaddingY
      );

      electronAPI.getCurrentWindowBounds().then((bounds) => {
        if (cancelled || autoFitDisabledRef.current) {
          return;
        }

        const nextWidth = Math.max(bounds.width, desiredWidth);
        const nextHeight = Math.max(bounds.height, desiredHeight);

        if (nextWidth === bounds.width && nextHeight === bounds.height) {
          lastRequestedSizeRef.current = {
            width: nextWidth,
            height: nextHeight
          };
          return;
        }

        if (
          lastRequestedSizeRef.current?.width === nextWidth &&
          lastRequestedSizeRef.current?.height === nextHeight
        ) {
          return;
        }

        lastRequestedSizeRef.current = {
          width: nextWidth,
          height: nextHeight
        };
        programmaticResizeUntilRef.current = Date.now() + 250;
        electronAPI.setCurrentWindowBounds({
          ...bounds,
          width: nextWidth,
          height: nextHeight
        });
      });
    };

    reportSize();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(reportSize);
    });

    resizeObserver.observe(panel);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [enabled, panelRef, scale, stageRef]);

  return {
    stopAutoFitToContent: () => {
      autoFitDisabledRef.current = true;
    }
  };
}
