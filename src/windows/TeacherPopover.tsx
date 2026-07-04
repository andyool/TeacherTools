import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { TimerChimeSound, TimerSpeechVoice } from '../electron-types';
import { useAppSettingsState } from '../app/appSettings';
import { getAppUpdateActionErrorMessage, getAppUpdateButtonLabel, getAppUpdateStatusLabel, getAppUpdateStatusTone, useAppUpdateState } from '../app/appUpdate';
import type { ColorModePaletteTarget, ColorModeSwatchId } from '../app/colorMode';
import { ColorModeAppearanceContext, ColorModePalette, ColorModeTriggerButton, getColorModePanelStyle, useColorModePreferencesState } from '../app/colorMode';
import { useInterfaceScaleControls } from '../app/interfaceScale';
import { SettingsCogIcon, getNextThemePreference, useResolvedTheme, useThemePreferenceState } from '../app/theme';
import { useWidgetPopoutIds } from '../app/windowContext';
import { formatLongDate } from '../shared/dates';
import { usePersistentState } from '../shared/persistence';
import { clampNumber, haveSameStudents } from '../shared/utils';
import { MIN_POPOVER_HEIGHT, MIN_POPOVER_WIDTH, useWindowResizeHandles } from '../shared/windowSizing';
import { BellScheduleWidgetContent, getActiveBellScheduleClassListId, useBellScheduleController } from '../widgets/bellSchedule';
import { WidgetCard, WidgetPopoutButton } from '../widgets/chrome';
import { activateClassList } from '../widgets/classLists';
import type { DashboardMetrics, WidgetHeightModels, WidgetLayout, WidgetSizeTier } from '../widgets/dashboard';
import { DASHBOARD_FIT_SCALE_MIN, DASHBOARD_SHELL_SHADOW_PAD, WIDGET_SIZE_MAX, WIDGET_SIZE_MIN, WIDGET_SIZE_TIER_ZOOM, buildResponsiveDashboardLayout, computeDashboardMetrics, getWidgetDashboardHeight, getWidgetLayoutForList, reorderWidgetIds, toggleWidgetIdInList, updateWidgetLayoutForList, useDashboardLayoutsState } from '../widgets/dashboard';
import { GroupMakerWidgetContent, useGroupMakerWidgetState } from '../widgets/groupMaker';
import { getGroupRulesForList, useGroupRulesState } from '../widgets/groupRules';
import { NotesWidgetContent, useNotesWidgetState } from '../widgets/notes';
import { PickerWidgetContent, usePickerWidgetState } from '../widgets/picker';
import { PlannerWidgetContent, findNextLessonDateKey, formatSchoolDateLabel, useLessonPlannerController, usePlannerPopoutModeState } from '../widgets/planner';
import { QrGeneratorWidgetContent, useQrWidgetState } from '../widgets/qr';
import type { WidgetId } from '../widgets/registry';
import { WIDGET_DETAILS, isWidgetId } from '../widgets/registry';
import { SeatingChartWidgetContent, useSeatingChartController } from '../widgets/seating';
import { TimerWidgetContent, playTimerChime, primeTimerAudio, useTimerWidgetState } from '../widgets/timer';
import { HomeworkAssessmentTrackerWidgetContent, useHomeworkAssessmentPopoutModeState, useHomeworkAssessmentTrackerController } from '../widgets/tracker';
import { SettingsPopover } from './SettingsPopover';

function normalizeSeatingFollowFlag(raw: unknown, initialValue: boolean) {
  return typeof raw === 'boolean' ? raw : initialValue;
}

