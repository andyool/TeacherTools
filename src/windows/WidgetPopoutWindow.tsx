import { useEffect, useRef, useState } from 'react';
import { ColorModeAppearanceContext, useColorModePreferencesState } from '../app/colorMode';
import { usePersistentState } from '../shared/persistence';
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

// Widgets whose content is scoped to the active class list.
const CLASS_SCOPED_WIDGET_IDS = new Set<WidgetId>([
  'picker',
  'group-maker',
  'seating-chart',
  'homework-assessment',
  'notes',
  'planner'
]);

/**
 * Reads the shared class selection straight from the picker store so popouts
 * can show and switch the active class. Raw access (no picker.tsx imports)
 * keeps this independent of the picker widget's internals; writes spread the
 * previous snapshot so unknown fields survive untouched.
 */
function usePopoutClassSelection() {
  const [picker, setPicker] = usePersistentState<Record<string, unknown>>('teacher-tools.picker', {});

  const rawLists = Array.isArray(picker.lists) ? picker.lists : [];
  const lists = rawLists.filter(
    (list): list is { id: string; name: string; archived?: boolean } =>
      Boolean(
        list &&
          typeof (list as { id?: unknown }).id === 'string' &&
          typeof (list as { name?: unknown }).name === 'string'
      ) && (list as { archived?: boolean }).archived !== true
  );
  const selectedListId = typeof picker.selectedListId === 'string' ? picker.selectedListId : '';
  const selectedList = lists.find((list) => list.id === selectedListId) ?? null;

  const selectList = (listId: string) => {
    setPicker((current) => ({ ...current, selectedListId: listId }));
  };

  return { lists, selectedList, selectList };
}

function PopoutClassBar() {
  const { lists, selectedList, selectList } = usePopoutClassSelection();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const closeMenu = () => setIsMenuOpen(false);
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, [isMenuOpen]);

  if (lists.length === 0) {
    return null;
  }

  return (
    <div className="popout-class-bar">
      <button
        aria-expanded={isMenuOpen}
        aria-haspopup="listbox"
        aria-label={`Class ${selectedList?.name ?? 'not selected'}. Switch class.`}
        className="popout-class-bar__chip"
        onClick={() => setIsMenuOpen((current) => !current)}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <span className="popout-class-bar__kicker">Class</span>
        <span className="popout-class-bar__name">{selectedList?.name ?? '—'}</span>
        <span aria-hidden="true" className="popout-class-bar__chevron">▾</span>
      </button>
      {isMenuOpen ? (
        <div className="popout-class-bar__menu" role="listbox">
          {lists.map((list) => (
            <button
              aria-selected={list.id === selectedList?.id}
              className={`popout-class-bar__option${
                list.id === selectedList?.id ? ' popout-class-bar__option--active' : ''
              }`}
              key={list.id}
              onClick={() => {
                selectList(list.id);
                setIsMenuOpen(false);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              role="option"
              type="button"
            >
              {list.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
          <div className="panel__content panel__content--popout">
            {widgetId && CLASS_SCOPED_WIDGET_IDS.has(widgetId) ? <PopoutClassBar /> : null}
            {content}
          </div>
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
