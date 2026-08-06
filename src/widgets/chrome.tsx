import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { getColorModeWidgetStyle, useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { InterfaceScaleControls } from '../app/interfaceScale';
import { returnToTeacherTools } from '../app/windowContext';
import type { WidgetSizeTier } from './dashboard';
import { WIDGET_SIZE_TIER_LABELS, WIDGET_TITLE_MIN_FONT_SIZE_PX } from './dashboard';
import type { WidgetId } from './registry';

export function WidgetCard({
  widgetId,
  badge,
  badgeTone = 'default',
  children,
  collapsed,
  description,
  headerActions,
  headerDragMode = 'static',
  isDragOver,
  isDragging,
  onDoubleClick,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onToggleCollapsed,
  showCollapse = true,
  sizeTier,
  targetHeight,
  title
}: {
  widgetId: WidgetId;
  badge: string | null;
  badgeTone?: 'alert' | 'default';
  children: React.ReactNode;
  collapsed: boolean;
  description: string;
  headerActions?: React.ReactNode;
  headerDragMode?: 'interactive' | 'static' | 'window';
  isDragOver: boolean;
  isDragging: boolean;
  onDoubleClick?: () => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleCollapsed?: () => void;
  showCollapse?: boolean;
  sizeTier?: WidgetSizeTier;
  targetHeight?: number;
  title: string;
}) {
  const fittedTitleRef = useFittedWidgetTitle(title, sizeTier);
  const { preferences: colorModePreferences, theme } = useColorModeAppearance();
  const colorModeStyle = getColorModeWidgetStyle(theme, colorModePreferences, widgetId);
  const widgetStyle = {
    ...(colorModeStyle ?? {}),
    ...(typeof targetHeight === 'number' ? { '--widget-target-height': `${targetHeight}px` } : {})
  } as CSSProperties;

  return (
    <article
      data-size-tier={sizeTier}
      data-size-tier-label={sizeTier ? WIDGET_SIZE_TIER_LABELS[sizeTier] : undefined}
      data-widget-id={widgetId}
      className={`widget-card ${collapsed ? 'widget-card--collapsed' : ''} ${
        isDragging ? 'widget-card--dragging' : ''
      } ${isDragOver ? 'widget-card--drag-over' : ''}`}
      style={widgetStyle}
    >
      <span aria-hidden="true" className="widget-card__sheen" />
      <span aria-hidden="true" className="widget-card__bezel-core" />
      <div
        className={`widget-card__header ${
          headerDragMode === 'interactive'
            ? 'widget-card__header--interactive'
            : headerDragMode === 'window'
              ? 'widget-card__header--window'
              : ''
        }`}
        onDoubleClick={onDoubleClick}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="widget-card__title-group">
          <div className="widget-card__title-copy">
            <span className="widget-card__title-row" data-tooltip-content={description || undefined}>
              <WidgetTitleIcon widgetId={widgetId} />
              <span className="widget-card__title" ref={fittedTitleRef}>
                {title}
              </span>
            </span>
          </div>
        </div>
        <div className="widget-card__meta">
          {badge ? <span className={`badge ${badgeTone === 'alert' ? 'badge--alert' : ''}`}>{badge}</span> : null}
          {headerActions ? <div className="widget-card__header-actions">{headerActions}</div> : null}
          {showCollapse ? (
            <button
              aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
              aria-expanded={!collapsed}
              className={`widget-card__collapse button-tone--utility ${
                collapsed ? 'widget-card__collapse--collapsed' : ''
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapsed?.();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              type="button"
            >
              <svg aria-hidden="true" className="widget-card__collapse-icon" viewBox="0 0 12 12">
                <path
                  d="M2.5 7.5 6 4l3.5 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <div className="widget-card__body-shell">
        <div className="widget-card__body">
          {children}
        </div>
      </div>
    </article>
  );
}

export function useFittedWidgetTitle(title: string, sizeTier?: WidgetSizeTier) {
  const titleRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const titleElement = titleRef.current;

    if (!titleElement) {
      return;
    }

    let frameId: number | null = null;
    let isDisposed = false;

    const fitTitle = () => {
      if (isDisposed) {
        return;
      }

      titleElement.style.fontSize = '';
      titleElement.removeAttribute('data-title-fitted');

      const availableWidth = titleElement.clientWidth;

      if (availableWidth <= 0) {
        return;
      }

      const computedStyle = window.getComputedStyle(titleElement);
      const baseFontSize = Number.parseFloat(computedStyle.fontSize);

      if (!Number.isFinite(baseFontSize) || baseFontSize <= 0) {
        return;
      }

      const naturalWidth = titleElement.scrollWidth;

      if (naturalWidth <= availableWidth + 1) {
        return;
      }

      const fittedFontSize = Math.max(
        Math.min(baseFontSize, WIDGET_TITLE_MIN_FONT_SIZE_PX),
        (baseFontSize * (availableWidth - 1)) / naturalWidth
      );

      if (fittedFontSize >= baseFontSize - 0.1) {
        return;
      }

      titleElement.style.fontSize = `${Math.floor(fittedFontSize * 100) / 100}px`;
      titleElement.dataset.titleFitted = 'true';
    };

    const scheduleFit = () => {
      if (isDisposed) {
        return;
      }

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        fitTitle();
      });
    };

    scheduleFit();
    document.fonts?.ready
      .then(() => {
        scheduleFit();
      })
      .catch(() => undefined);

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', scheduleFit);

      return () => {
        isDisposed = true;

        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }

        window.removeEventListener('resize', scheduleFit);
        titleElement.style.fontSize = '';
        titleElement.removeAttribute('data-title-fitted');
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleFit();
    });
    const titleGroup = titleElement.closest('.widget-card__title-group');
    const titleRow = titleElement.closest('.widget-card__title-row');

    resizeObserver.observe(titleElement);
    if (titleGroup instanceof Element) {
      resizeObserver.observe(titleGroup);
    }
    if (titleRow instanceof Element) {
      resizeObserver.observe(titleRow);
    }

    return () => {
      isDisposed = true;

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      resizeObserver.disconnect();
      titleElement.style.fontSize = '';
      titleElement.removeAttribute('data-title-fitted');
    };
  }, [sizeTier, title]);

  return titleRef;
}

export function WidgetTitleIcon({ widgetId }: { widgetId: WidgetId }) {
  const strokeProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.25
  } as const;

  switch (widgetId) {
    case 'timer':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <path {...strokeProps} d="M6 2.2h4M8 5.15V9l2.2 1.25M10.8 3.55l1.1-1.1" />
          <circle cx="8" cy="9" r="4.55" {...strokeProps} />
        </svg>
      );

    case 'bell-schedule':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <path
            {...strokeProps}
            d="M8 2.35a2.2 2.2 0 0 1 2.2 2.2v1.05c0 .84.23 1.67.66 2.39l.72 1.21H4.42l.72-1.21c.43-.72.66-1.55.66-2.39V4.55A2.2 2.2 0 0 1 8 2.35Z"
          />
          <path {...strokeProps} d="M6.65 11.1a1.35 1.35 0 0 0 2.7 0M7.15 1.8h1.7" />
        </svg>
      );

    case 'picker':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <circle cx="7.2" cy="5.25" r="2.05" {...strokeProps} />
          <path {...strokeProps} d="M3.95 11.8c.55-1.85 1.92-2.95 3.25-2.95s2.7 1.1 3.25 2.95" />
          <path {...strokeProps} d="M11.8 2.8v1.6M11 3.6h1.6" />
        </svg>
      );

    case 'group-maker':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <circle cx="8" cy="4.6" r="1.5" {...strokeProps} />
          <circle cx="4.95" cy="6.15" r="1.35" {...strokeProps} />
          <circle cx="11.05" cy="6.15" r="1.35" {...strokeProps} />
          <path {...strokeProps} d="M5.65 11.85c.5-1.6 1.5-2.45 2.35-2.45s1.85.85 2.35 2.45" />
          <path {...strokeProps} d="M2.95 11.45c.35-1.1 1.05-1.7 1.95-1.7.4 0 .8.12 1.18.38M13.05 11.45c-.35-1.1-1.05-1.7-1.95-1.7-.4 0-.8.12-1.18.38" />
        </svg>
      );

    case 'seating-chart':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <rect x="2.35" y="2.7" width="4.1" height="3.2" rx="0.7" {...strokeProps} />
          <rect x="9.55" y="2.7" width="4.1" height="3.2" rx="0.7" {...strokeProps} />
          <rect x="2.35" y="8.1" width="4.1" height="3.2" rx="0.7" {...strokeProps} />
          <rect x="9.55" y="8.1" width="4.1" height="3.2" rx="0.7" {...strokeProps} />
        </svg>
      );

    case 'planner':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <path {...strokeProps} d="M4 2.5v2M12 2.5v2M2.75 6.25h10.5M4 3.5h8A1.5 1.5 0 0 1 13.5 5v7A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5Z" />
        </svg>
      );

    case 'homework-assessment':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <path
            {...strokeProps}
            d="M5.4 2.35h5.2a.85.85 0 0 1 .85.85v.45h.9a1 1 0 0 1 1 1v7.15a1 1 0 0 1-1 1h-8.7a1 1 0 0 1-1-1V4.65a1 1 0 0 1 1-1h.9V3.2a.85.85 0 0 1 .85-.85Z"
          />
          <path {...strokeProps} d="M5.95 5.25h4.1M5.85 8.6l1.25 1.25 3-3" />
        </svg>
      );

    case 'qr-generator':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <rect x="2.3" y="2.3" width="3.7" height="3.7" {...strokeProps} />
          <rect x="10" y="2.3" width="3.7" height="3.7" {...strokeProps} />
          <rect x="2.3" y="10" width="3.7" height="3.7" {...strokeProps} />
          <path {...strokeProps} d="M10.1 10.1h1.5v1.5h-1.5zM12.6 10.1v3.2M10.1 12.6h3.2" />
        </svg>
      );

    case 'notes':
      return (
        <svg aria-hidden="true" className="widget-card__title-icon" viewBox="0 0 16 16">
          <path
            {...strokeProps}
            d="M4.6 2.35h4.85l2 2v8.3a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1v-9.3a1 1 0 0 1 1-1Z"
          />
          <path {...strokeProps} d="M9.45 2.5v2.2h2.2M5.9 7.2h4.2M5.9 9.45h4.2M5.9 11.7h2.9" />
        </svg>
      );
  }
}

export function WidgetPopoutButton({
  isActive,
  onClick,
  title
}: {
  isActive: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      aria-label={isActive ? `Unpin ${title}` : `Pin ${title}`}
      aria-pressed={isActive}
      className="widget-icon-button"
      data-window-spawn-button="true"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      data-tooltip-content={isActive ? `Unpin ${title}` : `Pin ${title}`}
      type="button"
    >
      <PopoutIcon />
    </button>
  );
}

export function PopoutWidgetActions({
  interfaceScaleControls,
  widgetId,
  title
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  widgetId: WidgetId;
  title: string;
}) {
  return (
    <>
      <InterfaceScaleControls
        canDecrease={interfaceScaleControls.canDecreaseInterfaceScale}
        canIncrease={interfaceScaleControls.canIncreaseInterfaceScale}
        onDecrease={interfaceScaleControls.decreaseInterfaceScale}
        onIncrease={interfaceScaleControls.increaseInterfaceScale}
        scale={interfaceScaleControls.interfaceScale}
      />
      <WidgetPopoutButton
        isActive
        onClick={returnToTeacherTools}
        title={title}
      />
      <button
        aria-label={`Close ${title}`}
        className="widget-icon-button widget-icon-button--close"
        onClick={(event) => {
          event.stopPropagation();
          returnToTeacherTools();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        type="button"
      >
        ×
      </button>
    </>
  );
}

export function PopoutIcon() {
  return (
    <svg aria-hidden="true" className="popout-icon" viewBox="0 0 16 16">
      <path
        d="M7.1 3.1H4.2A1.2 1.2 0 0 0 3 4.3v7.5A1.2 1.2 0 0 0 4.2 13h7.5a1.2 1.2 0 0 0 1.2-1.2V8.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path
        d="M8.7 2.9h4.4v4.4M7.4 8.6 13 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}