export function TeacherPopover() {
  const classMenuRef = useRef<HTMLDivElement | null>(null);
  const colorModePopoverRef = useRef<HTMLElement | null>(null);
  const dashboardShellRef = useRef<HTMLDivElement | null>(null);
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const dragOverWidgetIdRef = useRef<WidgetId | null>(null);
  const didApplyScheduledClassRef = useRef(false);
  const widgetDragAnimationFrameRef = useRef<number | null>(null);
  const widgetDragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const widgetDragStateRef = useRef<{
    draggedWidgetId: WidgetId;
    hasMoved: boolean;
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
  } | null>(null);
  const timerController = useTimerWidgetState();
  const pickerController = usePickerWidgetState();
  const { picker, setPicker } = pickerController;
  const groupMakerController = useGroupMakerWidgetState(picker);
  const [groupRulesSnapshot] = useGroupRulesState();
  const [seatingFollowsTimetable, setSeatingFollowsTimetable] = usePersistentState<boolean>(
    'teacher-tools.seating-follow-timetable',
    true,
    {
      normalize: normalizeSeatingFollowFlag
    }
  );
  const [dashboardLayouts, setDashboardLayouts] = useDashboardLayoutsState();
  const planner = useLessonPlannerController(picker.selectedListId, picker.lists);
  const [, setPlannerPopoutMode] = usePlannerPopoutModeState();
  const homeworkAssessmentTracker = useHomeworkAssessmentTrackerController(
    picker.selectedListId,
    picker.lists
  );
  const [, setHomeworkAssessmentPopoutMode] = useHomeworkAssessmentPopoutModeState();
  const bellSchedule = useBellScheduleController(picker.lists);
  const qrGenerator = useQrWidgetState();
  const [themePreference, setThemePreference] = useThemePreferenceState();
  const [colorModePreferences, setColorModePreferences] = useColorModePreferencesState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const [isClassMenuOpen, setIsClassMenuOpen] = useState(false);
  const isPickerSpinning = pickerController.isPickerSpinning;
  const [draggedWidgetId, setDraggedWidgetId] = useState<WidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<WidgetId | null>(null);
  const [colorModePaletteTarget, setColorModePaletteTarget] = useState<ColorModePaletteTarget | null>(
    null
  );
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics>(() =>
    computeDashboardMetrics(MIN_POPOVER_WIDTH, 0)
  );
  const [dashboardMeasuredFitBuffer, setDashboardMeasuredFitBuffer] = useState(0);
  const [dashboardFitScale, setDashboardFitScale] = useState(1);
  const [dashboardForceScroll, setDashboardForceScroll] = useState(false);
  const widgetHeightModelsRef = useRef<WidgetHeightModels>({});
  const [widgetHeightModels, setWidgetHeightModels] = useState<WidgetHeightModels>({});
  const [appUpdate, setAppUpdate] = useAppUpdateState();
  const [appSettings, setAppSettings] = useAppSettingsState();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLaunchAtLoginSaving, setIsLaunchAtLoginSaving] = useState(false);
  const openWidgetPopouts = useWidgetPopoutIds();
  const now = timerController.now;
  const resolvedTheme = useResolvedTheme(themePreference);
  const nextThemePreference = getNextThemePreference(themePreference);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const scheduledClassListId = getActiveBellScheduleClassListId(bellSchedule.currentEntry);
  const selectedStudents = selectedList?.students ?? [];
  const liveClassList = scheduledClassListId
    ? picker.lists.find((list) => list.id === scheduledClassListId) ?? null
    : null;
  const seatingPreviewList =
    seatingFollowsTimetable && liveClassList ? liveClassList : selectedList;
  const seatingChart = useSeatingChartController(seatingPreviewList, {
    apartPairs: getGroupRulesForList(
      groupRulesSnapshot,
      seatingPreviewList?.id ?? null,
      seatingPreviewList?.students ?? []
    ).apart
  });
  const notes = useNotesWidgetState(selectedList, picker.lists);
  const selectedLayout = getWidgetLayoutForList(dashboardLayouts, picker.selectedListId);
  const visibleWidgetIds = selectedLayout.order.filter((widgetId) => !selectedLayout.hidden.includes(widgetId));
  const visibleWidgetKey = visibleWidgetIds.join('|');
  const collapsedWidgetKey = selectedLayout.collapsed.join('|');
  const { beginResize, continueResize, endResize, isResizing } = useWindowResizeHandles({
    minWidth: MIN_POPOVER_WIDTH,
    minHeight: MIN_POPOVER_HEIGHT
  });
  const dashboardLayoutFit = useMemo(
    () =>
      buildResponsiveDashboardLayout({
        availableHeight: Math.max(0, dashboardMetrics.height - dashboardMeasuredFitBuffer),
        collapsedWidgetIds: selectedLayout.collapsed,
        columnCount: dashboardMetrics.columnCount,
        widgetHeightModels,
        widgetIds: visibleWidgetIds
      }),
    [
      collapsedWidgetKey,
      dashboardMeasuredFitBuffer,
      dashboardMetrics.columnCount,
      dashboardMetrics.height,
      visibleWidgetKey,
      widgetHeightModels
    ]
  );

  useLayoutEffect(() => {
    if (didApplyScheduledClassRef.current) {
      return;
    }

    didApplyScheduledClassRef.current = true;

    if (!scheduledClassListId) {
      return;
    }

    setPicker((current) => activateClassList(current, scheduledClassListId));
  }, [scheduledClassListId, setPicker]);

  const dashboardColumns = dashboardLayoutFit.columns;
  const dashboardColumnKey = dashboardColumns.map((column) => column.widgetIds.join(',')).join('|');
  const dashboardSizeTierKey = visibleWidgetIds
    .map((widgetId) => `${widgetId}:${dashboardLayoutFit.widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX}`)
    .join('|');
  const dashboardHasMinimumFunctionalSizes = visibleWidgetIds.every(
    (widgetId) =>
      selectedLayout.collapsed.includes(widgetId) ||
      (dashboardLayoutFit.widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX) <= WIDGET_SIZE_MIN
  );
  const shouldPreferDashboardScroll = dashboardMetrics.columnCount <= 1;
  const shouldAllowDashboardScroll =
    shouldPreferDashboardScroll || dashboardLayoutFit.isScrollable || dashboardForceScroll;
  const effectiveDashboardFitScale = shouldAllowDashboardScroll ? 1 : dashboardFitScale;
  const rosterCount = selectedStudents.length;
  const nextLessonDateKey = selectedList
    ? findNextLessonDateKey(bellSchedule.weekTimelineByDay, selectedList.id, planner.selectedDate)
    : null;
  const todayLabel = formatSchoolDateLabel(new Date(now));
  const appUpdateButtonLabel = getAppUpdateButtonLabel(appUpdate);
  const appUpdateStatusLabel = getAppUpdateStatusLabel(appUpdate);
  const appUpdateStatusTone = getAppUpdateStatusTone(appUpdate);
  const appUpdateActionDisabled =
    appUpdate.status === 'checking' ||
    appUpdate.status === 'available' ||
    appUpdate.status === 'downloading' ||
    appUpdate.status === 'unsupported';
  const plannerBadgeLabel = planner.documents.length > 0 ? `${planner.documents.length}` : null;
  const seatingChartBadgeLabel = seatingPreviewList
    ? `${seatingChart.assignedSeatCount}/${seatingPreviewList.students.length}`
    : null;
  const plannerHint = !selectedList
    ? 'Choose a class list to plan lessons by date.'
    : planner.hasContent
      ? `Saved for ${formatLongDate(planner.selectedDate)}.`
      : `Plan ${selectedList.name} for ${formatLongDate(planner.selectedDate)}.`;
  const handleAppUpdateAction = () => {
    if (appUpdate.status === 'downloaded') {
      const installAppUpdate = window.electronAPI?.installAppUpdate;

      if (!installAppUpdate) {
        setAppUpdate((current) => ({
          ...current,
          message: 'The desktop update bridge is unavailable. Restart TeacherTools and try again.',
          progressPercent: null,
          status: 'error'
        }));
        return;
      }

      setAppUpdate((current) => ({
        ...current,
        message: 'Closing TeacherTools to install the downloaded update.',
        progressPercent: 100,
        status: 'downloaded'
      }));

      void installAppUpdate()
        .then((didStartInstall) => {
          if (!didStartInstall) {
            setAppUpdate((current) => ({
              ...current,
              message: 'The downloaded update was not ready to install. Try checking again.',
              progressPercent: null,
              status: 'error'
            }));
          }
        })
        .catch((error) => {
          setAppUpdate((current) => ({
            ...current,
            message: getAppUpdateActionErrorMessage(error),
            progressPercent: null,
            status: 'error'
          }));
        });
      return;
    }

    const checkForAppUpdates = window.electronAPI?.checkForAppUpdates;

    if (!checkForAppUpdates) {
      setAppUpdate((current) => ({
        ...current,
        message: 'The desktop update bridge is unavailable. Restart TeacherTools and try again.',
        progressPercent: null,
        status: 'error'
      }));
      return;
    }

    setAppUpdate((current) => ({
      ...current,
      availableVersion: null,
      message: 'Checking GitHub Releases for a newer version.',
      progressPercent: null,
      status: 'checking'
    }));

    void checkForAppUpdates()
      .then((nextState) => {
        setAppUpdate(nextState);
      })
      .catch((error) => {
        setAppUpdate((current) => ({
          ...current,
          message: getAppUpdateActionErrorMessage(error),
          progressPercent: null,
          status: 'error'
        }));
      });
  };

  const handleLaunchAtLoginChange = (enabled: boolean) => {
    const setLaunchAtLogin = window.electronAPI?.setLaunchAtLogin;

    if (!setLaunchAtLogin) {
      return;
    }

    setIsLaunchAtLoginSaving(true);
    setAppSettings((current) => ({
      ...current,
      launchAtLogin: enabled
    }));

    void setLaunchAtLogin(enabled)
      .then((settings) => {
        setAppSettings(settings);
      })
      .catch(() => {
        setAppSettings((current) => ({
          ...current,
          launchAtLogin: !enabled
        }));
      })
      .finally(() => {
        setIsLaunchAtLoginSaving(false);
      });
  };

  const handleTimerSpeechVoiceChange = (voice: TimerSpeechVoice) => {
    const setTimerSpeechVoice = window.electronAPI?.setTimerSpeechVoice;

    setAppSettings((current) => ({
      ...current,
      timerSpeechVoice: voice
    }));

    if (!setTimerSpeechVoice) {
      return;
    }

    void setTimerSpeechVoice(voice)
      .then((settings) => {
        setAppSettings(settings);
      })
      .catch(() => {
        setAppSettings((current) => ({
          ...current,
          timerSpeechVoice: voice === 'male' ? 'female' : 'male'
        }));
      });
  };

  const handleTimerVoiceEnabledChange = (enabled: boolean) => {
    const setTimerVoiceEnabled = window.electronAPI?.setTimerVoiceEnabled;

    setAppSettings((current) => ({
      ...current,
      timerVoiceEnabled: enabled
    }));

    if (!setTimerVoiceEnabled) {
      return;
    }

    void setTimerVoiceEnabled(enabled)
      .then((settings) => {
        setAppSettings(settings);
      })
      .catch(() => {
        setAppSettings((current) => ({
          ...current,
          timerVoiceEnabled: !enabled
        }));
      });
  };

  const handleTimerChimeEnabledChange = (enabled: boolean) => {
    const setTimerChimeEnabled = window.electronAPI?.setTimerChimeEnabled;

    setAppSettings((current) => ({
      ...current,
      timerChimeEnabled: enabled
    }));

    if (!setTimerChimeEnabled) {
      return;
    }

    void setTimerChimeEnabled(enabled)
      .then((settings) => {
        setAppSettings(settings);
      })
      .catch(() => {
        setAppSettings((current) => ({
          ...current,
          timerChimeEnabled: !enabled
        }));
      });
  };

  const handleTimerChimeSoundChange = (sound: TimerChimeSound) => {
    const previousSound = appSettings.timerChimeSound;
    const setTimerChimeSound = window.electronAPI?.setTimerChimeSound;

    setAppSettings((current) => ({
      ...current,
      timerChimeSound: sound
    }));
    primeTimerAudio();
    playTimerChime('done', sound);

    if (!setTimerChimeSound) {
      return;
    }

    void setTimerChimeSound(sound)
      .then((settings) => {
        setAppSettings(settings);
      })
      .catch(() => {
        setAppSettings((current) => ({
          ...current,
          timerChimeSound: previousSound
        }));
      });
  };

  const closeColorModePalette = () => {
    setColorModePaletteTarget(null);
  };

  const toggleColorModePalette = (target: ColorModePaletteTarget) => {
    setColorModePaletteTarget((current) => {
      if (current?.kind !== target.kind) {
        return target;
      }

      if (target.kind === 'background') {
        return null;
      }

      if (current.kind !== 'widget') {
        return target;
      }

      return current.widgetId === target.widgetId ? null : target;
    });
  };

  const setWidgetColorModeSwatch = (widgetId: WidgetId, swatchId: ColorModeSwatchId) => {
    setColorModePreferences((current) => {
      if (current.widgetColorsByWidgetId[widgetId] === swatchId) {
        return current;
      }

      return {
        ...current,
        widgetColorsByWidgetId: {
          ...current.widgetColorsByWidgetId,
          [widgetId]: swatchId
        }
      };
    });
  };

  const setBackgroundColorModeSwatch = (swatchId: ColorModeSwatchId) => {
    setColorModePreferences((current) =>
      current.backgroundColorId === swatchId
        ? current
        : {
            ...current,
            backgroundColorId: swatchId
          }
    );
  };

  useLayoutEffect(() => {
    const dashboardShell = dashboardShellRef.current;

    if (!dashboardShell) {
      return;
    }

    let frameId = 0;

    const syncDashboardLayout = () => {
      const nextMetrics = computeDashboardMetrics(
        dashboardShell.clientWidth - DASHBOARD_SHELL_SHADOW_PAD * 2,
        dashboardShell.clientHeight - DASHBOARD_SHELL_SHADOW_PAD * 2
      );
      setDashboardMetrics((current) =>
        current.columnCount === nextMetrics.columnCount &&
        current.gap === nextMetrics.gap &&
        current.height === nextMetrics.height
          ? current
          : nextMetrics
      );
    };

    const scheduleDashboardSync = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncDashboardLayout);
    };

    syncDashboardLayout();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleDashboardSync();
    });

    resizeObserver.observe(dashboardShell);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [interfaceScale, visibleWidgetKey]);

  useLayoutEffect(() => {
    const dashboardShell = dashboardShellRef.current;

    if (!dashboardShell || visibleWidgetIds.length === 0) {
      return;
    }

    let frameId = 0;

    const measureWidgetHeights = () => {
      const cards = Array.from(
        dashboardShell.querySelectorAll<HTMLElement>('.widget-card[data-widget-id]')
      );
      let nextModels: WidgetHeightModels | null = null;

      for (const card of cards) {
        const widgetId = card.dataset.widgetId;
        const tierRaw = Number(card.dataset.sizeTier);

        if (
          !widgetId ||
          !isWidgetId(widgetId) ||
          !Number.isInteger(tierRaw) ||
          tierRaw < WIDGET_SIZE_MIN ||
          tierRaw > WIDGET_SIZE_MAX ||
          selectedLayout.collapsed.includes(widgetId)
        ) {
          continue;
        }

        const tier = tierRaw as WidgetSizeTier;
        const body = card.querySelector<HTMLElement>('.widget-card__body');

        if (!body || card.offsetHeight === 0) {
          continue;
        }

        const naturalHeight = Math.ceil(card.offsetHeight);
        const currentModel = (nextModels ?? widgetHeightModelsRef.current)[widgetId];
        const knownHeight = currentModel?.measuredByTier[tier];

        if (knownHeight !== undefined && Math.abs(knownHeight - naturalHeight) <= 2) {
          continue;
        }

        const bodyLayoutHeight = body.offsetHeight;
        const chromeHeight = Math.max(
          0,
          Math.round(naturalHeight - bodyLayoutHeight * WIDGET_SIZE_TIER_ZOOM[tier])
        );
        // A changed reading at an already-measured tier means the widget's
        // content changed, so readings taken at the other tiers are stale.
        const measuredByTier: Partial<Record<WidgetSizeTier, number>> =
          knownHeight === undefined ? { ...(currentModel?.measuredByTier ?? {}) } : {};
        measuredByTier[tier] = naturalHeight;
        nextModels = {
          ...(nextModels ?? widgetHeightModelsRef.current),
          [widgetId]: { bodyLayoutHeight, chromeHeight, measuredByTier }
        };
      }

      if (nextModels) {
        widgetHeightModelsRef.current = nextModels;
        setWidgetHeightModels(nextModels);
      }
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureWidgetHeights);
    };

    measureWidgetHeights();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure();
    });

    for (const card of Array.from(
      dashboardShell.querySelectorAll<HTMLElement>('.widget-card[data-widget-id]')
    )) {
      resizeObserver.observe(card);
      const body = card.querySelector<HTMLElement>('.widget-card__body');
      if (body) {
        resizeObserver.observe(body);
      }
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [collapsedWidgetKey, dashboardColumnKey, dashboardSizeTierKey, visibleWidgetKey]);

  useEffect(() => {
    setDashboardMeasuredFitBuffer(0);
    setDashboardFitScale(1);
    setDashboardForceScroll(false);
  }, [
    collapsedWidgetKey,
    dashboardMetrics.columnCount,
    dashboardMetrics.height,
    interfaceScale,
    visibleWidgetKey
  ]);

  useEffect(() => {
    if (shouldPreferDashboardScroll || dashboardLayoutFit.isScrollable) {
      setDashboardFitScale(1);
      setDashboardForceScroll(false);
    }
  }, [dashboardLayoutFit.isScrollable, shouldPreferDashboardScroll]);

  useLayoutEffect(() => {
    const dashboardShell = dashboardShellRef.current;

    if (!dashboardShell || visibleWidgetIds.length === 0 || isResizing) {
      return;
    }

    let frameId = 0;

    const measureRenderedOverflow = () => {
      const shellBounds = dashboardShell.getBoundingClientRect();
      const measuredElements = Array.from(
        dashboardShell.querySelectorAll<HTMLElement>('.dashboard-column, .widget-card, .widget-card__body')
      );
      const maxMeasuredBottom = measuredElements.reduce(
        (maxBottom, element) => Math.max(maxBottom, element.getBoundingClientRect().bottom),
        shellBounds.top
      );
      const contentHeight = Math.max(1, Math.ceil(maxMeasuredBottom - shellBounds.top));
      const rectOverflow = Math.max(0, Math.ceil(maxMeasuredBottom - shellBounds.bottom));
      const scrollOverflow = Math.max(0, dashboardShell.scrollHeight - dashboardShell.clientHeight);
      const overflow = Math.max(rectOverflow, scrollOverflow);

      if (overflow <= 0) {
        if (dashboardForceScroll) {
          setDashboardForceScroll(false);
        }
        return;
      }

      if (overflow > 0 && dashboardHasMinimumFunctionalSizes) {
        if (!dashboardForceScroll) {
          setDashboardForceScroll(true);
        }
        return;
      }

      if (overflow > 0 && !dashboardLayoutFit.isScrollable) {
        setDashboardMeasuredFitBuffer((current) => current + overflow + 8);
        return;
      }

      if (shouldPreferDashboardScroll) {
        return;
      }

      if (dashboardLayoutFit.isScrollable) {
        return;
      }

      if (!dashboardLayoutFit.isScrollable && dashboardFitScale >= 0.995) {
        return;
      }

      const safeHeight = Math.max(shellBounds.height - 6, 1);
      const nextScale = clampNumber(
        (dashboardFitScale * safeHeight) / contentHeight,
        DASHBOARD_FIT_SCALE_MIN,
        1
      );

      if (Math.abs(nextScale - dashboardFitScale) > 0.01) {
        if (dashboardForceScroll) {
          setDashboardForceScroll(false);
        }
        setDashboardFitScale(nextScale);
        return;
      }

      if (
        overflow > 2 &&
        dashboardLayoutFit.isScrollable &&
        dashboardFitScale <= DASHBOARD_FIT_SCALE_MIN + 0.01 &&
        !dashboardForceScroll
      ) {
        setDashboardForceScroll(true);
      }
    };

    measureRenderedOverflow();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureRenderedOverflow);
    });

    resizeObserver.observe(dashboardShell);

    const dashboardColumnsElement = dashboardShell.querySelector<HTMLElement>('.dashboard-columns');
    if (dashboardColumnsElement) {
      resizeObserver.observe(dashboardColumnsElement);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [
    collapsedWidgetKey,
    dashboardColumnKey,
    dashboardForceScroll,
    dashboardHasMinimumFunctionalSizes,
    dashboardLayoutFit.isScrollable,
    dashboardFitScale,
    dashboardMetrics.height,
    dashboardMeasuredFitBuffer,
    dashboardSizeTierKey,
    isResizing,
    shouldPreferDashboardScroll,
    visibleWidgetIds.length
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return;
      }

      if (isClassMenuOpen) {
        setIsClassMenuOpen(false);
        return;
      }

      window.electronAPI?.closePopover();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isClassMenuOpen, isSettingsOpen]);

  useEffect(() => {
    if (!isClassMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (classMenuRef.current?.contains(event.target)) {
        return;
      }

      setIsClassMenuOpen(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isClassMenuOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (settingsPopoverRef.current?.contains(event.target)) {
        return;
      }

      setIsSettingsOpen(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isSettingsOpen]);

  useEffect(() => {
    return () => {
      if (widgetDragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(widgetDragAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isPickerSpinning) {
      setIsClassMenuOpen(false);
    }
  }, [isPickerSpinning]);

  useEffect(() => {
    if (resolvedTheme === 'color' && draggedWidgetId === null) {
      return;
    }

    closeColorModePalette();
  }, [draggedWidgetId, resolvedTheme]);

  useEffect(() => {
    if (
      !colorModePaletteTarget ||
      colorModePaletteTarget.kind !== 'widget' ||
      visibleWidgetIds.includes(colorModePaletteTarget.widgetId)
    ) {
      return;
    }

    closeColorModePalette();
  }, [colorModePaletteTarget, visibleWidgetKey]);

  useEffect(() => {
    const handleViewportChange = () => {
      closeColorModePalette();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, []);

  useEffect(() => {
    if (!colorModePaletteTarget) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (colorModePopoverRef.current?.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest('[data-color-mode-trigger]')) {
        return;
      }

      closeColorModePalette();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeColorModePalette();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorModePaletteTarget]);

  const updateSelectedLayout = (updater: (layout: WidgetLayout) => WidgetLayout) => {
    setDashboardLayouts((current) => updateWidgetLayoutForList(current, picker.selectedListId, updater));
  };

  const toggleWidgetCollapsed = (widgetId: WidgetId) => {
    updateSelectedLayout((layout) => ({
      ...layout,
      collapsed: toggleWidgetIdInList(layout.collapsed, widgetId)
    }));
  };

  const moveWidget = (fromId: WidgetId, toId: WidgetId) => {
    if (fromId === toId) {
      return;
    }

    updateSelectedLayout((layout) => ({
      ...layout,
      order: reorderWidgetIds(layout.order, fromId, toId)
    }));
  };

  const setWidgetDragging = (widgetId: WidgetId | null) => {
    setDraggedWidgetId((current) => (current === widgetId ? current : widgetId));
    if (widgetId === null) {
      dragOverWidgetIdRef.current = null;
      setDragOverWidgetId(null);
    }
  };

  const getWidgetIdUnderPointer = (clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY);
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const widgetElement = target.closest<HTMLElement>('[data-widget-id]');
    const nextWidgetId = widgetElement?.dataset.widgetId;
    return nextWidgetId && isWidgetId(nextWidgetId) ? nextWidgetId : null;
  };

  const beginWidgetDrag = (widgetId: WidgetId, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    closeColorModePalette();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    widgetDragStateRef.current = {
      draggedWidgetId: widgetId,
      hasMoved: false,
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY
    };
  };

  const continueWidgetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = widgetDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startPointerX,
      event.clientY - dragState.startPointerY
    );

    if (!dragState.hasMoved && distance < 6) {
      return;
    }

    event.preventDefault();

    if (!dragState.hasMoved) {
      dragState.hasMoved = true;
      setWidgetDragging(dragState.draggedWidgetId);
    }

    widgetDragPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };

    if (widgetDragAnimationFrameRef.current === null) {
      widgetDragAnimationFrameRef.current = window.requestAnimationFrame(() => {
        widgetDragAnimationFrameRef.current = null;
        const pointer = widgetDragPointerRef.current;
        if (!pointer || !widgetDragStateRef.current?.hasMoved) {
          return;
        }

        const hoveredWidgetId = getWidgetIdUnderPointer(pointer.clientX, pointer.clientY);
        if (dragOverWidgetIdRef.current !== hoveredWidgetId) {
          dragOverWidgetIdRef.current = hoveredWidgetId;
          setDragOverWidgetId(hoveredWidgetId);
        }
      });
    }
  };

  const finishWidgetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = widgetDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const hoveredWidgetId = getWidgetIdUnderPointer(event.clientX, event.clientY);
    const shouldMove =
      dragState.hasMoved &&
      hoveredWidgetId !== null &&
      hoveredWidgetId !== dragState.draggedWidgetId;

    widgetDragStateRef.current = null;
    widgetDragPointerRef.current = null;
    if (widgetDragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(widgetDragAnimationFrameRef.current);
      widgetDragAnimationFrameRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (shouldMove && hoveredWidgetId) {
      moveWidget(dragState.draggedWidgetId, hoveredWidgetId);
    }

    setWidgetDragging(null);
  };

  const cancelWidgetDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = widgetDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    widgetDragStateRef.current = null;
    widgetDragPointerRef.current = null;
    if (widgetDragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(widgetDragAnimationFrameRef.current);
      widgetDragAnimationFrameRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setWidgetDragging(null);
  };

  const selectClassList = (listId: string) => {
    if (isPickerSpinning) {
      return;
    }

    setPicker((current) => activateClassList(current, listId));
    setIsClassMenuOpen(false);
  };

  const toggleWidgetPopout = (widgetId: WidgetId) => {
    window.electronAPI?.toggleWidgetPopout(widgetId);
  };

  const openWeeklyPlannerPopout = () => {
    setPlannerPopoutMode('week');

    if (!openWidgetPopouts.includes('planner')) {
      toggleWidgetPopout('planner');
    }
  };

  const renderWidget = (widgetId: WidgetId) => {
    const collapsed = selectedLayout.collapsed.includes(widgetId);
    const isDragging = draggedWidgetId === widgetId;
    const isDragOver = dragOverWidgetId === widgetId && draggedWidgetId !== widgetId;
    const isPopoutOpen = openWidgetPopouts.includes(widgetId);
    const isColorModePaletteOpen =
      colorModePaletteTarget?.kind === 'widget' && colorModePaletteTarget.widgetId === widgetId;
    const sizeTier = dashboardLayoutFit.widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX;
    const targetHeight = getWidgetDashboardHeight(widgetId, sizeTier, collapsed, widgetHeightModels);

    const dragProps = {
      onPointerCancel: cancelWidgetDrag,
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => beginWidgetDrag(widgetId, event),
      onPointerMove: continueWidgetDrag,
      onPointerUp: finishWidgetDrag
    };

    const headerActions =
      <>
        {resolvedTheme === 'color' ? (
          <ColorModeTriggerButton
            active={isColorModePaletteOpen}
            appearance="widget"
            label={`Change colour for ${WIDGET_DETAILS[widgetId].title}`}
            onClick={(event) =>
              toggleColorModePalette({
                anchorRect: event.currentTarget.getBoundingClientRect(),
                kind: 'widget',
                widgetId
              })
            }
            swatchId={colorModePreferences.widgetColorsByWidgetId[widgetId]}
            variant="widget"
          />
        ) : null}
        {widgetId === 'bell-schedule' ? (
          <WidgetPopoutButton
            isActive={isPopoutOpen}
            onClick={() => {
              bellSchedule.setPopoutMode('summary');
              toggleWidgetPopout(widgetId);
            }}
            title={WIDGET_DETAILS[widgetId].title}
          />
        ) : widgetId === 'homework-assessment' ? (
          <WidgetPopoutButton
            isActive={isPopoutOpen}
            onClick={() => {
              setHomeworkAssessmentPopoutMode('editor');
              toggleWidgetPopout(widgetId);
            }}
            title={WIDGET_DETAILS[widgetId].title}
          />
        ) : widgetId === 'planner' ? (
          <WidgetPopoutButton
            isActive={isPopoutOpen}
            onClick={() => {
              setPlannerPopoutMode('editor');
              toggleWidgetPopout(widgetId);
            }}
            title={WIDGET_DETAILS[widgetId].title}
          />
        ) : (
          <WidgetPopoutButton
            isActive={isPopoutOpen}
            onClick={() => toggleWidgetPopout(widgetId)}
            title={WIDGET_DETAILS[widgetId].title}
          />
        )}
      </>;

    if (widgetId === 'timer') {
      return (
        <WidgetCard
          badge={timerController.timerStatusLabel}
          badgeTone={timerController.isTimerFinished ? 'alert' : 'default'}
          collapsed={collapsed}
          description={WIDGET_DETAILS.timer.description}
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <TimerWidgetContent controller={timerController} />
        </WidgetCard>
      );
    }

    if (widgetId === 'picker') {
      return (
        <WidgetCard
          badge={`${rosterCount}`}
          collapsed={collapsed}
          description={selectedList ? `Using ${selectedList.name}` : 'Choose a class from the top bar.'}
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <PickerWidgetContent controller={pickerController} />
        </WidgetCard>
      );
    }

    if (widgetId === 'group-maker') {
      return (
        <WidgetCard
          badge={groupMakerController.groupBadgeLabel}
          collapsed={collapsed}
          description={selectedList ? `Using ${selectedList.name}` : 'Choose a class from the top bar.'}
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <GroupMakerWidgetContent controller={groupMakerController} />
        </WidgetCard>
      );
    }

    if (widgetId === 'seating-chart') {
      return (
        <WidgetCard
          badge={seatingChartBadgeLabel}
          collapsed={collapsed}
          description={
            seatingPreviewList
              ? `Previewing ${seatingPreviewList.name}${
                  seatingFollowsTimetable && liveClassList ? ' (live period)' : ''
                }`
              : 'Choose a class from the top bar.'
          }
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <SeatingChartWidgetContent
            controller={seatingChart}
            mode="dashboard"
            onOpenEditor={() => {
              if (!isPopoutOpen) {
                toggleWidgetPopout(widgetId);
              }
            }}
            timetableLink={{
              enabled: seatingFollowsTimetable,
              liveClassName: liveClassList?.name ?? null,
              onToggle: setSeatingFollowsTimetable
            }}
          />
        </WidgetCard>
      );
    }

    if (widgetId === 'planner') {
      return (
        <WidgetCard
          badge={plannerBadgeLabel}
          collapsed={collapsed}
          description={selectedList ? `Planning ${selectedList.name}` : 'Choose a class from the top bar.'}
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <PlannerWidgetContent
            carryOver={{
              flagged: planner.carryOverFlagged,
              offer: planner.carryOverSource,
              onAccept: planner.acceptCarryOver,
              onToggle: planner.toggleCarryOver
            }}
            classLists={picker.lists}
            copyForwardTargetLabel={nextLessonDateKey ? formatLongDate(nextLessonDateKey) : null}
            deletedLessonPlans={planner.deletedLessonPlans}
            documents={planner.documents}
            lessonPlanHistory={planner.lessonPlanHistory}
            onAddLink={planner.addLinkDocument}
            onAttachDocuments={planner.attachDocuments}
            onCopyForward={
              nextLessonDateKey ? () => planner.copyLessonForward(nextLessonDateKey) : undefined
            }
            onDeleteDeletedLessonPlans={planner.permanentlyDeleteLessonPlans}
            onOpenWeeklyPlanner={openWeeklyPlannerPopout}
            onOpenDocument={planner.openDocument}
            onRemoveDocument={planner.removeDocument}
            onRestoreDeletedLessonPlan={planner.restoreDeletedLessonPlan}
            onSelectDate={planner.setSelectedDate}
            onUpdatePlan={planner.updatePlan}
            planText={planner.plan}
            selectedDate={planner.selectedDate}
            selectedList={selectedList}
            statusMessage={planner.statusMessage}
            templates={{
              entries: planner.templates,
              onApply: planner.applyTemplate,
              onDelete: planner.deleteTemplate,
              onSave: planner.saveTemplate
            }}
          />
        </WidgetCard>
      );
    }

    if (widgetId === 'homework-assessment') {
      return (
        <WidgetCard
          badge={homeworkAssessmentTracker.badgeLabel}
          badgeTone={homeworkAssessmentTracker.badgeTone}
          collapsed={collapsed}
          description={homeworkAssessmentTracker.summaryDescription}
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <HomeworkAssessmentTrackerWidgetContent
            controller={homeworkAssessmentTracker}
            mode="dashboard"
            onOpenManager={() => {
              setHomeworkAssessmentPopoutMode('editor');
              if (!isPopoutOpen) {
                toggleWidgetPopout(widgetId);
              }
            }}
            onOpenCompletion={() => {
              setHomeworkAssessmentPopoutMode('completion');
              if (!isPopoutOpen) {
                toggleWidgetPopout(widgetId);
              }
            }}
          />
        </WidgetCard>
      );
    }

    if (widgetId === 'qr-generator') {
      return (
        <WidgetCard
          badge={qrGenerator.preview.qrCode ? 'Ready' : null}
          collapsed={collapsed}
          description="Paste a link and the QR code appears right here."
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <QrGeneratorWidgetContent
            linkDraft={qrGenerator.linkDraft}
            onClear={qrGenerator.clearLink}
            onDraftChange={qrGenerator.setLinkDraft}
            preview={qrGenerator.preview}
          />
        </WidgetCard>
      );
    }

    if (widgetId === 'bell-schedule') {
      return (
        <WidgetCard
          badge={bellSchedule.badgeLabel}
          collapsed={collapsed}
          description={
            bellSchedule.activeProfile
              ? `Using ${bellSchedule.activeProfileDisplayName}`
              : 'Set up a weekly timetable.'
          }
          headerDragMode="interactive"
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          headerActions={headerActions}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <BellScheduleWidgetContent
            controller={bellSchedule}
            onOpenEditor={() => {
              bellSchedule.setPopoutMode('editor');
              if (!isPopoutOpen) {
                toggleWidgetPopout(widgetId);
              }
            }}
            showEditor={false}
          />
        </WidgetCard>
      );
    }

    return (
      <WidgetCard
        badge={notes.badgeLabel}
        collapsed={collapsed}
        description={notes.descriptionLabel}
        headerDragMode="interactive"
        isDragOver={isDragOver}
        isDragging={isDragging}
        key={widgetId}
        onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
        onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
        title={WIDGET_DETAILS[widgetId].title}
        widgetId={widgetId}
        sizeTier={sizeTier}
        headerActions={headerActions}
        targetHeight={targetHeight}
        {...dragProps}
      >
        <NotesWidgetContent controller={notes} />
      </WidgetCard>
    );
  };

  return (
    <ColorModeAppearanceContext.Provider
      value={{ preferences: colorModePreferences, theme: resolvedTheme }}
    >
      <main
        aria-label="Teacher tools popover"
        className={`window-stage window-stage--popover${isResizing ? ' window-stage--resizing' : ''}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            window.electronAPI?.closePopover();
          }
        }}
      >
        <section
          className="panel panel--main"
          data-theme={resolvedTheme}
          style={getColorModePanelStyle(resolvedTheme, colorModePreferences)}
        >
          <div aria-hidden="true" className="panel__glass" />
          <div aria-hidden="true" className="panel__gloss" />
          <div aria-hidden="true" className="panel__bezel-mid" />
          <div className="panel__content panel__content--main">
            <header className="panel-header panel-header--main">
              <div className="panel-header__title">
                <span className="panel-kicker panel-kicker--school-date">{todayLabel}</span>
                <h1 className="panel-title">TeacherTools</h1>
              </div>

              <div className="panel-toolbar">
                <div className="picker-select picker-select--toolbar" ref={classMenuRef}>
                  <span className="toolbar-caption">Class</span>
                  <button
                    className={`picker-select__trigger ${isClassMenuOpen ? 'picker-select__trigger--open' : ''}`}
                    disabled={isPickerSpinning || picker.lists.length === 0}
                    onClick={() => setIsClassMenuOpen((current) => !current)}
                    type="button"
                  >
                    <span>{selectedList?.name ?? 'Choose a list'}</span>
                    <span className="picker-select__chevron">{isClassMenuOpen ? '–' : '+'}</span>
                  </button>

                  {isClassMenuOpen && (
                    <div className="picker-select__menu picker-select__menu--toolbar">
                      {picker.lists.length > 0 ? (
                        picker.lists.map((list) => (
                          <button
                            className={`picker-select__option ${
                              list.id === selectedList?.id ? 'picker-select__option--active' : ''
                            }`}
                            key={list.id}
                            onClick={() => selectClassList(list.id)}
                            type="button"
                          >
                            <span>{list.name}</span>
                            <span>{list.students.length}</span>
                          </button>
                        ))
                      ) : (
                        <p className="empty-copy">No class lists yet.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="panel-actions">
                  <button
                    aria-label="Widgets"
                    className="toolbar-link window-spawn-button"
                    data-tooltip-content="Widgets"
                    onClick={() => window.electronAPI?.toggleWidgetPicker()}
                    type="button"
                  >
                    <span className="toolbar-button__label toolbar-button__label--full">Widgets</span>
                    <span
                      aria-hidden="true"
                      className="toolbar-button__label toolbar-button__label--compact"
                    >
                      ◫
                    </span>
                  </button>
                  <button
                    aria-label="Classes"
                    className="toolbar-link window-spawn-button"
                    data-tooltip-content="Classes"
                    onClick={() => window.electronAPI?.toggleClassListBuilder()}
                    type="button"
                  >
                    <span className="toolbar-button__label toolbar-button__label--full">Classes</span>
                    <span
                      aria-hidden="true"
                      className="toolbar-button__label toolbar-button__label--compact"
                    >
                      ≣
                    </span>
                  </button>
                  <div className="settings-menu" ref={settingsPopoverRef}>
                    <button
                      aria-expanded={isSettingsOpen}
                      aria-label="Settings"
                      className={`icon-button button-tone--theme ${isSettingsOpen ? 'settings-button--active' : ''}`}
                      data-tooltip-alignment="end"
                      data-tooltip-content="Settings"
                      onClick={() => {
                        setIsClassMenuOpen(false);
                        setIsSettingsOpen((current) => !current);
                      }}
                      type="button"
                    >
                      <SettingsCogIcon />
                    </button>

                    {isSettingsOpen ? (
                      <SettingsPopover
                        appUpdate={appUpdate}
                        appUpdateActionDisabled={appUpdateActionDisabled}
                        appUpdateButtonLabel={appUpdateButtonLabel}
                        appUpdateStatusLabel={appUpdateStatusLabel}
                        appUpdateStatusTone={appUpdateStatusTone}
                        canDecreaseInterfaceScale={canDecreaseInterfaceScale}
                        canIncreaseInterfaceScale={canIncreaseInterfaceScale}
                        colorModePaletteTarget={colorModePaletteTarget}
                        colorModePreferences={colorModePreferences}
                        decreaseInterfaceScale={decreaseInterfaceScale}
                        increaseInterfaceScale={increaseInterfaceScale}
                        interfaceScale={interfaceScale}
                        isLaunchAtLoginSaving={isLaunchAtLoginSaving}
                        launchAtLogin={appSettings.launchAtLogin}
                        nextThemePreference={nextThemePreference}
                        onAppUpdateAction={handleAppUpdateAction}
                        onTimerChimeEnabledChange={handleTimerChimeEnabledChange}
                        onTimerChimeSoundChange={handleTimerChimeSoundChange}
                        onLaunchAtLoginChange={handleLaunchAtLoginChange}
                        onThemePreferenceChange={() => setThemePreference(nextThemePreference)}
                        onTimerSpeechVoiceChange={handleTimerSpeechVoiceChange}
                        onTimerVoiceEnabledChange={handleTimerVoiceEnabledChange}
                        onToggleBackgroundColor={(anchorRect) =>
                          toggleColorModePalette({
                            anchorRect,
                            kind: 'background'
                          })
                        }
                        resolvedTheme={resolvedTheme}
                        themePreference={themePreference}
                        timerChimeEnabled={appSettings.timerChimeEnabled}
                        timerChimeSound={appSettings.timerChimeSound}
                        timerVoiceEnabled={appSettings.timerVoiceEnabled}
                        timerSpeechVoice={appSettings.timerSpeechVoice}
                      />
                    ) : null}
                  </div>
                  <button
                    aria-label="Close panel"
                    className="icon-button icon-button--close"
                    onClick={() => window.electronAPI?.closePopover()}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </div>
            </header>

            <div
              className={`dashboard-shell ${draggedWidgetId ? 'dashboard-shell--dragging' : ''} ${
                isResizing ? 'dashboard-shell--resizing' : ''
              } ${
                shouldAllowDashboardScroll ? 'dashboard-shell--scrolling' : ''
              }`}
              ref={dashboardShellRef}
              style={
                {
                  '--dashboard-column-gap': `${dashboardMetrics.gap}px`,
                  '--dashboard-fit-scale': String(effectiveDashboardFitScale)
                } as CSSProperties
              }
            >
              {visibleWidgetIds.length > 0 ? (
                <div className="dashboard-columns">
                  {dashboardColumns.map((column, columnIndex) => (
                    <div
                      className="dashboard-column"
                      key={`dashboard-column-${columnIndex}`}
                      style={{
                        flex: '1 1 0',
                        minWidth: 0
                      }}
                    >
                      {column.widgetIds.map((widgetId) => renderWidget(widgetId))}
                    </div>
                  ))}
                </div>
              ) : (
                <section className="widget-empty-state">
                  <p className="empty-copy">
                    This class layout has no visible widgets right now. Open the widget picker to turn
                    them back on.
                  </p>
                  <button
                    className="primary-link window-spawn-button"
                    onClick={() => window.electronAPI?.toggleWidgetPicker()}
                    type="button"
                  >
                    Open widget picker
                  </button>
                </section>
              )}
            </div>
          </div>

          {resolvedTheme === 'color' && colorModePaletteTarget ? (
            <ColorModePalette
              backgroundColorId={colorModePreferences.backgroundColorId}
              onBackgroundColorChange={setBackgroundColorModeSwatch}
              onWidgetColorChange={(swatchId) =>
                colorModePaletteTarget.kind === 'widget'
                  ? setWidgetColorModeSwatch(colorModePaletteTarget.widgetId, swatchId)
                  : undefined
              }
              popoverRef={(element) => {
                colorModePopoverRef.current = element;
              }}
              target={colorModePaletteTarget}
              widgetColorId={
                colorModePaletteTarget.kind === 'widget'
                  ? colorModePreferences.widgetColorsByWidgetId[colorModePaletteTarget.widgetId]
                  : null
              }
            />
          ) : null}
        </section>

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
      </main>
    </ColorModeAppearanceContext.Provider>
  );
}
