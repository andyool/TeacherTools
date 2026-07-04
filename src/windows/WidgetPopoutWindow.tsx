import { useEffect, useRef } from 'react';
import { ColorModeAppearanceContext, useColorModePreferencesState } from '../app/colorMode';
import { useInterfaceScaleControls } from '../app/interfaceScale';
import { useResolvedTheme, useThemePreferenceState } from '../app/theme';
import { returnToTeacherTools } from '../app/windowContext';
import { MIN_POPOVER_HEIGHT, MIN_POPOVER_WIDTH, useAutoFitWindowToContent, useResponsiveWidgetPopoutSizeTier, useWindowResizeHandles } from '../shared/windowSizing';
import { BellScheduleWidgetPopoutCard } from '../widgets/bellSchedule';
import { GroupMakerWidgetPopoutCard } from '../widgets/groupMaker';
import { NotesWidgetPopoutCard } from '../widgets/notes';
import { PickerWidgetPopoutCard } from '../widgets/picker';
import { PlannerWidgetPopoutCard } from '../widgets/planner';
import { QrGeneratorWidgetPopoutCard } from '../widgets/qr';
import type { WidgetId } from '../widgets/registry';
import { WIDGET_POPOUT_MIN_SIZES } from '../widgets/registry';
import { SeatingChartWidgetPopoutCard } from '../widgets/seating';
import { TimerWidgetPopoutCard } from '../widgets/timer';
import { HomeworkAssessmentTrackerWidgetPopoutCard } from '../widgets/tracker';

export function WidgetPopoutWindow({
  autoSizeToContent = false,
  widgetId
}: {
  autoSizeToContent?: boolean;
  widgetId: WidgetId | null;
}) {
  const stageRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [themePreference] = useThemePreferenceState();
  const [colorModePreferences] = useColorModePreferencesState();
  const interfaceScaleControls = useInterfaceScaleControls();
  const resolvedTheme = useResolvedTheme(themePreference);
  const widgetMinSize = widgetId ? WIDGET_POPOUT_MIN_SIZES[widgetId] : null;
  const widgetSizeTier = useResponsiveWidgetPopoutSizeTier({
    scale: interfaceScaleControls.interfaceScale,
    stageRef,
    widgetId
  });
  const { stopAutoFitToContent } = useAutoFitWindowToContent({
    enabled: autoSizeToContent && widgetId !== null,
    stageRef,
    panelRef,
    scale: interfaceScaleControls.interfaceScale
  });
  const { beginResize, continueResize, endResize, isResizing } = useWindowResizeHandles({
    minWidth: widgetMinSize?.minWidth ?? MIN_POPOVER_WIDTH,
    minHeight: widgetMinSize?.minHeight ?? MIN_POPOVER_HEIGHT,
    onResizeStart: stopAutoFitToContent
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !widgetId) {
        return;
      }

      returnToTeacherTools();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [widgetId]);

  let content: React.ReactNode;

  if (!widgetId) {
    content = (
      <section className="widget-empty-state">
        <p className="empty-copy">This widget popout is missing its widget id.</p>
      </section>
    );
  } else if (widgetId === 'timer') {
    content = (
      <TimerWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else if (widgetId === 'picker') {
    content = (
      <PickerWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else if (widgetId === 'group-maker') {
    content = (
      <GroupMakerWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else if (widgetId === 'seating-chart') {
    content = (
      <SeatingChartWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else if (widgetId === 'bell-schedule') {
    content = (
      <BellScheduleWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else if (widgetId === 'planner') {
    content = (
      <PlannerWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else if (widgetId === 'homework-assessment') {
    content = (
      <HomeworkAssessmentTrackerWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else if (widgetId === 'qr-generator') {
    content = (
      <QrGeneratorWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  } else {
    content = (
      <NotesWidgetPopoutCard
        interfaceScaleControls={interfaceScaleControls}
        sizeTier={widgetSizeTier}
      />
    );
  }

  return (
    <ColorModeAppearanceContext.Provider
      value={{ preferences: colorModePreferences, theme: resolvedTheme }}
    >
      <main
        aria-label="Widget popout"
        className={`window-stage window-stage--builder window-stage--widget-popout${
          isResizing ? ' window-stage--resizing' : ''
        }`}
        data-widget-size-tier={widgetId ? widgetSizeTier : undefined}
        ref={stageRef}
      >
        <section
          className="panel panel--builder panel--widget-popout"
          data-theme={resolvedTheme}
          ref={panelRef}
        >
          <div aria-hidden="true" className="panel__glass" />
          <div aria-hidden="true" className="panel__gloss" />
          <div aria-hidden="true" className="panel__bezel-mid" />
          <div className="panel__content panel__content--popout">{content}</div>
        </section>

        {widgetId ? (
          <>
            <button
              aria-label="Resize window from bottom left corner"
              className="resize-handle resize-handle--left"
              data-tooltip-content="Resize window"
              onPointerCancel={endResize}
              onPointerDown={(event) => beginResize('bottom-left', event)}
              onPointerMove={continueResize}
              onPointerUp={endResize}
              type="button"
            />
            <button
              aria-label="Resize window from bottom right corner"
              className="resize-handle resize-handle--right"
              data-tooltip-content="Resize window"
              onPointerCancel={endResize}
              onPointerDown={(event) => beginResize('bottom-right', event)}
              onPointerMove={continueResize}
              onPointerUp={endResize}
              type="button"
            />
          </>
        ) : null}
      </main>
    </ColorModeAppearanceContext.Provider>
  );
}
