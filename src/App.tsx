import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  DesktopWindowContext,
  LessonDocumentSelection,
  WidgetPopoutId,
  WindowBounds
} from './electron-types';

type TimerSnapshot = {
  baseDurationMs: number;
  endsAt: number | null;
  pausedRemainingMs: number;
  lastCompletedAt: number | null;
};

type ClassList = {
  id: string;
  name: string;
  students: string[];
};

type PickerSnapshot = {
  lists: ClassList[];
  selectedListId: string | null;
  pool: string[];
  currentPick: string | null;
  recentPicks: string[];
  removePickedStudents: boolean;
};

type GroupMakerSnapshot = {
  groupSize: number;
  groups: string[][];
  listId: string | null;
  sourceStudents: string[];
};

type LegacyPickerSnapshot = {
  roster?: string[];
  pool?: string[];
  currentPick?: string | null;
  recentPicks?: string[];
};

type ThemeMode = 'light' | 'dark' | 'color';
type ThemePreference = 'system' | ThemeMode;
type TooltipPlacement = 'bottom' | 'top';
type TooltipState = {
  anchorRect: DOMRect;
  text: string;
};

type StickyNote = {
  id: string;
  text: string;
  createdAt: number;
};

type PlannerDocument = {
  id: string;
  name: string;
  path: string;
  addedAt: number;
};

type LessonPlanEntry = {
  documents: PlannerDocument[];
  plan: string;
  updatedAt: number;
};

type PlannerSnapshot = {
  activeDateByListId: Record<string, string>;
  entriesByListId: Record<string, Record<string, LessonPlanEntry>>;
};

type BellScheduleDayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
type BellScheduleSlotId =
  | 'period-1'
  | 'period-2'
  | 'recess'
  | 'homeroom'
  | 'period-3'
  | 'period-4'
  | 'lunch'
  | 'period-5';
type BellScheduleSlotKind = 'break' | 'teaching';
type BellScheduleSlotAssignment = {
  classListId: string | null;
  enabled: boolean;
};

type BellScheduleDay = {
  assignmentsBySlotId: Partial<Record<BellScheduleSlotId, BellScheduleSlotAssignment>>;
};

type BellScheduleProfile = {
  days: Record<BellScheduleDayKey, BellScheduleDay>;
  id: string;
  name: string;
};

type BellSchedulePopoutMode = 'editor' | 'summary';

type BellScheduleSnapshot = {
  activeProfileId: string | null;
  profiles: BellScheduleProfile[];
};

type SeatingChartItemKind = 'seat' | 'teacher-desk' | 'board' | 'door' | 'storage';
type SeatingChartSeatStyle = 'desk' | 'round';

type SeatingChartLayoutItem = {
  assignedStudent: string | null;
  color: string;
  id: string;
  kind: SeatingChartItemKind;
  label: string;
  seatStyle: SeatingChartSeatStyle;
  x: number;
  y: number;
};

type SeatingChartLayout = {
  id: string;
  items: SeatingChartLayoutItem[];
  name: string;
  updatedAt: number;
};

type SeatingChartClassState = {
  activeLayoutId: string | null;
  layouts: SeatingChartLayout[];
};

type SeatingChartSnapshot = {
  chartsByListId: Record<string, SeatingChartClassState>;
};

type SeatingChartDragPayload =
  | {
      itemId: string;
      type: 'item';
    }
  | {
      sourceSeatId: string | null;
      studentName: string;
      type: 'student';
    };

type BellScheduleSlotDefinition = {
  endMinutes: number;
  id: BellScheduleSlotId;
  kind: BellScheduleSlotKind;
  label: string;
  shortLabel: string;
  startMinutes: number;
};

type BellTimelineEntry = {
  assignment: BellScheduleSlotAssignment;
  classList: ClassList | null;
  dayKey: BellScheduleDayKey;
  definition: BellScheduleSlotDefinition;
  status: 'break' | 'free' | 'teaching';
};

type WidgetId = WidgetPopoutId;
type WidgetWidthCategory = 'double' | 'single';

type WidgetLayout = {
  order: WidgetId[];
  hidden: WidgetId[];
  collapsed: WidgetId[];
};

type DashboardMetrics = {
  columnCount: number;
  gap: number;
  laneWidth: number;
};

type DashboardColumn = {
  span: 1 | 2;
  widgetIds: WidgetId[];
};

type DashboardLayoutsSnapshot = {
  layoutsByListId: Record<string, WidgetLayout>;
};

type ResizeCorner = 'bottom-left' | 'bottom-right';
type InterfaceScaleControlsState = {
  canDecreaseInterfaceScale: boolean;
  canIncreaseInterfaceScale: boolean;
  decreaseInterfaceScale: () => void;
  increaseInterfaceScale: () => void;
  interfaceScale: number;
};

const TIMER_PRESETS = [
  { label: '2m', ms: 2 * 60 * 1000 },
  { label: '5m', ms: 5 * 60 * 1000 },
  { label: '10m', ms: 10 * 60 * 1000 },
  { label: '15m', ms: 15 * 60 * 1000 }
];

const CUSTOM_TIMER_MAX_MINUTES = 60;
const GROUP_SIZE_MIN = 2;
const GROUP_SIZE_MAX = 8;
const GROUP_GRID_GAP = 8;
const GROUP_GRID_MIN_COLUMNS = 2;
const GROUP_GRID_MAX_COLUMNS = 4;
const GROUP_GRID_MIN_COLUMN_WIDTH = 136;
const PICKER_SPINNER_WINDOW_SIZE = 5;
const MIN_POPOVER_WIDTH = 320;
const MIN_POPOVER_HEIGHT = 320;
const CLASS_LIST_TEXTAREA_MIN_HEIGHT = 176;
const WINDOW_EDGE_MARGIN = 14;
const LAYOUT_FALLBACK_KEY = '__default__';
const DASHBOARD_COLUMN_GAP = 12;
const DASHBOARD_SINGLE_MAX_WIDTH = 360;
const DASHBOARD_SINGLE_MIN_WIDTH = 232;
const DEFAULT_INTERFACE_SCALE = 1;
const INTERFACE_SCALE_STEP = 0.1;
const INTERFACE_SCALE_MIN = 0.5;
const INTERFACE_SCALE_MAX = 2;
const BELL_SCHEDULE_DAY_KEYS: BellScheduleDayKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday'
];
const BELL_SCHEDULE_DAY_LABELS: Record<BellScheduleDayKey, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday'
};
const SEATING_CHART_GRID_ROWS = 10;
const SEATING_CHART_GRID_COLUMNS = 12;
const SEATING_CHART_MIN_SEATS = 12;
const SEATING_CHART_DRAG_MIME = 'application/x-teachertools-seating';
const SEATING_CHART_COLOR_SWATCHES = [
  '#5c7cfa',
  '#1d9d7f',
  '#e08a2f',
  '#d35f74',
  '#7b61d1',
  '#3f8ad8',
  '#69717d'
] as const;
const SEATING_CHART_ITEM_DETAILS: Record<
  SeatingChartItemKind,
  {
    defaultColor: string;
    defaultLabel: string;
    title: string;
  }
> = {
  seat: {
    title: 'Seat',
    defaultLabel: 'Seat',
    defaultColor: '#5c7cfa'
  },
  'teacher-desk': {
    title: 'Teacher Desk',
    defaultLabel: 'Teacher',
    defaultColor: '#1d9d7f'
  },
  board: {
    title: 'Board',
    defaultLabel: 'Board',
    defaultColor: '#e08a2f'
  },
  door: {
    title: 'Door',
    defaultLabel: 'Door',
    defaultColor: '#d35f74'
  },
  storage: {
    title: 'Storage',
    defaultLabel: 'Storage',
    defaultColor: '#69717d'
  }
};
const BELL_SCHEDULE_SLOT_DEFINITIONS: BellScheduleSlotDefinition[] = [
  { id: 'period-1', label: 'Period 1', shortLabel: 'P1', kind: 'teaching', startMinutes: 8 * 60 + 48, endMinutes: 9 * 60 + 48 },
  { id: 'period-2', label: 'Period 2', shortLabel: 'P2', kind: 'teaching', startMinutes: 9 * 60 + 48, endMinutes: 10 * 60 + 48 },
  { id: 'recess', label: 'Recess', shortLabel: 'Rec', kind: 'break', startMinutes: 10 * 60 + 48, endMinutes: 11 * 60 + 13 },
  { id: 'homeroom', label: 'Homeroom', shortLabel: 'HR', kind: 'teaching', startMinutes: 11 * 60 + 13, endMinutes: 11 * 60 + 25 },
  { id: 'period-3', label: 'Period 3', shortLabel: 'P3', kind: 'teaching', startMinutes: 11 * 60 + 25, endMinutes: 12 * 60 + 25 },
  { id: 'period-4', label: 'Period 4', shortLabel: 'P4', kind: 'teaching', startMinutes: 12 * 60 + 25, endMinutes: 13 * 60 + 25 },
  { id: 'lunch', label: 'Lunch', shortLabel: 'Lunch', kind: 'break', startMinutes: 13 * 60 + 25, endMinutes: 13 * 60 + 50 },
  { id: 'period-5', label: 'Period 5', shortLabel: 'P5', kind: 'teaching', startMinutes: 13 * 60 + 50, endMinutes: 14 * 60 + 50 }
];
const WIDGET_IDS: WidgetId[] = [
  'timer',
  'picker',
  'group-maker',
  'seating-chart',
  'bell-schedule',
  'planner',
  'notes'
];
const WIDGET_POPOUT_MIN_SIZES: Record<WidgetId, { minHeight: number; minWidth: number }> = {
  timer: { minWidth: 280, minHeight: 224 },
  picker: { minWidth: 300, minHeight: 240 },
  'group-maker': { minWidth: 320, minHeight: 280 },
  'seating-chart': { minWidth: 760, minHeight: 560 },
  'bell-schedule': { minWidth: 340, minHeight: 300 },
  notes: { minWidth: 300, minHeight: 244 },
  planner: { minWidth: 360, minHeight: 420 }
};
const THEME_CYCLE_ORDER: ThemePreference[] = ['system', 'light', 'dark', 'color'];
const WIDGET_DETAILS: Record<
  WidgetId,
  {
    description: string;
    title: string;
    width: WidgetWidthCategory;
  }
> = {
  timer: {
    title: 'Timer',
    description: 'Countdown presets and a custom class timer.',
    width: 'single'
  },
  picker: {
    title: 'Student Picker',
    description: 'Cycle through the current roster and choose a student at random.',
    width: 'single'
  },
  'group-maker': {
    title: 'Group Maker',
    description: 'Shuffle the current class into balanced groups.',
    width: 'double'
  },
  'seating-chart': {
    title: 'Seating Chart',
    description: 'Preview the current seating plan and open the editor to make changes.',
    width: 'single'
  },
  'bell-schedule': {
    title: 'Bell Schedule',
    description: 'Track the current period, time remaining, and your saved weekly profiles.',
    width: 'single'
  },
  planner: {
    title: 'Class Planner',
    description: 'Plan each class by date and keep lesson documents attached.',
    width: 'double'
  },
  notes: {
    title: 'Notes',
    description: 'Quick sticky notes for reminders, tasks, and prompts.',
    width: 'single'
  }
};
const WIDGET_ESTIMATED_HEIGHTS: Record<WidgetId, number> = {
  timer: 264,
  picker: 252,
  'group-maker': 428,
  'seating-chart': 352,
  'bell-schedule': 312,
  planner: 624,
  notes: 246
};
const DEFAULT_TIMER: TimerSnapshot = {
  baseDurationMs: 5 * 60 * 1000,
  endsAt: null,
  pausedRemainingMs: 5 * 60 * 1000,
  lastCompletedAt: null
};

const DEFAULT_CLASS_LIST: ClassList = {
  id: 'default-class-list',
  name: 'Period 1',
  students: ['Ava', 'Noah', 'Mia', 'Liam']
};

const DEFAULT_PICKER: PickerSnapshot = {
  lists: [DEFAULT_CLASS_LIST],
  selectedListId: DEFAULT_CLASS_LIST.id,
  pool: [...DEFAULT_CLASS_LIST.students],
  currentPick: null,
  recentPicks: [],
  removePickedStudents: true
};

const DEFAULT_GROUP_MAKER: GroupMakerSnapshot = {
  groupSize: 4,
  groups: [],
  listId: null,
  sourceStudents: []
};

const DEFAULT_WIDGET_LAYOUT: WidgetLayout = {
  order: [...WIDGET_IDS],
  hidden: [],
  collapsed: []
};

const DEFAULT_DASHBOARD_LAYOUTS: DashboardLayoutsSnapshot = {
  layoutsByListId: {}
};

const DEFAULT_PLANNER: PlannerSnapshot = {
  activeDateByListId: {},
  entriesByListId: {}
};

const DEFAULT_BELL_SCHEDULE_PROFILE = createBellScheduleProfile({
  id: 'bell-schedule-default-profile',
  name: 'Standard Week'
});

const DEFAULT_BELL_SCHEDULE: BellScheduleSnapshot = {
  activeProfileId: DEFAULT_BELL_SCHEDULE_PROFILE.id,
  profiles: [DEFAULT_BELL_SCHEDULE_PROFILE]
};

const DEFAULT_SEATING_CHART: SeatingChartSnapshot = {
  chartsByListId: {}
};

const fallbackContext: DesktopWindowContext = {
  role: window.location.hash.includes('builder')
    ? 'builder'
    : window.location.hash.includes('widget-picker')
      ? 'widget-picker'
      : window.location.hash.includes('widget-popout')
        ? 'widget-popout'
      : window.location.hash.includes('popover')
        ? 'popover'
        : 'overlay',
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
  widgetId:
    window.location.hash.match(/widget-popout\/([^/?]+)/)?.[1] &&
    isWidgetId(window.location.hash.match(/widget-popout\/([^/?]+)/)?.[1] ?? '')
      ? (window.location.hash.match(/widget-popout\/([^/?]+)/)?.[1] as WidgetId)
      : null
};

function App() {
  const [context, setContext] = useState<DesktopWindowContext | null>(null);

  useEffect(() => {
    if (!window.electronAPI) {
      setContext(fallbackContext);
      return;
    }

    window.electronAPI.getWindowContext().then(setContext);
  }, []);

  if (!context) {
    return null;
  }

  let content: JSX.Element;

  if (context.role === 'overlay') {
    content = <OverlayDot />;
  } else if (context.role === 'builder') {
    content = <ClassListBuilderWindow windowContext={context} />;
  } else if (context.role === 'widget-picker') {
    content = <WidgetPickerWindow />;
  } else if (context.role === 'widget-popout') {
    content = (
      <WidgetPopoutWindow
        autoSizeToContent={Boolean(context.autoSizeToContent)}
        widgetId={context.widgetId ?? null}
      />
    );
  } else {
    content = <TeacherPopover />;
  }

  return (
    <>
      {content}
      <GlobalTooltipLayer />
    </>
  );
}

function GlobalTooltipLayer() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [position, setPosition] = useState<{
    arrowLeft: number;
    left: number;
    placement: TooltipPlacement;
    top: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const getTooltipElement = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }

      return target.closest<HTMLElement>('[data-tooltip-content]');
    };

    const hideTooltip = () => {
      activeElementRef.current = null;
      setTooltip(null);
      setPosition(null);
    };

    const syncActiveTooltip = () => {
      const activeElement = activeElementRef.current;
      if (!activeElement) {
        return;
      }

      const text = activeElement.dataset.tooltipContent?.trim() ?? '';
      if (!text) {
        hideTooltip();
        return;
      }

      setTooltip({
        anchorRect: activeElement.getBoundingClientRect(),
        text
      });
    };

    const showTooltip = (element: HTMLElement | null) => {
      if (!element) {
        hideTooltip();
        return;
      }

      if (activeElementRef.current !== element) {
        activeElementRef.current = null;
      }

      const title = element.dataset.tooltipContent?.trim() ?? '';
      if (!title) {
        hideTooltip();
        return;
      }

      activeElementRef.current = element;
      setTooltip({
        anchorRect: element.getBoundingClientRect(),
        text: title
      });
    };

    const handlePointerOver = (event: PointerEvent) => {
      showTooltip(getTooltipElement(event.target));
    };

    const handlePointerOut = (event: PointerEvent) => {
      const activeElement = activeElementRef.current;
      if (!activeElement) {
        return;
      }

      if (event.relatedTarget instanceof Node && activeElement.contains(event.relatedTarget)) {
        return;
      }

      const nextElement = getTooltipElement(event.relatedTarget);
      if (nextElement) {
        showTooltip(nextElement);
        return;
      }

      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      showTooltip(getTooltipElement(event.target));
    };

    const handleFocusOut = (event: FocusEvent) => {
      const nextElement = getTooltipElement(event.relatedTarget);
      if (nextElement) {
        showTooltip(nextElement);
        return;
      }

      hideTooltip();
    };

    const handlePointerDown = () => {
      hideTooltip();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideTooltip();
      }
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', syncActiveTooltip);
    window.addEventListener('scroll', syncActiveTooltip, true);

    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', syncActiveTooltip);
      window.removeEventListener('scroll', syncActiveTooltip, true);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltipElement = tooltipRef.current;
    if (!tooltip || !tooltipElement) {
      return;
    }

    const margin = 12;
    const offset = 12;
    const width = tooltipElement.offsetWidth;
    const height = tooltipElement.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const preferredLeft = tooltip.anchorRect.left + tooltip.anchorRect.width / 2 - width / 2;
    const nextLeft = clampNumber(preferredLeft, margin, Math.max(margin, viewportWidth - width - margin));
    const arrowLeft = clampNumber(
      tooltip.anchorRect.left + tooltip.anchorRect.width / 2 - nextLeft,
      14,
      Math.max(14, width - 14)
    );
    const topPlacementTop = tooltip.anchorRect.top - height - offset;
    const placement: TooltipPlacement = topPlacementTop >= margin ? 'top' : 'bottom';
    const nextTop =
      placement === 'top'
        ? topPlacementTop
        : clampNumber(
            tooltip.anchorRect.bottom + offset,
            margin,
            Math.max(margin, viewportHeight - height - margin)
          );

    setPosition((current) =>
      current &&
      current.left === nextLeft &&
      current.top === nextTop &&
      current.arrowLeft === arrowLeft &&
      current.placement === placement
        ? current
        : {
            arrowLeft,
            left: nextLeft,
            placement,
            top: nextTop
          }
    );
  }, [tooltip]);

  if (!tooltip) {
    return null;
  }

  return (
    <div
      className={`app-tooltip ${position ? `app-tooltip--${position.placement}` : 'app-tooltip--top'}`}
      ref={tooltipRef}
      role="tooltip"
      style={
        position
          ? {
              left: `${position.left}px`,
              top: `${position.top}px`,
              ['--tooltip-arrow-left' as string]: `${position.arrowLeft}px`
            }
          : undefined
      }
    >
      {tooltip.text}
    </div>
  );
}

function OverlayDot() {
  const overlayBoundsRef = useRef<WindowBounds>({
    x: 0,
    y: 0,
    width: 86,
    height: 86
  });
  const dragStateRef = useRef<{
    moved: boolean;
    pointerId: number;
    startBounds: WindowBounds;
    startPointerX: number;
    startPointerY: number;
  } | null>(null);

  useEffect(() => {
    window.electronAPI?.getOverlayBounds().then((bounds) => {
      overlayBoundsRef.current = bounds;
    });
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (!window.electronAPI) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.screenX,
      startPointerY: event.screenY,
      startBounds: overlayBoundsRef.current,
      moved: false
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - dragState.startPointerX;
    const deltaY = event.screenY - dragState.startPointerY;

    if (!dragState.moved && Math.hypot(deltaX, deltaY) >= 6) {
      dragState.moved = true;
    }

    if (!dragState.moved) {
      return;
    }

    const nextBounds = {
      ...dragState.startBounds,
      x: Math.round(dragState.startBounds.x + deltaX),
      y: Math.round(dragState.startBounds.y + deltaY)
    };

    overlayBoundsRef.current = nextBounds;
    window.electronAPI?.setOverlayPosition({
      x: nextBounds.x,
      y: nextBounds.y
    });
  };

  const finishPointerInteraction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - dragState.startPointerX;
    const deltaY = event.screenY - dragState.startPointerY;
    const dragged = dragState.moved || Math.hypot(deltaX, deltaY) >= 6;

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!dragged) {
      window.electronAPI?.togglePopover();
    }
  };

  const cancelPointerInteraction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <main className="overlay-shell">
      <div className="overlay-shell__dock">
        <button
          aria-label="Open teacher tools"
        className="overlay-dot"
        onPointerCancel={cancelPointerInteraction}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        type="button"
      >
          <svg
            aria-hidden="true"
            className="overlay-dot__art"
            viewBox="0 0 86 86"
          >
            <defs>
              <radialGradient id="overlay-dot-ambient" cx="50%" cy="50%" r="50%">
                <stop
                  offset="0%"
                  stopColor="rgba(215, 255, 246, 0.95)"
                />
                <stop
                  offset="18%"
                  stopColor="rgba(171, 255, 239, 0.82)"
                />
                <stop
                  offset="44%"
                  stopColor="rgba(103, 245, 225, 0.46)"
                />
                <stop
                  offset="68%"
                  stopColor="rgba(44, 170, 180, 0.18)"
                />
                <stop
                  offset="100%"
                  stopColor="rgba(44, 170, 180, 0)"
                />
              </radialGradient>
              <radialGradient id="overlay-dot-core" cx="34%" cy="30%" r="58%">
                <stop
                  offset="0%"
                  stopColor="#ffffff"
                />
                <stop
                  offset="28%"
                  stopColor="rgba(241, 255, 251, 0.98)"
                />
                <stop
                  offset="60%"
                  stopColor="rgba(145, 242, 223, 0.9)"
                />
                <stop
                  offset="100%"
                  stopColor="rgba(72, 187, 191, 0.84)"
                />
              </radialGradient>
              <radialGradient id="overlay-dot-highlight" cx="50%" cy="50%" r="50%">
                <stop
                  offset="0%"
                  stopColor="rgba(255, 255, 255, 0.94)"
                />
                <stop
                  offset="100%"
                  stopColor="rgba(255, 255, 255, 0)"
                />
              </radialGradient>
              <filter
                id="overlay-dot-blur"
                x="-40%"
                y="-40%"
                width="180%"
                height="180%"
              >
                <feGaussianBlur stdDeviation="8" />
              </filter>
              <filter
                id="overlay-dot-soft-blur"
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
              >
                <feGaussianBlur stdDeviation="3.5" />
              </filter>
            </defs>
            <circle
              cx="43"
              cy="43"
              r="20"
              fill="url(#overlay-dot-ambient)"
              filter="url(#overlay-dot-blur)"
              opacity="0.95"
            />
            <circle
              cx="43"
              cy="43"
              r="16"
              fill="url(#overlay-dot-ambient)"
              filter="url(#overlay-dot-soft-blur)"
              opacity="0.82"
            />
            <circle
              cx="43"
              cy="43"
              r="14"
              fill="url(#overlay-dot-core)"
            />
            <circle
              cx="38"
              cy="37"
              r="6"
              fill="url(#overlay-dot-highlight)"
              opacity="0.78"
            />
          </svg>
        </button>

        <button
          aria-label="Exit TeacherTools"
          className="overlay-exit"
        onClick={(event) => {
          event.stopPropagation();
          window.electronAPI?.quitApp();
        }}
        type="button"
      >
        ×
        </button>
      </div>
    </main>
  );
}

function useWindowResizeHandles({
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

    window.electronAPI.getCurrentWindowBounds().then((startBounds) => {
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
    });
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

    window.electronAPI?.setCurrentWindowBounds({
      x: nextX,
      y: resizeState.startBounds.y,
      width: nextWidth,
      height: nextHeight
    });
  };

  const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    beginResize,
    continueResize,
    endResize
  };
}

function useAutoFitWindowToContent({
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

function TeacherPopover() {
  const classMenuRef = useRef<HTMLDivElement | null>(null);
  const dashboardShellRef = useRef<HTMLDivElement | null>(null);
  const dragOverWidgetIdRef = useRef<WidgetId | null>(null);
  const pickerSpinIntervalRef = useRef<number | null>(null);
  const widgetElementRefs = useRef(new Map<WidgetId, HTMLElement>());
  const widgetDragStateRef = useRef<{
    draggedWidgetId: WidgetId;
    hasMoved: boolean;
      pointerId: number;
      startPointerX: number;
      startPointerY: number;
  } | null>(null);
  const [timer, setTimer] = usePersistentState<TimerSnapshot>('teacher-tools.timer', DEFAULT_TIMER);
  const [picker, setPicker] = usePickerState();
  const [groupMaker, setGroupMaker] = usePersistentState<GroupMakerSnapshot>(
    'teacher-tools.group-maker',
    DEFAULT_GROUP_MAKER,
    {
      normalize: normalizeGroupMakerSnapshot
    }
  );
  const [dashboardLayouts, setDashboardLayouts] = useDashboardLayoutsState();
  const planner = useLessonPlannerController(picker.selectedListId);
  const bellSchedule = useBellScheduleController(picker.lists);
  const [stickyNotes, setStickyNotes] = usePersistentState<StickyNote[]>(
    'teacher-tools.note-items',
    []
  );
  const [noteDraft, setNoteDraft] = usePersistentState<string>('teacher-tools.note-draft', '');
  const [customTimerMinutes, setCustomTimerMinutes] = usePersistentState<number>(
    'teacher-tools.custom-timer-minutes',
    0
  );
  const [themePreference, setThemePreference] = useThemePreferenceState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const [isClassMenuOpen, setIsClassMenuOpen] = useState(false);
  const [isPickerSpinning, setIsPickerSpinning] = useState(false);
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [draggedWidgetId, setDraggedWidgetId] = useState<WidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<WidgetId | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics>(() =>
    computeDashboardMetrics(MIN_POPOVER_WIDTH)
  );
  const [widgetHeights, setWidgetHeights] = useState<Partial<Record<WidgetId, number>>>({});
  const openWidgetPopouts = useWidgetPopoutIds();
  const liveNowUntil = timer.endsAt ?? (timer.lastCompletedAt ? timer.lastCompletedAt + 5000 : null);
  const now = useNow(liveNowUntil);
  const resolvedTheme = useResolvedTheme(themePreference);
  const nextThemePreference = getNextThemePreference(themePreference);
  const remainingMs = timer.endsAt ? Math.max(timer.endsAt - now, 0) : timer.pausedRemainingMs;
  const isTimerRunning = timer.endsAt !== null && remainingMs > 0;
  const isTimerPaused =
    timer.endsAt === null &&
    timer.pausedRemainingMs > 0 &&
    timer.pausedRemainingMs < timer.baseDurationMs;
  const timerFinishedRecently = Boolean(timer.lastCompletedAt && now - timer.lastCompletedAt < 5000);
  const timerProgress = timer.baseDurationMs === 0 ? 0 : remainingMs / timer.baseDurationMs;
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const selectedStudents = selectedList?.students ?? [];
  const seatingChart = useSeatingChartController(selectedList);
  const selectedLayout = getWidgetLayoutForList(dashboardLayouts, picker.selectedListId);
  const visibleWidgetIds = selectedLayout.order.filter((widgetId) => !selectedLayout.hidden.includes(widgetId));
  const visibleWidgetKey = visibleWidgetIds.join('|');
  const dashboardColumns = buildDashboardColumns({
    columnCount: dashboardMetrics.columnCount,
    widgetHeights,
    widgetIds: visibleWidgetIds
  });
  const rosterCount = selectedStudents.length;
  const timerLabel = formatDuration(remainingMs);
  const todayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date());
  const recentPicks = picker.recentPicks.slice(0, 4);
  const customTimerMs = customTimerMinutes * 60 * 1000;
  const customTimerActive = customTimerMinutes > 0 && timer.baseDurationMs === customTimerMs;
  const timerStatusLabel = timerFinishedRecently
    ? 'Done'
    : isTimerRunning
      ? 'Live'
      : isTimerPaused
        ? 'Paused'
        : 'Ready';
  const pickerSpinnerNames = buildPickerSpinnerNames({
    currentPick: picker.currentPick,
    isSpinning: isPickerSpinning,
    names: selectedStudents,
    spinnerIndex
  });
  const activeGroups =
    selectedList &&
    groupMaker.listId === selectedList.id &&
    haveSameStudents(groupMaker.sourceStudents, selectedStudents)
      ? groupMaker.groups
      : [];
  const groupCount = activeGroups.length;
  const groupBadgeLabel =
    groupCount > 0
      ? `${groupCount} group${groupCount === 1 ? '' : 's'}`
      : `${groupMaker.groupSize}/group`;
  const plannerBadgeLabel = planner.documents.length > 0 ? `${planner.documents.length}` : null;
  const seatingChartBadgeLabel = selectedList
    ? `${seatingChart.assignedSeatCount}/${selectedStudents.length}`
    : null;
  const groupMakerHint = !selectedList
    ? 'Choose a class list to start grouping.'
    : selectedStudents.length < 2
      ? 'Add at least two students to make groups.'
      : groupCount > 0
        ? `${selectedStudents.length} students arranged into ${groupCount} balanced group${
            groupCount === 1 ? '' : 's'
          }.`
        : `Shuffle ${selectedStudents.length} students into groups of about ${groupMaker.groupSize}.`;
  const plannerHint = !selectedList
    ? 'Choose a class list to plan lessons by date.'
    : planner.hasContent
      ? `Saved for ${formatLongDate(planner.selectedDate)}.`
      : `Plan ${selectedList.name} for ${formatLongDate(planner.selectedDate)}.`;
  const { beginResize, continueResize, endResize } = useWindowResizeHandles({
    minWidth: MIN_POPOVER_WIDTH,
    minHeight: MIN_POPOVER_HEIGHT
  });

  useLayoutEffect(() => {
    const dashboardShell = dashboardShellRef.current;

    if (!dashboardShell) {
      return;
    }

    let frameId = 0;

    const syncDashboardLayout = () => {
      const nextMetrics = computeDashboardMetrics(dashboardShell.clientWidth);
      setDashboardMetrics((current) =>
        current.columnCount === nextMetrics.columnCount &&
        current.gap === nextMetrics.gap &&
        current.laneWidth === nextMetrics.laneWidth
          ? current
          : nextMetrics
      );

      const nextHeights: Partial<Record<WidgetId, number>> = {};

      for (const widgetId of visibleWidgetIds) {
        const widgetElement = widgetElementRefs.current.get(widgetId);
        if (!widgetElement) {
          continue;
        }

        nextHeights[widgetId] = Math.ceil(widgetElement.getBoundingClientRect().height);
      }

      setWidgetHeights((current) => mergeMeasuredWidgetHeights(current, nextHeights, visibleWidgetIds));
    };

    const scheduleDashboardSync = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncDashboardLayout);
    };

    scheduleDashboardSync();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleDashboardSync();
    });

    resizeObserver.observe(dashboardShell);
    for (const widgetId of visibleWidgetIds) {
      const widgetElement = widgetElementRefs.current.get(widgetId);
      if (widgetElement) {
        resizeObserver.observe(widgetElement);
      }
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [interfaceScale, visibleWidgetKey]);

  useEffect(() => {
    if (timer.endsAt && remainingMs === 0) {
      setTimer((current) => ({
        ...current,
        endsAt: null,
        pausedRemainingMs: 0,
        lastCompletedAt: Date.now()
      }));
    }
  }, [remainingMs, setTimer, timer.endsAt]);

  useEffect(() => {
    if (stickyNotes.length > 0) {
      return;
    }

    try {
      const legacyRaw = window.localStorage.getItem('teacher-tools.notes');
      if (!legacyRaw) {
        return;
      }

      const legacyValue = JSON.parse(legacyRaw);
      if (typeof legacyValue === 'string' && legacyValue.trim()) {
        setStickyNotes([
          {
            id: createStickyNoteId(),
            text: legacyValue.trim(),
            createdAt: Date.now()
          }
        ]);
      }

      window.localStorage.removeItem('teacher-tools.notes');
    } catch {
      // Ignore legacy migration failures.
    }
  }, [setStickyNotes, stickyNotes.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
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
  }, [isClassMenuOpen]);

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
    if (isPickerSpinning || !selectedStudents.length) {
      return;
    }

    if (picker.currentPick) {
      const nextIndex = selectedStudents.indexOf(picker.currentPick);
      if (nextIndex >= 0) {
        setSpinnerIndex(nextIndex);
        return;
      }
    }

    setSpinnerIndex(0);
  }, [isPickerSpinning, picker.currentPick, selectedStudents]);

  useEffect(() => {
    return () => {
      if (pickerSpinIntervalRef.current !== null) {
        window.clearInterval(pickerSpinIntervalRef.current);
      }
    };
  }, []);

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

  const setWidgetElementRef = (widgetId: WidgetId, element: HTMLElement | null) => {
    if (element) {
      widgetElementRefs.current.set(widgetId, element);
      return;
    }

    widgetElementRefs.current.delete(widgetId);
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

    const hoveredWidgetId = getWidgetIdUnderPointer(event.clientX, event.clientY);
    if (dragOverWidgetIdRef.current !== hoveredWidgetId) {
      dragOverWidgetIdRef.current = hoveredWidgetId;
      setDragOverWidgetId(hoveredWidgetId);
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

  const resetCurrentListCycle = () => {
    if (!selectedList) {
      return;
    }

    setPicker((current) => ({
      ...current,
      pool: [...selectedList.students],
      currentPick: null,
      recentPicks: []
    }));
  };

  const toggleRemovePickedStudents = (removePickedStudents: boolean) => {
    setPicker((current) => {
      if (current.removePickedStudents === removePickedStudents) {
        return current;
      }

      const activeList = current.lists.find((list) => list.id === current.selectedListId) ?? null;

      return {
        ...current,
        removePickedStudents,
        pool: activeList ? [...activeList.students] : []
      };
    });
  };

  const pickStudent = () => {
    if (isPickerSpinning || !selectedList || !selectedStudents.length) {
      return;
    }

    const readyPool = getPickerSelectionPool(
      selectedStudents,
      picker.pool,
      picker.removePickedStudents
    );
    const pickedName = readyPool[Math.floor(Math.random() * readyPool.length)];
    const remainingPool = getPickerRemainingPool(
      selectedStudents,
      readyPool,
      pickedName,
      picker.removePickedStudents
    );
    const finalIndex = selectedStudents.indexOf(pickedName);
    const normalizedSpinnerIndex = selectedStudents.length
      ? ((spinnerIndex % selectedStudents.length) + selectedStudents.length) % selectedStudents.length
      : 0;
    const totalSteps =
      Math.max(selectedStudents.length * 2, 10) +
      ((finalIndex - normalizedSpinnerIndex + selectedStudents.length) % selectedStudents.length);
    let currentStep = 0;
    let currentIndex = normalizedSpinnerIndex;
    const selectedListId = selectedList.id;

    if (pickerSpinIntervalRef.current !== null) {
      window.clearInterval(pickerSpinIntervalRef.current);
    }

    setIsClassMenuOpen(false);
    setIsPickerSpinning(true);

    pickerSpinIntervalRef.current = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % selectedStudents.length;
      currentStep += 1;
      setSpinnerIndex(currentIndex);

      if (currentStep < totalSteps) {
        return;
      }

      if (pickerSpinIntervalRef.current !== null) {
        window.clearInterval(pickerSpinIntervalRef.current);
        pickerSpinIntervalRef.current = null;
      }

      setSpinnerIndex(finalIndex);
      setIsPickerSpinning(false);
      setPicker((current) => {
        if (current.selectedListId !== selectedListId) {
          return current;
        }

        return {
          ...current,
          pool: remainingPool,
          currentPick: pickedName,
          recentPicks: [pickedName, ...current.recentPicks.filter((entry) => entry !== pickedName)].slice(
            0,
            5
          )
        };
      });
    }, 90);
  };

  const startTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: Date.now() + current.baseDurationMs,
      pausedRemainingMs: current.baseDurationMs,
      lastCompletedAt: null
    }));
  };

  const pauseTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: null,
      pausedRemainingMs: current.endsAt ? Math.max(current.endsAt - Date.now(), 0) : 0
    }));
  };

  const resumeTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: Date.now() + current.pausedRemainingMs,
      lastCompletedAt: null
    }));
  };

  const resetTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: null,
      pausedRemainingMs: current.baseDurationMs,
      lastCompletedAt: null
    }));
  };

  const setPreset = (durationMs: number) => {
    setTimer({
      baseDurationMs: durationMs,
      endsAt: null,
      pausedRemainingMs: durationMs,
      lastCompletedAt: null
    });
  };

  const updateCustomTimer = (nextMinutes: number) => {
    const clampedMinutes = clampNumber(nextMinutes, 0, CUSTOM_TIMER_MAX_MINUTES);
    const previousCustomTimerMs = customTimerMinutes * 60 * 1000;

    setCustomTimerMinutes(clampedMinutes);

    if (clampedMinutes > 0) {
      setPreset(clampedMinutes * 60 * 1000);
      return;
    }

    if (timer.baseDurationMs === previousCustomTimerMs) {
      setPreset(DEFAULT_TIMER.baseDurationMs);
    }
  };

  const addStickyNote = () => {
    const nextText = noteDraft.trim();
    if (!nextText) {
      return;
    }

    setStickyNotes((current) => [
      {
        id: createStickyNoteId(),
        text: nextText,
        createdAt: Date.now()
      },
      ...current
    ]);
    setNoteDraft('');
  };

  const removeStickyNote = (id: string) => {
    setStickyNotes((current) => current.filter((note) => note.id !== id));
  };

  const updateGroupSize = (nextSize: number) => {
    const clampedSize = clampNumber(nextSize, GROUP_SIZE_MIN, GROUP_SIZE_MAX);

    setGroupMaker((current) => {
      if (current.groupSize === clampedSize) {
        return current;
      }

      return {
        ...current,
        groupSize: clampedSize,
        groups: [],
        listId: null,
        sourceStudents: []
      };
    });
  };

  const clearGroups = () => {
    setGroupMaker((current) => ({
      ...current,
      groups: [],
      listId: null,
      sourceStudents: []
    }));
  };

  const makeGroups = () => {
    if (!selectedList || selectedStudents.length < 2) {
      return;
    }

    setGroupMaker((current) => ({
      ...current,
      groups: buildStudentGroups(selectedStudents, current.groupSize),
      listId: selectedList.id,
      sourceStudents: [...selectedStudents]
    }));
  };

  const toggleWidgetPopout = (widgetId: WidgetId) => {
    window.electronAPI?.toggleWidgetPopout(widgetId);
  };

  const renderWidget = (widgetId: WidgetId) => {
    const collapsed = selectedLayout.collapsed.includes(widgetId);
    const isDragging = draggedWidgetId === widgetId;
    const isDragOver = dragOverWidgetId === widgetId && draggedWidgetId !== widgetId;
    const isPopoutOpen = openWidgetPopouts.includes(widgetId);
    const widthCategory = getWidgetWidthCategory(widgetId);

    const dragProps = {
      onPointerCancel: cancelWidgetDrag,
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => beginWidgetDrag(widgetId, event),
      onPointerMove: continueWidgetDrag,
      onPointerUp: finishWidgetDrag
    };

    const headerActions =
      widgetId === 'bell-schedule' ? (
        <WidgetPopoutButton
          isActive={isPopoutOpen}
          onClick={() => {
            bellSchedule.setPopoutMode('summary');
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
      );

    if (widgetId === 'timer') {
      return (
        <WidgetCard
          badge={timerStatusLabel}
          badgeTone={timerFinishedRecently ? 'alert' : 'default'}
          collapsed={collapsed}
          description="Presets, custom minutes, and a quick class countdown."
          elementRef={(element) => setWidgetElementRef(widgetId, element)}
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          widthCategory={widthCategory}
          {...dragProps}
        >
          <TimerWidgetContent
            activeDurationMs={timer.baseDurationMs}
            customTimerActive={customTimerActive}
            customTimerMinutes={customTimerMinutes}
            customTimerMs={customTimerMs}
            isTimerPaused={isTimerPaused}
            isTimerRunning={isTimerRunning}
            onPause={pauseTimer}
            onReset={resetTimer}
            onResume={resumeTimer}
            onSetPreset={setPreset}
            onStart={startTimer}
            onUpdateCustomTimer={updateCustomTimer}
            timerLabel={timerLabel}
            timerProgress={timerProgress}
          />
        </WidgetCard>
      );
    }

    if (widgetId === 'picker') {
      return (
        <WidgetCard
          badge={`${rosterCount}`}
          collapsed={collapsed}
          description={selectedList ? `Using ${selectedList.name}` : 'Choose a class from the top bar.'}
          elementRef={(element) => setWidgetElementRef(widgetId, element)}
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          widthCategory={widthCategory}
          {...dragProps}
        >
          <PickerWidgetContent
            isPickerSpinning={isPickerSpinning}
            onPick={pickStudent}
            onResetCycle={resetCurrentListCycle}
            onToggleRemovePickedStudents={toggleRemovePickedStudents}
            pickerSpinnerNames={pickerSpinnerNames}
            recentPicks={recentPicks}
            removePickedStudents={picker.removePickedStudents}
            selectedStudentCount={selectedStudents.length}
          />
        </WidgetCard>
      );
    }

    if (widgetId === 'group-maker') {
      return (
        <WidgetCard
          badge={groupBadgeLabel}
          collapsed={collapsed}
          description={selectedList ? `Using ${selectedList.name}` : 'Choose a class from the top bar.'}
          elementRef={(element) => setWidgetElementRef(widgetId, element)}
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          widthCategory={widthCategory}
          {...dragProps}
        >
          <GroupMakerWidgetContent
            activeGroups={activeGroups}
            emptyCopy={
              selectedList
                ? 'Groups will show up here after you shuffle the current list.'
                : 'Create or choose a class list to start making groups.'
            }
            groupMakerHint={groupMakerHint}
            groupSize={groupMaker.groupSize}
            hasSavedGroups={groupMaker.groups.length > 0}
            onClear={clearGroups}
            onShuffle={makeGroups}
            onUpdateGroupSize={updateGroupSize}
            selectedStudentCount={selectedStudents.length}
          />
        </WidgetCard>
      );
    }

    if (widgetId === 'seating-chart') {
      return (
        <WidgetCard
          badge={seatingChartBadgeLabel}
          collapsed={collapsed}
          description={
            selectedList ? `Previewing ${selectedList.name}` : 'Choose a class from the top bar.'
          }
          elementRef={(element) => setWidgetElementRef(widgetId, element)}
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          widthCategory={widthCategory}
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
          elementRef={(element) => setWidgetElementRef(widgetId, element)}
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          widthCategory={widthCategory}
          {...dragProps}
        >
          <PlannerWidgetContent
            documents={planner.documents}
            entryDates={planner.entryDates}
            onAttachDocuments={planner.attachDocuments}
            onOpenDocument={planner.openDocument}
            onRemoveDocument={planner.removeDocument}
            onSelectDate={planner.setSelectedDate}
            onUpdatePlan={planner.updatePlan}
            planText={planner.plan}
            selectedDate={planner.selectedDate}
            selectedList={selectedList}
            statusMessage={planner.statusMessage}
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
              : 'Set up a weekly bell schedule.'
          }
          elementRef={(element) => setWidgetElementRef(widgetId, element)}
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          widthCategory={widthCategory}
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
        badge={stickyNotes.length > 0 ? `${stickyNotes.length}` : null}
        collapsed={collapsed}
        description="Capture reminders and quick thoughts."
        elementRef={(element) => setWidgetElementRef(widgetId, element)}
        headerDragMode="interactive"
        headerActions={headerActions}
        isDragOver={isDragOver}
        isDragging={isDragging}
        key={widgetId}
        onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
        onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
        title={WIDGET_DETAILS[widgetId].title}
        widgetId={widgetId}
        widthCategory={widthCategory}
        {...dragProps}
      >
        <NotesWidgetContent
          noteDraft={noteDraft}
          notes={stickyNotes}
          onAddNote={addStickyNote}
          onDraftChange={setNoteDraft}
          onRemoveNote={removeStickyNote}
        />
      </WidgetCard>
    );
  };

  return (
    <main
      aria-label="Teacher tools popover"
      className="window-stage window-stage--popover"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          window.electronAPI?.closePopover();
        }
      }}
    >
      <section className="panel panel--main" data-theme={resolvedTheme}>
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div className="panel__content panel__content--main">
          <header className="panel-header panel-header--main">
            <div className="panel-header__title">
              <span className="panel-kicker">{todayLabel}</span>
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
                  className="toolbar-link"
                  onClick={() => window.electronAPI?.toggleWidgetPicker()}
                  type="button"
                >
                  Widgets
                </button>
                <button
                  className="toolbar-link"
                  onClick={() => window.electronAPI?.toggleClassListBuilder()}
                  type="button"
                >
                  Classes
                </button>
                <InterfaceScaleControls
                  canDecrease={canDecreaseInterfaceScale}
                  canIncrease={canIncreaseInterfaceScale}
                  onDecrease={decreaseInterfaceScale}
                  onIncrease={increaseInterfaceScale}
                  scale={interfaceScale}
                />
                <button
                  aria-label={`Theme ${getThemePreferenceLabel(themePreference)}. Switch to ${getThemePreferenceLabel(nextThemePreference)}.`}
                  className="icon-button button-tone--theme"
                  data-tooltip-content={`Theme ${getThemePreferenceLabel(themePreference)} -> ${getThemePreferenceLabel(nextThemePreference)}`}
                  onClick={() => setThemePreference(nextThemePreference)}
                  type="button"
                >
                  <ThemeCycleIcon preference={themePreference} />
                </button>
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
            className={`dashboard-shell ${draggedWidgetId ? 'dashboard-shell--dragging' : ''}`}
            ref={dashboardShellRef}
            style={
              {
                '--dashboard-column-gap': `${dashboardMetrics.gap}px`,
                '--dashboard-lane-width': `${dashboardMetrics.laneWidth}px`
              } as CSSProperties
            }
          >
            {visibleWidgetIds.length > 0 ? (
              <div className="dashboard-columns">
                {dashboardColumns.map((column, columnIndex) => (
                  <div
                    className={`dashboard-column dashboard-column--span-${column.span}`}
                    key={`dashboard-column-${columnIndex}`}
                    style={{
                      width:
                        column.span === 2
                          ? dashboardMetrics.laneWidth * 2 + dashboardMetrics.gap
                          : dashboardMetrics.laneWidth
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
                  className="primary-link"
                  onClick={() => window.electronAPI?.toggleWidgetPicker()}
                  type="button"
                >
                  Open widget picker
                </button>
              </section>
            )}
          </div>
        </div>
      </section>

      <button
        aria-label="Resize window from bottom left corner"
        className="resize-handle resize-handle--left"
        onPointerCancel={endResize}
        onPointerDown={(event) => beginResize('bottom-left', event)}
        onPointerMove={continueResize}
        onPointerUp={endResize}
        type="button"
      />
      <button
        aria-label="Resize window from bottom right corner"
        className="resize-handle resize-handle--right"
        onPointerCancel={endResize}
        onPointerDown={(event) => beginResize('bottom-right', event)}
        onPointerMove={continueResize}
        onPointerUp={endResize}
        type="button"
      />
    </main>
  );
}

function WidgetPopoutWindow({
  autoSizeToContent = false,
  widgetId
}: {
  autoSizeToContent?: boolean;
  widgetId: WidgetId | null;
}) {
  const stageRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [themePreference] = useThemePreferenceState();
  const interfaceScaleControls = useInterfaceScaleControls();
  const resolvedTheme = useResolvedTheme(themePreference);
  const widgetMinSize = widgetId ? WIDGET_POPOUT_MIN_SIZES[widgetId] : null;
  const { stopAutoFitToContent } = useAutoFitWindowToContent({
    enabled: autoSizeToContent && widgetId !== null,
    stageRef,
    panelRef,
    scale: interfaceScaleControls.interfaceScale
  });
  const { beginResize, continueResize, endResize } = useWindowResizeHandles({
    minWidth: widgetMinSize?.minWidth ?? MIN_POPOVER_WIDTH,
    minHeight: widgetMinSize?.minHeight ?? MIN_POPOVER_HEIGHT,
    onResizeStart: stopAutoFitToContent
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !widgetId) {
        return;
      }

      window.electronAPI?.toggleWidgetPopout(widgetId);
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
    content = <TimerWidgetPopoutCard interfaceScaleControls={interfaceScaleControls} />;
  } else if (widgetId === 'picker') {
    content = <PickerWidgetPopoutCard interfaceScaleControls={interfaceScaleControls} />;
  } else if (widgetId === 'group-maker') {
    content = <GroupMakerWidgetPopoutCard interfaceScaleControls={interfaceScaleControls} />;
  } else if (widgetId === 'seating-chart') {
    content = <SeatingChartWidgetPopoutCard interfaceScaleControls={interfaceScaleControls} />;
  } else if (widgetId === 'bell-schedule') {
    content = <BellScheduleWidgetPopoutCard interfaceScaleControls={interfaceScaleControls} />;
  } else if (widgetId === 'planner') {
    content = <PlannerWidgetPopoutCard interfaceScaleControls={interfaceScaleControls} />;
  } else {
    content = <NotesWidgetPopoutCard interfaceScaleControls={interfaceScaleControls} />;
  }

  return (
    <main
      aria-label="Widget popout"
      className="window-stage window-stage--builder window-stage--widget-popout"
      ref={stageRef}
    >
      <section
        className="panel panel--builder panel--widget-popout"
        data-theme={resolvedTheme}
        ref={panelRef}
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div className="panel__content panel__content--popout">{content}</div>
      </section>

      {widgetId ? (
        <>
          <button
            aria-label="Resize window from bottom left corner"
            className="resize-handle resize-handle--left"
            onPointerCancel={endResize}
            onPointerDown={(event) => beginResize('bottom-left', event)}
            onPointerMove={continueResize}
            onPointerUp={endResize}
            type="button"
          />
          <button
            aria-label="Resize window from bottom right corner"
            className="resize-handle resize-handle--right"
            onPointerCancel={endResize}
            onPointerDown={(event) => beginResize('bottom-right', event)}
            onPointerMove={continueResize}
            onPointerUp={endResize}
            type="button"
          />
        </>
      ) : null}
    </main>
  );
}

function WidgetPickerWindow() {
  const stageRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastRequestedHeightRef = useRef(0);
  const [picker] = usePickerState();
  const [dashboardLayouts, setDashboardLayouts] = useDashboardLayoutsState();
  const [themePreference] = useThemePreferenceState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const resolvedTheme = useResolvedTheme(themePreference);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const layout = getWidgetLayoutForList(dashboardLayouts, picker.selectedListId);
  const visibleCount = layout.order.filter((widgetId) => !layout.hidden.includes(widgetId)).length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.electronAPI?.closeWidgetPicker();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useLayoutEffect(() => {
    if (!window.electronAPI || !stageRef.current || !panelRef.current) {
      return;
    }

    const stage = stageRef.current;
    const panel = panelRef.current;
    let cancelled = false;

    const reportHeight = () => {
      const stageStyles = window.getComputedStyle(stage);
      const stagePadding =
        parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
      const desiredHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);

      if (desiredHeight === lastRequestedHeightRef.current) {
        return;
      }

      lastRequestedHeightRef.current = desiredHeight;
      window.electronAPI?.getCurrentWindowBounds().then((bounds) => {
        if (cancelled) {
          return;
        }

        window.electronAPI?.setCurrentWindowBounds({
          ...bounds,
          height: desiredHeight
        });
      });
    };

    reportHeight();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(reportHeight);
    });

    resizeObserver.observe(panel);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [interfaceScale, layout.order.length, selectedList?.id, visibleCount]);

  const updateSelectedLayout = (updater: (layout: WidgetLayout) => WidgetLayout) => {
    setDashboardLayouts((current) => updateWidgetLayoutForList(current, picker.selectedListId, updater));
  };

  return (
    <main
      aria-label="Widget picker"
      className="window-stage window-stage--builder window-stage--widget-picker"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          window.electronAPI?.closeWidgetPicker();
        }
      }}
      ref={stageRef}
    >
      <section
        className="panel panel--builder panel--widget-picker"
        data-theme={resolvedTheme}
        ref={panelRef}
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div className="panel__content">
          <header className="panel-header">
            <div className="panel-header__title">
              <span className="panel-kicker">Dashboard</span>
              <h1 className="panel-title">Widgets</h1>
            </div>
            <div className="panel-actions">
              <InterfaceScaleControls
                canDecrease={canDecreaseInterfaceScale}
                canIncrease={canIncreaseInterfaceScale}
                onDecrease={decreaseInterfaceScale}
                onIncrease={increaseInterfaceScale}
                scale={interfaceScale}
              />
              <button
                aria-label="Close widget picker"
                className="icon-button icon-button--close"
                onClick={() => window.electronAPI?.closeWidgetPicker()}
                type="button"
              >
                ×
              </button>
            </div>
          </header>

          <div className="widget-picker-window">
            <p className="helper-text">
              {selectedList
                ? `Layout for ${selectedList.name}. Drag cards in the main dashboard to reorder them.`
                : 'This layout applies when no class list is selected.'}
            </p>

            <div className="widget-toggle-list">
              {layout.order.map((widgetId) => {
                const details = WIDGET_DETAILS[widgetId];
                const visible = !layout.hidden.includes(widgetId);

                return (
                  <label className="widget-toggle" key={widgetId}>
                    <input
                      checked={visible}
                      onChange={(event) => {
                        updateSelectedLayout((current) => ({
                          ...current,
                          hidden: event.target.checked
                            ? current.hidden.filter((entry) => entry !== widgetId)
                            : normalizeWidgetIdCollection([...current.hidden, widgetId])
                        }));
                      }}
                      type="checkbox"
                    />
                    <div className="widget-toggle__copy">
                      <span className="widget-toggle__name">{details.title}</span>
                      <span className="widget-toggle__hint">
                        {`${getWidgetWidthCategory(widgetId) === 'double' ? 'Double' : 'Single'} width. ${details.description}`}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="widget-picker-window__footer">
              <button
                className="secondary-link button-tone--utility"
                onClick={() =>
                  updateSelectedLayout((current) => ({
                    ...current,
                    hidden: []
                  }))
                }
                type="button"
              >
                Show all
              </button>
              <button
                className="secondary-link"
                onClick={() => updateSelectedLayout(() => DEFAULT_WIDGET_LAYOUT)}
                type="button"
              >
                Reset layout
              </button>
              <span className="badge">{visibleCount}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function ClassListBuilderWindow({ windowContext }: { windowContext: DesktopWindowContext }) {
  const stageRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastRequestedHeightRef = useRef(0);
  const [picker, setPicker] = usePickerState();
  const [themePreference] = useThemePreferenceState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const resolvedTheme = useResolvedTheme(themePreference);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const [builderListId, setBuilderListId] = useState<string | null>(() => selectedList?.id ?? null);
  const [builderListName, setBuilderListName] = useState(() => selectedList?.name ?? '');
  const [builderStudents, setBuilderStudents] = useState(() =>
    selectedList ? selectedList.students.join('\n') : ''
  );
  const [isCreatingNewList, setIsCreatingNewList] = useState(() => !selectedList);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.electronAPI?.closeClassListBuilder();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (isCreatingNewList) {
      return;
    }

    if (builderListId) {
      const activeList = picker.lists.find((list) => list.id === builderListId);
      if (activeList) {
        return;
      }
    }

    if (selectedList) {
      setBuilderListId(selectedList.id);
      setBuilderListName(selectedList.name);
      setBuilderStudents(selectedList.students.join('\n'));
      return;
    }

    setIsCreatingNewList(true);
    setBuilderListId(null);
    setBuilderListName('');
    setBuilderStudents('');
  }, [builderListId, isCreatingNewList, picker.lists, selectedList]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const panel = panelRef.current;
    const stage = stageRef.current;

    if (!textarea || !panel || !stage) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.overflowY = 'hidden';

    const naturalTextareaHeight = Math.max(textarea.scrollHeight, CLASS_LIST_TEXTAREA_MIN_HEIGHT);
    textarea.style.height = `${naturalTextareaHeight}px`;

    const stageStyles = window.getComputedStyle(stage);
    const stagePadding =
      parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
    const display = windowContext.anchor?.display ?? fallbackContext.anchor?.display;
    const windowTop =
      (typeof window.screenY === 'number' && Number.isFinite(window.screenY)
        ? window.screenY
        : typeof window.screenTop === 'number' && Number.isFinite(window.screenTop)
          ? window.screenTop
          : null) ?? (display ? display.y + WINDOW_EDGE_MARGIN : WINDOW_EDGE_MARGIN);
    const maxWindowHeight = display
      ? Math.max(0, display.y + display.height - windowTop - WINDOW_EDGE_MARGIN)
      : Number.POSITIVE_INFINITY;
    const naturalWindowHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);
    const overflow = Number.isFinite(maxWindowHeight)
      ? Math.max(0, naturalWindowHeight - maxWindowHeight)
      : 0;
    const nextTextareaHeight = Math.max(
      CLASS_LIST_TEXTAREA_MIN_HEIGHT,
      naturalTextareaHeight - overflow
    );

    textarea.style.height = `${nextTextareaHeight}px`;
    textarea.style.overflowY = nextTextareaHeight < naturalTextareaHeight ? 'auto' : 'hidden';
  }, [builderStudents, builderListId, interfaceScale, isCreatingNewList, windowContext]);

  useLayoutEffect(() => {
    if (!window.electronAPI || !stageRef.current || !panelRef.current) {
      return;
    }

    const stage = stageRef.current;
    const panel = panelRef.current;
    let cancelled = false;

    const reportHeight = () => {
      const stageStyles = window.getComputedStyle(stage);
      const stagePadding =
        parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
      const desiredHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);

      if (desiredHeight === lastRequestedHeightRef.current) {
        return;
      }

      lastRequestedHeightRef.current = desiredHeight;
      window.electronAPI?.getCurrentWindowBounds().then((bounds) => {
        if (cancelled) {
          return;
        }

        window.electronAPI?.setCurrentWindowBounds({
          ...bounds,
          height: desiredHeight
        });
      });
    };

    reportHeight();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(reportHeight);
    });

    resizeObserver.observe(panel);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [builderListId, builderStudents, interfaceScale, isCreatingNewList, picker.lists.length]);

  const draftStudents = splitNames(builderStudents);

  const startNewList = () => {
    setIsCreatingNewList(true);
    setBuilderListId(null);
    setBuilderListName('');
    setBuilderStudents('');
  };

  const editList = (listId: string) => {
    const nextList = picker.lists.find((list) => list.id === listId);
    if (!nextList) {
      return;
    }

    setPicker((current) => activateClassList(current, listId));
    setIsCreatingNewList(false);
    setBuilderListId(nextList.id);
    setBuilderListName(nextList.name);
    setBuilderStudents(nextList.students.join('\n'));
  };

  const saveClassList = () => {
    const nextName = builderListName.trim();
    if (!nextName || !draftStudents.length) {
      return;
    }

    const targetListId =
      builderListId ??
      createPredictableListId(nextName, picker.lists.map((list) => list.id));

    setPicker((current) =>
      upsertClassList(current, {
        listId: targetListId,
        name: nextName,
        students: draftStudents
      })
    );

    setIsCreatingNewList(false);
    setBuilderListId(targetListId);
    setBuilderListName(nextName);
    setBuilderStudents(draftStudents.join('\n'));
  };

  const deleteClassList = () => {
    if (!builderListId) {
      return;
    }

    setPicker((current) => removeClassListFromPicker(current, builderListId));
    startNewList();
  };

  return (
    <main
      aria-label="Class list builder"
      className="window-stage window-stage--builder window-stage--class-list-builder"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          window.electronAPI?.closeClassListBuilder();
        }
      }}
      ref={stageRef}
    >
      <section
        className="panel panel--builder panel--class-list-builder"
        data-theme={resolvedTheme}
        ref={panelRef}
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div className="panel__content">
          <header className="panel-header">
            <div className="panel-header__title">
              <span className="panel-kicker">Class lists</span>
              <h1 className="panel-title">Builder</h1>
            </div>
            <div className="panel-actions">
              <InterfaceScaleControls
                canDecrease={canDecreaseInterfaceScale}
                canIncrease={canIncreaseInterfaceScale}
                onDecrease={decreaseInterfaceScale}
                onIncrease={increaseInterfaceScale}
                scale={interfaceScale}
              />
              <button className="toolbar-link button-tone--action" onClick={startNewList} type="button">
                New
              </button>
              <button
                aria-label="Close class list builder"
                className="icon-button icon-button--close"
                onClick={() => window.electronAPI?.closeClassListBuilder()}
                type="button"
              >
                ×
              </button>
            </div>
          </header>

          <div className="builder-layout builder-layout--class-list">
            <aside className="builder-sidebar">
              <div className="builder-sidebar__head">
                <span className="card-label">Lists</span>
                <span className="badge">{picker.lists.length}</span>
              </div>

              <div className="builder-list">
                {picker.lists.length > 0 ? (
                  picker.lists.map((list) => (
                    <button
                      className={`builder-list__button ${
                        list.id === builderListId ? 'builder-list__button--active' : ''
                      }`}
                      key={list.id}
                      onClick={() => editList(list.id)}
                      type="button"
                    >
                      <span>{list.name}</span>
                      <span>{list.students.length}</span>
                    </button>
                  ))
                ) : (
                  <p className="empty-copy">No lists yet.</p>
                )}
              </div>
            </aside>

            <section className="builder-editor">
              <div className="field-stack">
                <label className="field-label" htmlFor="class-list-name">
                  List name
                </label>
                <input
                  className="text-field"
                  id="class-list-name"
                  onChange={(event) => setBuilderListName(event.target.value)}
                  placeholder="Period 1"
                  type="text"
                  value={builderListName}
                />
              </div>

              <div className="field-stack field-stack--fill builder-students-field">
                <label className="field-label" htmlFor="class-list-students">
                  Students
                </label>
                <textarea
                  className="text-area text-area--builder"
                  id="class-list-students"
                  onChange={(event) => setBuilderStudents(event.target.value)}
                  placeholder="One name per line or separated by commas"
                  ref={textareaRef}
                  value={builderStudents}
                />
                <p className="helper-text">
                  {draftStudents.length} student{draftStudents.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="builder-footer">
                <button
                  className="primary-link"
                  disabled={!builderListName.trim() || draftStudents.length === 0}
                  onClick={saveClassList}
                  type="button"
                >
                  {builderListId ? 'Save list' : 'Add list'}
                </button>
                {builderListId && (
                  <button className="danger-link" onClick={deleteClassList} type="button">
                    Delete
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

function WidgetCard({
  widgetId,
  badge,
  badgeTone = 'default',
  children,
  collapsed,
  description,
  elementRef,
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
  title,
  widthCategory
}: {
  widgetId: WidgetId;
  badge: string | null;
  badgeTone?: 'alert' | 'default';
  children: React.ReactNode;
  collapsed: boolean;
  description: string;
  elementRef?: (element: HTMLElement | null) => void;
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
  title: string;
  widthCategory: WidgetWidthCategory;
}) {
  return (
    <article
      data-widget-id={widgetId}
      ref={elementRef}
      className={`widget-card ${collapsed ? 'widget-card--collapsed' : ''} ${
        isDragging ? 'widget-card--dragging' : ''
      } ${isDragOver ? 'widget-card--drag-over' : ''} widget-card--${widthCategory}`}
    >
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
              ^
            </button>
          ) : null}
          <div className="widget-card__title-copy">
            <span className="widget-card__title">{title}</span>
          </div>
        </div>
        <div className="widget-card__meta">
          {badge ? <span className={`badge ${badgeTone === 'alert' ? 'badge--alert' : ''}`}>{badge}</span> : null}
          {headerActions}
        </div>
      </div>

      <div className="widget-card__body-shell">
        <div className="widget-card__body">{children}</div>
      </div>
    </article>
  );
}

function WidgetPopoutButton({
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
      <LockIcon locked={isActive} />
    </button>
  );
}

function PopoutWidgetActions({
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
        onClick={() => window.electronAPI?.toggleWidgetPopout(widgetId)}
        title={title}
      />
      <button
        aria-label={`Close ${title}`}
        className="widget-icon-button widget-icon-button--close"
        onClick={(event) => {
          event.stopPropagation();
          window.electronAPI?.toggleWidgetPopout(widgetId);
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

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg aria-hidden="true" className="lock-icon" viewBox="0 0 16 16">
      <path
        d={locked ? 'M5.1 7V5.5A2.9 2.9 0 0 1 8 2.6a2.9 2.9 0 0 1 2.9 2.9V7' : 'M5.1 7V5.8A2.9 2.9 0 0 1 8 2.9a2.9 2.9 0 0 1 2.9 2.9'}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
      {!locked ? (
        <path
          d="M10.9 5.8h1a2 2 0 0 1 2 2V12a1.9 1.9 0 0 1-1.9 1.9H4A1.9 1.9 0 0 1 2.1 12V7.8a2 2 0 0 1 2-2h5.4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.2"
        />
      ) : (
        <rect
          fill="none"
          height="6.9"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.2"
          width="10.8"
          x="2.6"
          y="6.5"
        />
      )}
      <circle cx="8" cy="9.8" fill="currentColor" r="0.85" />
    </svg>
  );
}

function TimerWidgetContent({
  activeDurationMs,
  customTimerActive,
  customTimerMinutes,
  customTimerMs,
  isTimerPaused,
  isTimerRunning,
  onPause,
  onReset,
  onResume,
  onSetPreset,
  onStart,
  onUpdateCustomTimer,
  timerLabel,
  timerProgress
}: {
  activeDurationMs: number;
  customTimerActive: boolean;
  customTimerMinutes: number;
  customTimerMs: number;
  isTimerPaused: boolean;
  isTimerRunning: boolean;
  onPause: () => void;
  onReset: () => void;
  onResume: () => void;
  onSetPreset: (durationMs: number) => void;
  onStart: () => void;
  onUpdateCustomTimer: (nextMinutes: number) => void;
  timerLabel: string;
  timerProgress: number;
}) {
  return (
    <>
      <div className="timer-readout">{timerLabel}</div>

      <div className="segmented-row">
        {TIMER_PRESETS.map((preset) => (
          <button
            aria-pressed={activeDurationMs === preset.ms}
            className={`text-toggle timer-preset-toggle ${
              activeDurationMs === preset.ms ? 'timer-preset-toggle--active' : ''
            }`}
            key={preset.label}
            onClick={() => onSetPreset(preset.ms)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="custom-row">
        <span className="helper-text">Custom</span>
        <div className="stepper">
          <button
            aria-label="Decrease custom timer"
            className="stepper__button"
            disabled={customTimerMinutes === 0}
            onClick={() => onUpdateCustomTimer(customTimerMinutes - 1)}
            type="button"
          >
            −
          </button>
          <button
            aria-label={
              customTimerMinutes > 0
                ? `Use ${customTimerMinutes} minute custom timer`
                : 'Custom timer is not set'
            }
            aria-pressed={customTimerActive}
            className={`stepper__value timer-stepper__value ${
              customTimerActive ? 'timer-stepper__value--active' : ''
            }`}
            disabled={customTimerMinutes === 0}
            onClick={() => {
              if (customTimerMinutes > 0) {
                onSetPreset(customTimerMs);
              }
            }}
            type="button"
          >
            {customTimerMinutes}
          </button>
          <button
            aria-label="Increase custom timer"
            className="stepper__button"
            disabled={customTimerMinutes === CUSTOM_TIMER_MAX_MINUTES}
            onClick={() => onUpdateCustomTimer(customTimerMinutes + 1)}
            type="button"
          >
            +
          </button>
        </div>
      </div>

      <div className="progress">
        <span className="progress__fill" style={{ transform: `scaleX(${timerProgress})` }} />
      </div>

      <div className="action-row">
        {!isTimerRunning && !isTimerPaused && (
          <button className="primary-link" onClick={onStart} type="button">
            Start
          </button>
        )}
        {isTimerRunning && (
          <button className="primary-link" onClick={onPause} type="button">
            Pause
          </button>
        )}
        {isTimerPaused && (
          <button className="primary-link" onClick={onResume} type="button">
            Resume
          </button>
        )}
        <button className="secondary-link" onClick={onReset} type="button">
          Reset
        </button>
      </div>
    </>
  );
}

function PickerWidgetContent({
  isPickerSpinning,
  onPick,
  onResetCycle,
  onToggleRemovePickedStudents,
  pickerSpinnerNames,
  recentPicks,
  removePickedStudents,
  selectedStudentCount
}: {
  isPickerSpinning: boolean;
  onPick: () => void;
  onResetCycle: () => void;
  onToggleRemovePickedStudents: (removePickedStudents: boolean) => void;
  pickerSpinnerNames: string[];
  recentPicks: string[];
  removePickedStudents: boolean;
  selectedStudentCount: number;
}) {
  const pickerModeLabel = removePickedStudents ? 'Remove after pick' : 'Keep in list';

  return (
    <>
      <div className="picker-stack">
        <div className={`picker-spinner ${isPickerSpinning ? 'picker-spinner--running' : ''}`}>
          <div className="picker-spinner__fade" />
          <div className="picker-spinner__track">
            {pickerSpinnerNames.map((name, index) => (
              <span
                className={`picker-spinner__name ${
                  index === Math.floor(PICKER_SPINNER_WINDOW_SIZE / 2)
                    ? 'picker-spinner__name--active'
                    : ''
                }`}
                key={`${index}-${name || 'empty'}`}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="helper-row picker-controls-row">
        <button
          aria-pressed={removePickedStudents}
          className="text-toggle picker-mode-toggle button-tone--utility"
          onClick={() => onToggleRemovePickedStudents(!removePickedStudents)}
          type="button"
        >
          {pickerModeLabel}
        </button>
      </div>

      <div className="action-row">
        <button
          className="secondary-link"
          disabled={selectedStudentCount === 0}
          onClick={onResetCycle}
          type="button"
        >
          {removePickedStudents ? 'Reset cycle' : 'Clear picks'}
        </button>
        <button
          className="primary-link"
          disabled={selectedStudentCount === 0 || isPickerSpinning}
          onClick={onPick}
          type="button"
        >
          {isPickerSpinning ? 'Picking…' : 'Pick'}
        </button>
      </div>

      {recentPicks.length > 0 && (
        <div className="recent-picks">
          {recentPicks.map((name, index) => (
            <span key={name}>
              {index > 0 && <span className="recent-picks__separator"> | </span>}
              <span className="recent-picks__item">
                {name}
              </span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function GroupMakerWidgetContent({
  activeGroups,
  emptyCopy,
  groupMakerHint,
  groupSize,
  hasSavedGroups,
  onClear,
  onShuffle,
  onUpdateGroupSize,
  selectedStudentCount
}: {
  activeGroups: string[][];
  emptyCopy: string;
  groupMakerHint: string;
  groupSize: number;
  hasSavedGroups: boolean;
  onClear: () => void;
  onShuffle: () => void;
  onUpdateGroupSize: (nextSize: number) => void;
  selectedStudentCount: number;
}) {
  const groupGridRef = useRef<HTMLDivElement | null>(null);
  const [groupColumnCount, setGroupColumnCount] = useState(GROUP_GRID_MIN_COLUMNS);

  useLayoutEffect(() => {
    const groupGrid = groupGridRef.current;

    if (!groupGrid) {
      return;
    }

    let frameId = 0;

    const updateColumnCount = () => {
      const nextColumnCount = clampNumber(
        Math.floor(
          (groupGrid.clientWidth + GROUP_GRID_GAP) / (GROUP_GRID_MIN_COLUMN_WIDTH + GROUP_GRID_GAP)
        ),
        GROUP_GRID_MIN_COLUMNS,
        GROUP_GRID_MAX_COLUMNS
      );

      setGroupColumnCount((current) => (current === nextColumnCount ? current : nextColumnCount));
    };

    updateColumnCount();

    if (typeof ResizeObserver !== 'function') {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateColumnCount);
    });

    resizeObserver.observe(groupGrid);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [activeGroups.length]);

  return (
    <>
      <div className="group-maker__controls">
        <div className="custom-row">
          <span className="helper-text">Students per group</span>
          <div className="stepper">
            <button
              aria-label="Decrease preferred group size"
              className="stepper__button"
              disabled={groupSize === GROUP_SIZE_MIN}
              onClick={() => onUpdateGroupSize(groupSize - 1)}
              type="button"
            >
              −
            </button>
            <span className="stepper__value stepper__value--active">{groupSize}</span>
            <button
              aria-label="Increase preferred group size"
              className="stepper__button"
              disabled={groupSize === GROUP_SIZE_MAX}
              onClick={() => onUpdateGroupSize(groupSize + 1)}
              type="button"
            >
              +
            </button>
          </div>
        </div>

        <p className="helper-text">{groupMakerHint}</p>
      </div>

      {activeGroups.length > 0 ? (
        <div
          className="group-grid"
          ref={groupGridRef}
          style={{ gridTemplateColumns: `repeat(${groupColumnCount}, minmax(0, 1fr))` }}
        >
          {activeGroups.map((group, index) => (
            <article className="group-card" key={`group-${index + 1}`}>
              <div className="group-card__header">
                <span className="group-card__title">Group {index + 1}</span>
                <span className="group-card__count">{group.length}</span>
              </div>
              <div className="group-member-list">
                {group.map((name) => (
                  <span className="group-member-list__item" key={`${index}-${name}`}>
                    {name}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="group-maker__empty">
          <p className="empty-copy">{emptyCopy}</p>
        </div>
      )}

      <div className="action-row">
        <button className="secondary-link" disabled={!hasSavedGroups} onClick={onClear} type="button">
          Clear
        </button>
        <button
          className="primary-link"
          disabled={selectedStudentCount < 2}
          onClick={onShuffle}
          type="button"
        >
          Shuffle groups
        </button>
      </div>
    </>
  );
}

function NotesWidgetContent({
  noteDraft,
  notes,
  onAddNote,
  onDraftChange,
  onRemoveNote
}: {
  noteDraft: string;
  notes: StickyNote[];
  onAddNote: () => void;
  onDraftChange: (value: string) => void;
  onRemoveNote: (id: string) => void;
}) {
  return (
    <>
      <div className="note-input-row">
        <input
          className="text-field"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAddNote();
            }
          }}
          placeholder="Type a note and press Enter"
          type="text"
          value={noteDraft}
        />
        <button className="primary-link" onClick={onAddNote} type="button">
          Add
        </button>
      </div>

      <div className="notes-list">
        {notes.length > 0 ? (
          notes.map((note) => (
            <article className="note-row" key={note.id}>
              <p>{note.text}</p>
              <button
                aria-label="Delete sticky note"
                className="note-row__delete"
                onClick={() => onRemoveNote(note.id)}
                type="button"
              >
                ×
              </button>
            </article>
          ))
        ) : (
          <p className="empty-copy">No notes yet.</p>
        )}
      </div>
    </>
  );
}

function PlannerWidgetContent({
  documents,
  entryDates,
  onAttachDocuments,
  onOpenDocument,
  onRemoveDocument,
  onSelectDate,
  onUpdatePlan,
  planText,
  selectedDate,
  selectedList,
  statusMessage
}: {
  documents: PlannerDocument[];
  entryDates: string[];
  onAttachDocuments: () => Promise<void> | void;
  onOpenDocument: (document: PlannerDocument) => Promise<void> | void;
  onRemoveDocument: (id: string) => void;
  onSelectDate: (dateKey: string) => void;
  onUpdatePlan: (plan: string) => void;
  planText: string;
  selectedDate: string;
  selectedList: ClassList | null;
  statusMessage: string | null;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => getMonthKeyFromDateKey(selectedDate));
  const [isCalendarCollapsed, setIsCalendarCollapsed] = useState(true);
  const indicatorSet = new Set(entryDates);
  const monthDays = buildCalendarDays(visibleMonth, selectedDate, indicatorSet);
  const savedDaysInMonth = entryDates.filter((dateKey) => dateKey.startsWith(`${visibleMonth}-`)).length;
  const savedDaysLabel =
    savedDaysInMonth === 0 ? 'No saved plans' : savedDaysInMonth === 1 ? '1 saved plan' : `${savedDaysInMonth} saved plans`;
  const selectionSummary = !selectedList
    ? 'Choose a class to unlock calendar planning.'
    : selectedDate.startsWith(`${visibleMonth}-`)
      ? `Selected ${formatLongDate(selectedDate)}`
      : `Viewing ${formatMonthLabel(visibleMonth)}. Selected ${formatLongDate(selectedDate)}.`;

  useEffect(() => {
    setVisibleMonth(getMonthKeyFromDateKey(selectedDate));
  }, [selectedDate]);

  const helperCopy = !selectedList
    ? 'Choose a class first, then save lesson plans and documents by date.'
    : planText.trim() || documents.length > 0
      ? `Saved plan for ${selectedList.name} on ${formatLongDate(selectedDate)}.`
      : `Select a date and start planning ${selectedList.name}.`;

  return (
    <div className="planner-widget">
      <div className="planner-widget__toolbar">
        <div className="planner-widget__meta">
          <span className="card-label">Lesson date</span>
          <div className="planner-widget__date-row">
            <input
              className="text-field text-field--date"
              disabled={!selectedList}
              onChange={(event) => onSelectDate(event.target.value)}
              type="date"
              value={selectedDate}
            />
            <button
              className="secondary-link button-tone--utility planner-widget__today"
              disabled={!selectedList}
              onClick={() => onSelectDate(getTodayDateKey())}
              type="button"
            >
              Today
            </button>
          </div>
        </div>
      </div>

      <div className={`planner-calendar ${isCalendarCollapsed ? 'planner-calendar--collapsed' : ''}`}>
        <div className="planner-calendar__header">
          <div className="planner-calendar__header-copy">
            <span className="planner-calendar__eyebrow">Planning calendar</span>
            <div className="planner-calendar__title-row">
              <span className="planner-calendar__title">{formatMonthLabel(visibleMonth)}</span>
              <span className="planner-calendar__badge">{savedDaysLabel}</span>
            </div>
            <span className="planner-calendar__summary">{selectionSummary}</span>
          </div>

          <div className="planner-calendar__controls">
            <button
              aria-expanded={!isCalendarCollapsed}
              className="secondary-link button-tone--utility planner-calendar__toggle"
              onClick={() => setIsCalendarCollapsed((current) => !current)}
              type="button"
            >
              {isCalendarCollapsed ? 'Show calendar' : 'Hide calendar'}
            </button>
            {!isCalendarCollapsed ? (
              <>
                <button
                  aria-label="Previous month"
                  className="widget-icon-button button-tone--utility"
                  onClick={() => setVisibleMonth(shiftMonthKey(visibleMonth, -1))}
                  type="button"
                >
                  ‹
                </button>
                <button
                  aria-label="Next month"
                  className="widget-icon-button button-tone--utility"
                  onClick={() => setVisibleMonth(shiftMonthKey(visibleMonth, 1))}
                  type="button"
                >
                  ›
                </button>
              </>
            ) : null}
          </div>
        </div>

        {!isCalendarCollapsed ? (
          <>
            <div className="planner-calendar__weekdays">
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>

            <div className="planner-calendar__grid">
              {monthDays.map((day) => (
                <button
                  aria-current={day.isToday ? 'date' : undefined}
                  aria-pressed={day.dateKey === selectedDate}
                  className={`planner-calendar__day ${day.isCurrentMonth ? '' : 'planner-calendar__day--muted'} ${
                    day.dateKey === selectedDate ? 'planner-calendar__day--selected' : ''
                  } ${day.isToday ? 'planner-calendar__day--today' : ''} ${
                    day.hasEntry ? 'planner-calendar__day--saved' : ''
                  }`}
                  disabled={!selectedList}
                  key={day.dateKey}
                  onClick={() => onSelectDate(day.dateKey)}
                  type="button"
                >
                  <span className="planner-calendar__day-number">{day.day}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="planner-widget__copy">
        <p className="helper-text">{helperCopy}</p>
        {statusMessage ? <p className="helper-text helper-text--accent">{statusMessage}</p> : null}
      </div>

      <div className="field-stack field-stack--fill">
        <label className="field-label" htmlFor="lesson-plan-text">
          Lesson plan
        </label>
        <textarea
          className="text-area text-area--planner"
          disabled={!selectedList}
          id="lesson-plan-text"
          onChange={(event) => onUpdatePlan(event.target.value)}
          placeholder="Outline your lesson, activities, reminders, and follow-up."
          value={planText}
        />
      </div>

      <div className="planner-documents">
        <div className="planner-documents__header">
          <div>
            <span className="field-label">Documents</span>
            <p className="helper-text">Attach files from your computer and reopen them from here.</p>
          </div>
          <button
            className="primary-link"
            disabled={!selectedList}
            onClick={() => void onAttachDocuments()}
            type="button"
          >
            Attach files
          </button>
        </div>

        {documents.length > 0 ? (
          <div className="planner-documents__list">
            {documents.map((document) => (
              <article className="planner-document" key={document.id}>
                <button
                  className="planner-document__open"
                  onClick={() => void onOpenDocument(document)}
                  type="button"
                >
                  <span className="planner-document__name">{document.name}</span>
                  <span className="planner-document__path">
                    {document.path}
                  </span>
                </button>
                <button
                  aria-label={`Remove ${document.name}`}
                  className="note-row__delete"
                  onClick={() => onRemoveDocument(document.id)}
                  type="button"
                >
                  ×
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="group-maker__empty">
            <p className="empty-copy">No lesson documents attached for this date yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SeatingChartWidgetContent({
  controller,
  mode,
  onOpenEditor
}: {
  controller: ReturnType<typeof useSeatingChartController>;
  mode: 'dashboard' | 'popout';
  onOpenEditor?: () => void;
}) {
  const activeLayout = controller.activeLayout;

  if (!controller.selectedList) {
    return (
      <div className="seating-chart seating-chart--empty">
        <div className="group-maker__empty">
          <p className="empty-copy">Choose a class list to start building a seating chart.</p>
        </div>
      </div>
    );
  }

  if (!activeLayout) {
    return (
      <div className="seating-chart seating-chart--empty">
        <div className="group-maker__empty">
          <p className="empty-copy">No layout is available for this class yet.</p>
        </div>
      </div>
    );
  }

  if (mode === 'dashboard') {
    return (
      <SeatingChartDashboardPreview
        activeLayout={activeLayout}
        onOpenEditor={onOpenEditor}
        selectedList={controller.selectedList}
      />
    );
  }
  return (
    <SeatingChartEditorContent
      activeLayout={activeLayout}
      controller={controller}
      selectedList={controller.selectedList}
    />
  );
}

function SeatingChartDashboardPreview({
  activeLayout,
  onOpenEditor,
  selectedList
}: {
  activeLayout: SeatingChartLayout;
  onOpenEditor?: () => void;
  selectedList: ClassList;
}) {
  const itemsByCell = new Map(activeLayout.items.map((item) => [getSeatingChartCellKey(item.x, item.y), item]));

  return (
    <div className="seating-chart seating-chart--dashboard-preview">
      <div className="seating-chart__preview-card">
        <div className="seating-chart__preview-grid" aria-label={`${selectedList.name} seating plan preview`}>
          {Array.from({ length: SEATING_CHART_GRID_ROWS * SEATING_CHART_GRID_COLUMNS }, (_value, index) => {
            const x = index % SEATING_CHART_GRID_COLUMNS;
            const y = Math.floor(index / SEATING_CHART_GRID_COLUMNS);
            const item = itemsByCell.get(getSeatingChartCellKey(x, y)) ?? null;
            const isSeat = item?.kind === 'seat';

            return (
              <div
                className={`seating-chart__preview-cell ${
                  item ? 'seating-chart__preview-cell--occupied' : ''
                }`}
                key={`${x}-${y}`}
              >
                {item ? (
                  <button
                    aria-label={buildSeatingChartItemTitle(item)}
                    className={`seating-chart__preview-item seating-chart__preview-item--${item.kind} ${
                      isSeat ? `seating-chart__preview-item--seat-${item.seatStyle}` : ''
                    } ${item.assignedStudent ? 'seating-chart__preview-item--assigned' : ''}`}
                    data-tooltip-content={getSeatingChartPreviewTooltip(item)}
                    style={
                      {
                        ['--seat-colour' as string]: item.color
                      } as CSSProperties
                    }
                    type="button"
                  >
                    <span className="seating-chart__preview-token">
                      {getSeatingChartPreviewToken(item)}
                    </span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="seating-chart__preview-footer">
        <p className="helper-text">
          Preview only. Open the editor to change seats or layouts for {selectedList.name}.
        </p>
        {onOpenEditor ? (
          <button className="primary-link" onClick={onOpenEditor} type="button">
            Open editor
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SeatingChartEditorContent({
  activeLayout,
  controller,
  selectedList
}: {
  activeLayout: SeatingChartLayout;
  controller: ReturnType<typeof useSeatingChartController>;
  selectedList: ClassList;
}) {
  const [editorTab, setEditorTab] = useState<'arrange' | 'assign'>('arrange');
  const [selectedTool, setSelectedTool] = useState<'select' | SeatingChartItemKind | 'erase'>('seat');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedStudentName, setSelectedStudentName] = useState<string | null>(null);
  const [draggingStudentName, setDraggingStudentName] = useState<string | null>(null);
  const [assignmentTargetSeatId, setAssignmentTargetSeatId] = useState<string | null>(null);
  const assignmentGridRef = useRef<HTMLDivElement | null>(null);
  const unseatedDropWellRef = useRef<HTMLDivElement | null>(null);
  const studentPointerDragRef = useRef<{
    originX: number;
    originY: number;
    pointerId: number;
    sourceSeatId: string | null;
    started: boolean;
    studentName: string;
    targetSeatId: string | null;
  } | null>(null);
  const studentPointerCleanupRef = useRef<(() => void) | null>(null);
  const suppressStudentClickRef = useRef(false);
  const activeItem =
    activeLayout.items.find((item) => item.id === selectedItemId) ?? null;
  const activeSeat = activeItem?.kind === 'seat' ? activeItem : null;
  const showArrangeWorkspace = editorTab === 'arrange';

  useEffect(() => {
    if (!selectedItemId) {
      return;
    }

    if (!activeLayout.items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [activeLayout, selectedItemId]);

  useEffect(() => {
    if (!selectedStudentName) {
      return;
    }

    if (!controller.selectedStudents.includes(selectedStudentName)) {
      setSelectedStudentName(null);
    }
  }, [controller.selectedStudents, selectedStudentName]);

  useEffect(() => {
    if (showArrangeWorkspace) {
      setSelectedStudentName(null);
      setDraggingStudentName(null);
      setAssignmentTargetSeatId(null);
      studentPointerCleanupRef.current?.();
      studentPointerCleanupRef.current = null;
      studentPointerDragRef.current = null;
    }
  }, [showArrangeWorkspace]);

  useEffect(() => {
    return () => {
      studentPointerCleanupRef.current?.();
      studentPointerCleanupRef.current = null;
      studentPointerDragRef.current = null;
    };
  }, []);

  const handleGridToolAction = (x: number, y: number, itemId: string | null) => {
    if (selectedTool === 'select') {
      setSelectedItemId(itemId);
      return;
    }

    if (selectedTool === 'erase') {
      if (itemId) {
        controller.removeItem(itemId);
      }
      setSelectedItemId(null);
      return;
    }

    controller.setItemAtCell(selectedTool, x, y);
    const nextItem =
      getSeatingChartCellItem(
        activeLayout.items.map((item) =>
          itemId && item.id === itemId
            ? resetSeatingChartItemKind(item, selectedTool, activeLayout.items)
            : item
        ),
        x,
        y
      ) ?? null;
    setSelectedItemId(nextItem?.id ?? itemId);
  };

  const handleDropToUnseated = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = readSeatingChartDragPayload(event.dataTransfer);

    if (payload?.type === 'student' && payload.sourceSeatId) {
      controller.clearSeatAssignment(payload.sourceSeatId);
    }
  };

  const getSeatIdFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const seatElement = element?.closest<HTMLElement>('[data-seat-id]') ?? null;

    if (!seatElement || !assignmentGridRef.current || !assignmentGridRef.current.contains(seatElement)) {
      return null;
    }

    return seatElement.dataset.seatId ?? null;
  };

  const isPointInUnseatedDropWell = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const dropWell = element?.closest<HTMLElement>('[data-unseated-drop-zone="true"]') ?? null;

    return Boolean(
      dropWell &&
        unseatedDropWellRef.current &&
        unseatedDropWellRef.current.contains(dropWell)
    );
  };

  const finishStudentPointerDrag = (clientX?: number, clientY?: number) => {
    const activeDrag = studentPointerDragRef.current;
    studentPointerCleanupRef.current?.();
    studentPointerCleanupRef.current = null;

    if (!activeDrag) {
      return;
    }

    const targetSeatId =
      typeof clientX === 'number' && typeof clientY === 'number'
        ? getSeatIdFromPoint(clientX, clientY)
        : activeDrag.targetSeatId;

    if (activeDrag.started) {
      suppressStudentClickRef.current = true;
    }

    if (activeDrag.started && targetSeatId) {
      controller.assignStudentToSeat(activeDrag.studentName, targetSeatId, activeDrag.sourceSeatId);
      setSelectedItemId(targetSeatId);
      setSelectedStudentName(null);
    } else if (
      activeDrag.started &&
      activeDrag.sourceSeatId &&
      typeof clientX === 'number' &&
      typeof clientY === 'number' &&
      isPointInUnseatedDropWell(clientX, clientY)
    ) {
      controller.clearSeatAssignment(activeDrag.sourceSeatId);
      setSelectedItemId(activeDrag.sourceSeatId);
      setSelectedStudentName(null);
    }

    studentPointerDragRef.current = null;
    setDraggingStudentName(null);
    setAssignmentTargetSeatId(null);
  };

  const cancelStudentPointerDrag = () => {
    studentPointerCleanupRef.current?.();
    studentPointerCleanupRef.current = null;
    studentPointerDragRef.current = null;
    setDraggingStudentName(null);
    setAssignmentTargetSeatId(null);
  };

  const startStudentPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    studentName: string,
    sourceSeatId: string | null
  ) => {
    if (showArrangeWorkspace) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    studentPointerDragRef.current = {
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
      sourceSeatId,
      started: false,
      studentName,
      targetSeatId: getSeatIdFromPoint(event.clientX, event.clientY)
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const activeDrag = studentPointerDragRef.current;

      if (!activeDrag || moveEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      const movedEnough =
        activeDrag.started ||
        Math.hypot(moveEvent.clientX - activeDrag.originX, moveEvent.clientY - activeDrag.originY) >= 4;

      if (!movedEnough) {
        return;
      }

      if (!activeDrag.started) {
        activeDrag.started = true;
        setDraggingStudentName(activeDrag.studentName);
      }

      const targetSeatId = getSeatIdFromPoint(moveEvent.clientX, moveEvent.clientY);
      activeDrag.targetSeatId = targetSeatId;
      setAssignmentTargetSeatId(targetSeatId);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const activeDrag = studentPointerDragRef.current;

      if (!activeDrag || upEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      finishStudentPointerDrag(upEvent.clientX, upEvent.clientY);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      const activeDrag = studentPointerDragRef.current;

      if (!activeDrag || cancelEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      cancelStudentPointerDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    studentPointerCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  };

  const handleStudentPillClick = (studentName: string) => {
    if (suppressStudentClickRef.current) {
      suppressStudentClickRef.current = false;
      return;
    }

    setSelectedStudentName((current) => (current === studentName ? null : studentName));
  };

  const handleSeatActivate = (seatId: string) => {
    setSelectedItemId(seatId);

    if (!selectedStudentName) {
      return;
    }

    controller.assignStudentToSeat(selectedStudentName, seatId);
    setSelectedStudentName(null);
  };

  return (
    <div className="seating-chart seating-chart--popout">
      <div className="seating-chart__toolbar">
        <div className="field-stack seating-chart__layout-field">
          <label className="field-label" htmlFor="seating-chart-layout-editor">
            Layout
          </label>
          <select
            className="text-field seating-chart__layout-select"
            id="seating-chart-layout-editor"
            onChange={(event) => {
              controller.selectLayout(event.target.value);
              setSelectedItemId(null);
            }}
            value={activeLayout.id}
          >
            {controller.layoutOptions.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-stack seating-chart__layout-field seating-chart__layout-field--name">
          <label className="field-label" htmlFor="seating-chart-layout-name">
            Name
          </label>
          <input
            className="text-field"
            id="seating-chart-layout-name"
            onChange={(event) => controller.renameActiveLayout(event.target.value)}
            placeholder="Layout name"
            type="text"
            value={activeLayout.name}
          />
        </div>

        <div className="seating-chart__toolbar-actions">
          <button
            className="secondary-link button-tone--utility"
            onClick={controller.addLayout}
            type="button"
          >
            New layout
          </button>
          <button
            className="secondary-link button-tone--utility"
            onClick={controller.duplicateActiveLayout}
            type="button"
          >
            Duplicate
          </button>
          <button
            className="secondary-link"
            disabled={!controller.canDeleteLayout}
            onClick={controller.deleteActiveLayout}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="seating-chart__stats">
        <article className="seating-chart__stat">
          <span className="seating-chart__stat-label">Seated</span>
          <strong>
            {controller.assignedSeatCount}/{controller.selectedStudents.length}
          </strong>
        </article>
        <article className="seating-chart__stat">
          <span className="seating-chart__stat-label">Seats</span>
          <strong>{controller.seatCount}</strong>
        </article>
        <article className="seating-chart__stat">
          <span className="seating-chart__stat-label">Unseated</span>
          <strong>{controller.unseatedStudents.length}</strong>
        </article>
        <article className="seating-chart__stat">
          <span className="seating-chart__stat-label">Layouts</span>
          <strong>{controller.layoutCount}</strong>
        </article>
      </div>

      <div className="segmented-row seating-chart__mode-tabs">
        <button
          className={`text-toggle button-tone--utility ${
            editorTab === 'arrange' ? 'text-toggle--active' : ''
          }`}
          onClick={() => setEditorTab('arrange')}
          type="button"
        >
          Arrange room
        </button>
        <button
          className={`text-toggle button-tone--action ${
            editorTab === 'assign' ? 'text-toggle--active' : ''
          }`}
          onClick={() => setEditorTab('assign')}
          type="button"
        >
          Assign students
        </button>
      </div>

      <div className={`seating-chart__workspace ${showArrangeWorkspace ? 'seating-chart__workspace--editor' : ''}`}>
        <div className="seating-chart__workspace-main">
          {showArrangeWorkspace ? (
            <div className="seating-chart__tool-row">
              {(['select', 'seat', 'teacher-desk', 'board', 'door', 'storage', 'erase'] as const).map(
                (tool) => (
                  <button
                    className={`text-toggle ${getSeatingChartToolToneClass(tool)} ${
                      selectedTool === tool ? 'text-toggle--active' : ''
                    }`}
                    key={tool}
                    onClick={() => setSelectedTool(tool)}
                    type="button"
                  >
                    {tool === 'select'
                      ? 'Select'
                      : tool === 'erase'
                        ? 'Erase'
                        : SEATING_CHART_ITEM_DETAILS[tool].title}
                  </button>
                )
              )}
            </div>
          ) : null}

          <SeatingChartGrid
            assignmentTargetSeatId={assignmentTargetSeatId}
            compact={false}
            onGridElementChange={(element) => {
              assignmentGridRef.current = element;
            }}
            layout={activeLayout}
            mode={showArrangeWorkspace ? 'arrange' : 'assign'}
            onGridToolAction={handleGridToolAction}
            onMoveItem={controller.moveItem}
            onSelectItem={setSelectedItemId}
            onSeatActivate={handleSeatActivate}
            onStudentDrop={controller.assignStudentToSeat}
            onStudentTokenPointerDown={startStudentPointerDrag}
            selectedItemId={selectedItemId}
            selectedTool={selectedTool}
          />

          <div className="action-row seating-chart__actions">
            <button
              className="secondary-link button-tone--utility"
              disabled={controller.seatCount === 0 || controller.selectedStudents.length === 0}
              onClick={controller.autofillAssignments}
              type="button"
            >
              Autofill
            </button>
            <button
              className="secondary-link button-tone--utility"
              disabled={controller.seatCount === 0 || controller.selectedStudents.length === 0}
              onClick={controller.reshuffleAssignments}
              type="button"
            >
              Quick reshuffle
            </button>
            <button
              className="secondary-link"
              disabled={controller.assignedSeatCount === 0}
              onClick={controller.clearAssignments}
              type="button"
            >
              Clear seats
            </button>
          </div>

          {!controller.hasEnoughSeats ? (
            <p className="helper-text helper-text--accent">
              Add {controller.selectedStudents.length - controller.seatCount} more seat
              {controller.selectedStudents.length - controller.seatCount === 1 ? '' : 's'} to fit
              the full class.
            </p>
          ) : null}
        </div>

        <aside className="seating-chart__sidebar">
          {!showArrangeWorkspace ? (
            <>
              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Unseated students</span>
                  <span className="badge">{controller.unseatedStudents.length}</span>
                </div>
                <div
                  className="seating-chart__drop-well"
                  data-unseated-drop-zone="true"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDropToUnseated}
                  ref={unseatedDropWellRef}
                >
                  {controller.unseatedStudents.length > 0 ? (
                    controller.unseatedStudents.map((student) => (
                      <button
                        className={`seating-chart__student-pill ${
                          selectedStudentName === student ? 'seating-chart__student-pill--active' : ''
                        } ${draggingStudentName === student ? 'seating-chart__student-pill--dragging' : ''}`}
                        draggable={false}
                        key={student}
                        onClick={() => handleStudentPillClick(student)}
                        onPointerDown={(event) => startStudentPointerDrag(event, student, null)}
                        type="button"
                      >
                        {student}
                      </button>
                    ))
                  ) : (
                    <p className="empty-copy">Everyone in {selectedList.name} is seated.</p>
                  )}
                </div>
              </div>

              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Selected seat</span>
                  {activeSeat?.assignedStudent ? <span className="badge">{activeSeat.assignedStudent}</span> : null}
                </div>
                {activeSeat ? (
                  <>
                    <select
                      className="text-field"
                      onChange={(event) => {
                        if (!event.target.value) {
                          controller.clearSeatAssignment(activeSeat.id);
                          return;
                        }

                        controller.assignStudentToSeat(event.target.value, activeSeat.id);
                      }}
                      value={activeSeat.assignedStudent ?? ''}
                    >
                      <option value="">Unassigned</option>
                      {controller.selectedStudents.map((student) => (
                        <option key={student} value={student}>
                          {student}
                        </option>
                      ))}
                    </select>
                    <p className="helper-text">
                      Drag a student onto this seat, or click a student on the right and then click a seat.
                    </p>
                  </>
                ) : (
                  <p className="empty-copy">Select a seat to assign or clear a student.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Arrange tools</span>
                  <span className="badge">
                    {selectedTool === 'select'
                      ? 'Select'
                      : selectedTool === 'erase'
                        ? 'Erase'
                        : SEATING_CHART_ITEM_DETAILS[selectedTool].title}
                  </span>
                </div>
                <p className="helper-text">
                  Click any grid square to place items. Drag items to move or swap positions.
                </p>
              </div>

              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Selected item</span>
                  {activeItem ? (
                    <span className="badge">{SEATING_CHART_ITEM_DETAILS[activeItem.kind].title}</span>
                  ) : null}
                </div>
                {activeItem ? (
                  <>
                    {activeItem.kind !== 'seat' ? (
                      <input
                        className="text-field"
                        onChange={(event) =>
                          controller.updateItem(activeItem.id, (item) => ({
                            ...item,
                            label: event.target.value
                          }))
                        }
                        placeholder="Label"
                        type="text"
                        value={activeItem.label}
                      />
                    ) : null}

                    <div className="seating-chart__swatches">
                      {SEATING_CHART_COLOR_SWATCHES.map((color) => (
                        <button
                          aria-label={`Set item colour to ${color}`}
                          className={`seating-chart__swatch ${
                            activeItem.color === color ? 'seating-chart__swatch--active' : ''
                          }`}
                          key={color}
                          onClick={() =>
                            controller.updateItem(activeItem.id, (item) => ({
                              ...item,
                              color
                            }))
                          }
                          style={{ backgroundColor: color }}
                          type="button"
                        />
                      ))}
                    </div>

                    {activeItem.kind === 'seat' ? (
                      <div className="segmented-row">
                        {(['desk', 'round'] as const).map((seatStyle) => (
                          <button
                            className={`text-toggle button-tone--selection ${
                              activeItem.seatStyle === seatStyle ? 'text-toggle--active' : ''
                            }`}
                            key={seatStyle}
                            onClick={() =>
                              controller.updateItem(activeItem.id, (item) => ({
                                ...item,
                                seatStyle
                              }))
                            }
                            type="button"
                          >
                            {seatStyle === 'desk' ? 'Desk' : 'Round'}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <button
                      className="secondary-link"
                      onClick={() => {
                        controller.removeItem(activeItem.id);
                        setSelectedItemId(null);
                      }}
                      type="button"
                    >
                      Remove item
                    </button>
                  </>
                ) : (
                  <p className="empty-copy">Select an item to edit its label, colour, and style.</p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      <p className="helper-text">
        Saved automatically for {selectedList.name}. Layouts stay attached to this class.
      </p>
    </div>
  );
}

function SeatingChartGrid({
  assignmentTargetSeatId,
  compact,
  onGridElementChange,
  layout,
  mode,
  onGridToolAction,
  onMoveItem,
  onSelectItem,
  onSeatActivate,
  onStudentDrop,
  onStudentTokenPointerDown,
  selectedItemId,
  selectedTool
}: {
  assignmentTargetSeatId: string | null;
  compact: boolean;
  onGridElementChange: (element: HTMLDivElement | null) => void;
  layout: SeatingChartLayout;
  mode: 'arrange' | 'assign';
  onGridToolAction: (x: number, y: number, itemId: string | null) => void;
  onMoveItem: (itemId: string, x: number, y: number) => void;
  onSelectItem: (itemId: string | null) => void;
  onSeatActivate: (seatId: string) => void;
  onStudentDrop: (studentName: string, targetSeatId: string, sourceSeatId: string | null) => void;
  onStudentTokenPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    studentName: string,
    sourceSeatId: string | null
  ) => void;
  selectedItemId: string | null;
  selectedTool: 'select' | SeatingChartItemKind | 'erase';
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const itemsByCell = new Map(layout.items.map((item) => [getSeatingChartCellKey(item.x, item.y), item]));
  const pointerDragStateRef = useRef<{
    itemId: string;
    originX: number;
    originY: number;
    pointerId: number;
    started: boolean;
    targetCell: { x: number; y: number } | null;
  } | null>(null);
  const pointerDragCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragTargetCellKey, setDragTargetCellKey] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      pointerDragCleanupRef.current?.();
      pointerDragCleanupRef.current = null;
      pointerDragStateRef.current = null;
    };
  }, []);

  const getCellFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest<HTMLElement>('[data-grid-x][data-grid-y]') ?? null;

    if (!cell || !gridRef.current || !gridRef.current.contains(cell)) {
      return null;
    }

    const x = Number(cell.dataset.gridX);
    const y = Number(cell.dataset.gridY);

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return null;
    }

    return { x, y };
  };

  const syncPointerDragTarget = (clientX: number, clientY: number) => {
    const activeDrag = pointerDragStateRef.current;
    if (!activeDrag) {
      return;
    }

    const targetCell = getCellFromPoint(clientX, clientY);
    activeDrag.targetCell = targetCell;
    setDragTargetCellKey(targetCell ? getSeatingChartCellKey(targetCell.x, targetCell.y) : null);
  };

  const finishPointerDrag = (clientX?: number, clientY?: number) => {
    const activeDrag = pointerDragStateRef.current;
    pointerDragCleanupRef.current?.();
    pointerDragCleanupRef.current = null;

    if (!activeDrag) {
      return;
    }

    const targetCell =
      typeof clientX === 'number' && typeof clientY === 'number'
        ? getCellFromPoint(clientX, clientY)
        : activeDrag.targetCell;

    if (activeDrag.started) {
      suppressClickRef.current = true;
    }

    if (activeDrag.started && targetCell) {
      onMoveItem(activeDrag.itemId, targetCell.x, targetCell.y);
      onSelectItem(activeDrag.itemId);
    }

    pointerDragStateRef.current = null;
    setDraggingItemId(null);
    setDragTargetCellKey(null);
  };

  const cancelPointerDrag = () => {
    pointerDragCleanupRef.current?.();
    pointerDragCleanupRef.current = null;
    pointerDragStateRef.current = null;
    setDraggingItemId(null);
    setDragTargetCellKey(null);
  };

  const startPointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    itemId: string
  ) => {
    if (mode !== 'arrange' || selectedTool !== 'select') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelectItem(itemId);

    pointerDragStateRef.current = {
      itemId,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
      started: false,
      targetCell: getCellFromPoint(event.clientX, event.clientY)
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const activeDrag = pointerDragStateRef.current;

      if (!activeDrag || moveEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      const movedEnough =
        activeDrag.started ||
        Math.hypot(moveEvent.clientX - activeDrag.originX, moveEvent.clientY - activeDrag.originY) >= 4;

      if (!movedEnough) {
        return;
      }

      if (!activeDrag.started) {
        activeDrag.started = true;
        setDraggingItemId(activeDrag.itemId);
      }

      syncPointerDragTarget(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const activeDrag = pointerDragStateRef.current;

      if (!activeDrag || upEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      finishPointerDrag(upEvent.clientX, upEvent.clientY);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      const activeDrag = pointerDragStateRef.current;

      if (!activeDrag || cancelEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      cancelPointerDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    pointerDragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  };

  const handleDrop = (
    event: ReactDragEvent<HTMLElement>,
    targetItem: SeatingChartLayoutItem | null,
    x: number,
    y: number
  ) => {
    event.preventDefault();
    const payload = readSeatingChartDragPayload(event.dataTransfer);

    if (!payload) {
      return;
    }

    if (payload.type === 'item' && mode === 'arrange') {
      onMoveItem(payload.itemId, x, y);
      onSelectItem(payload.itemId);
      return;
    }

    if (payload.type === 'student' && mode === 'assign' && targetItem?.kind === 'seat') {
      onStudentDrop(payload.studentName, targetItem.id, payload.sourceSeatId);
      onSelectItem(targetItem.id);
    }
  };

  return (
    <div className={`seating-chart__canvas ${compact ? 'seating-chart__canvas--compact' : ''}`}>
      <div
        className={`seating-chart__grid seating-chart__grid--${mode} ${
          compact ? 'seating-chart__grid--compact' : ''
        }`}
        ref={(element) => {
          gridRef.current = element;
          onGridElementChange(element);
        }}
      >
        {Array.from({ length: SEATING_CHART_GRID_ROWS * SEATING_CHART_GRID_COLUMNS }, (_value, index) => {
          const x = index % SEATING_CHART_GRID_COLUMNS;
          const y = Math.floor(index / SEATING_CHART_GRID_COLUMNS);
          const key = getSeatingChartCellKey(x, y);
          const item = itemsByCell.get(key) ?? null;
          const isSeat = item?.kind === 'seat';
          const isSelected = item ? selectedItemId === item.id : false;
          const isDragTarget = dragTargetCellKey === key;
          const isAssignmentTarget = assignmentTargetSeatId !== null && item?.id === assignmentTargetSeatId;

          return (
            <div
              className={`seating-chart__cell ${
                item ? 'seating-chart__cell--occupied' : ''
              } ${isSelected ? 'seating-chart__cell--selected' : ''} ${
                isDragTarget ? 'seating-chart__cell--drag-target' : ''
              } ${isAssignmentTarget ? 'seating-chart__cell--assignment-target' : ''}`}
              data-grid-x={x}
              data-grid-y={y}
              key={key}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }

                if (mode === 'arrange') {
                  onGridToolAction(x, y, item?.id ?? null);
                  return;
                }

                if (item?.kind === 'seat') {
                  onSeatActivate(item.id);
                  return;
                }

                onSelectItem(null);
              }}
              onDragOver={(event) => {
                const payloadIsSupported =
                  mode === 'arrange'
                    ? hasSeatingChartDragPayload(event.dataTransfer)
                    : hasSeatingChartDragPayload(event.dataTransfer) && item?.kind === 'seat';

                if (payloadIsSupported) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => handleDrop(event, item, x, y)}
            >
              {item ? (
                <button
                  aria-label={buildSeatingChartItemTitle(item)}
                  className={`seating-chart__item seating-chart__item--${item.kind} ${
                    isSelected ? 'seating-chart__item--selected' : ''
                  } ${isSeat ? `seating-chart__item--seat-${item.seatStyle}` : ''} ${
                    item.assignedStudent ? 'seating-chart__item--assigned' : ''
                  } ${compact ? 'seating-chart__item--compact' : ''} ${
                    mode === 'arrange' && selectedTool === 'select'
                      ? 'seating-chart__item--movable'
                      : ''
                  } ${draggingItemId === item.id ? 'seating-chart__item--dragging' : ''}`}
                  data-tooltip-content={compact ? buildSeatingChartItemTitle(item) : undefined}
                  draggable={false}
                  onPointerDown={(event) => startPointerDrag(event, item.id)}
                  style={
                    {
                      ['--seat-colour' as string]: item.color
                    } as CSSProperties
                  }
                  data-seat-id={isSeat ? item.id : undefined}
                  type="button"
                >
                  {isSeat ? null : <span className="seating-chart__item-label">{item.label}</span>}
                  {isSeat ? (
                    item.assignedStudent ? (
                      <span
                        className="seating-chart__student-token"
                        draggable={false}
                        onPointerDown={(event) =>
                          onStudentTokenPointerDown(event, item.assignedStudent ?? '', item.id)
                        }
                      >
                        {compact ? formatStudentInitials(item.assignedStudent) : item.assignedStudent}
                      </span>
                    ) : (
                      <span className="seating-chart__student-placeholder">
                        {compact ? '+' : 'Drop student'}
                      </span>
                    )
                  ) : (
                    <span className="seating-chart__item-meta">
                      {SEATING_CHART_ITEM_DETAILS[item.kind].title}
                    </span>
                  )}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="seating-chart__grid-axis seating-chart__grid-axis--columns">
        {Array.from({ length: SEATING_CHART_GRID_COLUMNS }, (_value, index) => (
          <span key={`column-${index + 1}`}>{index + 1}</span>
        ))}
      </div>
      <div className="seating-chart__grid-axis seating-chart__grid-axis--rows">
        {Array.from({ length: SEATING_CHART_GRID_ROWS }, (_value, index) => (
          <span key={`row-${index + 1}`}>{index + 1}</span>
        ))}
      </div>
      {mode === 'arrange' ? (
        <p className="helper-text">
          Active tool:{' '}
          {selectedTool === 'select'
            ? 'Select existing items'
            : selectedTool === 'erase'
              ? 'Erase items from the grid'
              : `Place ${SEATING_CHART_ITEM_DETAILS[selectedTool].title.toLowerCase()} items`}
        </p>
      ) : null}
    </div>
  );
}

function BellScheduleWidgetContent({
  controller,
  onOpenEditor,
  onToggleEditor,
  showEditor
}: {
  controller: ReturnType<typeof useBellScheduleController>;
  onOpenEditor?: () => void;
  onToggleEditor?: () => void;
  showEditor: boolean;
}) {
  const activeProfileId = controller.activeProfile?.id ?? '';
  const todayHeading = controller.todayDayKey ? BELL_SCHEDULE_DAY_LABELS[controller.todayDayKey] : 'Weekend';
  const visibleUpcomingEntries = controller.upcomingEntries.slice(0, 2);
  const focusEntry = controller.currentEntry ?? controller.nextEntry;
  const heroTitle = controller.currentEntry
    ? controller.currentEntry.definition.label
    : controller.nextEntry
      ? controller.nextEntry.definition.label
      : controller.todayDayKey
        ? 'No live period'
        : 'No school period today';
  const heroEyebrow = controller.currentEntry
    ? `Now · ${todayHeading} · ${controller.activeProfileDisplayName}`
    : controller.nextEntry
      ? `Up next · ${todayHeading}`
      : `${todayHeading} · ${controller.activeProfileDisplayName}`;
  const heroDetail = controller.currentEntry
    ? formatBellScheduleEntryDetail(controller.currentEntry)
    : controller.nextEntry
      ? `${formatBellScheduleEntryDetail(controller.nextEntry)} · starts in ${formatDuration(
          controller.timeUntilNextEntryMs
        )}`
      : controller.todayDayKey
        ? 'All configured blocks for today are finished.'
        : 'Weekend mode. Live tracking resumes on weekdays.';
  const primaryActionLabel = showEditor ? 'Done editing' : 'Edit schedule';
  const handlePrimaryAction = showEditor ? onToggleEditor : onOpenEditor ?? onToggleEditor;

  return (
    <div className={`bell-schedule ${showEditor ? 'bell-schedule--editing' : ''}`}>
      <div className="bell-schedule__compact-toolbar">
        <select
          aria-label="Schedule profile"
          className="text-field bell-schedule__profile-select"
          onChange={(event) => controller.selectProfile(event.target.value)}
          value={activeProfileId}
        >
          {controller.bellSchedule.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {getBellScheduleProfileDisplayName(profile)}
            </option>
          ))}
        </select>

        {handlePrimaryAction ? (
          <button className="secondary-link button-tone--utility" onClick={handlePrimaryAction} type="button">
            {primaryActionLabel}
          </button>
        ) : null}
      </div>

      <section className="bell-schedule__summary-card">
        <div className="bell-schedule__summary-head">
          <span className="card-label">{heroEyebrow}</span>
          {focusEntry ? (
            <span
              className={`pill bell-schedule__status-pill bell-schedule__status-pill--${focusEntry.status}`}
            >
              {formatBellScheduleStatusLabel(focusEntry)}
            </span>
          ) : null}
        </div>

        <div className="bell-schedule__summary-main">
          <div className="bell-schedule__summary-copy">
            <h3 className="bell-schedule__summary-title">{heroTitle}</h3>
            <p className="bell-schedule__summary-detail">{heroDetail}</p>
          </div>
          {focusEntry ? (
            <span className="bell-schedule__summary-time">
              {formatBellTimeRange(focusEntry.definition)}
            </span>
          ) : null}
        </div>

        {controller.currentEntry ? (
          <>
            <div className="progress bell-schedule__progress">
              <span
                className="progress__fill bell-schedule__progress-fill"
                style={{ transform: `scaleX(${controller.currentProgress})` }}
              />
            </div>

            <div className="bell-schedule__metric-row">
              <article className="bell-schedule__metric">
                <span className="bell-schedule__metric-label">Elapsed</span>
                <strong>{formatDuration(controller.currentElapsedMs)}</strong>
              </article>
              <article className="bell-schedule__metric">
                <span className="bell-schedule__metric-label">Remaining</span>
                <strong>{formatDuration(controller.currentRemainingMs)}</strong>
              </article>
              <article className="bell-schedule__metric">
                <span className="bell-schedule__metric-label">Done</span>
                <strong>{controller.currentPercentLabel}</strong>
              </article>
            </div>
          </>
        ) : controller.nextEntry ? (
          <div className="bell-schedule__metric-row bell-schedule__metric-row--single">
            <article className="bell-schedule__metric">
              <span className="bell-schedule__metric-label">Starts in</span>
              <strong>{formatDuration(controller.timeUntilNextEntryMs)}</strong>
            </article>
          </div>
        ) : null}
      </section>

      {visibleUpcomingEntries.length > 0 ? (
        <section className="bell-schedule__upcoming">
          <div className="bell-schedule__upcoming-header">
            <span className="field-label">{controller.currentEntry ? 'Up next' : 'Later today'}</span>
          </div>

          <div className="bell-schedule__upcoming-list">
            {visibleUpcomingEntries.map((entry) => (
              <article className="bell-schedule__upcoming-item" key={`${entry.dayKey}-${entry.definition.id}`}>
                <div className="bell-schedule__upcoming-copy">
                  <span className="bell-schedule__upcoming-period">{entry.definition.label}</span>
                  <span className="bell-schedule__upcoming-class">{formatBellScheduleEntryDetail(entry)}</span>
                </div>
                <span className="bell-schedule__upcoming-time">
                  {formatBellTimeRange(entry.definition)}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {showEditor ? <BellScheduleEditorPanel controller={controller} /> : null}
    </div>
  );
}

function BellScheduleEditorPanel({
  controller
}: {
  controller: ReturnType<typeof useBellScheduleController>;
}) {
  return (
    <section className="bell-schedule-editor">
      <div className="bell-schedule-editor__toolbar">
        <div className="field-stack bell-schedule__profile-name">
          <label className="field-label" htmlFor="bell-schedule-profile-name">
            Profile name
          </label>
          <input
            className="text-field"
            id="bell-schedule-profile-name"
            onChange={(event) => controller.renameActiveProfile(event.target.value)}
            placeholder="Profile name"
            type="text"
            value={controller.activeProfile?.name ?? ''}
          />
        </div>

        <div className="bell-schedule-editor__toolbar-actions">
          <button
            className="secondary-link button-tone--utility"
            onClick={controller.createProfile}
            type="button"
          >
            New profile
          </button>
          <button
            className="secondary-link"
            disabled={controller.bellSchedule.profiles.length === 1}
            onClick={controller.deleteActiveProfile}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="bell-schedule-editor__header">
        <div>
          <span className="field-label">Week schedule</span>
          <p className="helper-text">
            Tick the periods you teach, then match them to your saved class lists.
          </p>
        </div>

        {controller.classLists.length === 0 ? (
          <button
            className="secondary-link button-tone--utility"
            onClick={() => window.electronAPI?.toggleClassListBuilder()}
            type="button"
          >
            Create class lists
          </button>
        ) : null}
      </div>

      <div className="bell-schedule-editor__week">
        {BELL_SCHEDULE_DAY_KEYS.map((dayKey) => {
          const dayEntries = controller.weekTimelineByDay[dayKey] ?? [];
          const teachingCount = dayEntries.filter((entry) => entry.status === 'teaching').length;

          return (
            <article className="bell-schedule-editor__day" key={dayKey}>
              <div className="bell-schedule-editor__day-header">
                <div>
                  <span className="bell-schedule-editor__day-title">
                    {BELL_SCHEDULE_DAY_LABELS[dayKey]}
                  </span>
                  <p className="helper-text">
                    {teachingCount === 0
                      ? 'No teaching blocks selected.'
                      : `${teachingCount} teaching block${teachingCount === 1 ? '' : 's'}.`}
                  </p>
                </div>
              </div>

              <div className="bell-schedule-editor__slot-list">
                {dayEntries.map((entry) => (
                  <article
                    className={`bell-schedule-editor__slot bell-schedule-editor__slot--${entry.status}`}
                    key={`${dayKey}-${entry.definition.id}`}
                  >
                    <div className="bell-schedule-editor__slot-header">
                      <div>
                        <span className="bell-schedule-editor__slot-title">
                          {entry.definition.label}
                        </span>
                        <span className="bell-schedule-editor__slot-time">
                          {formatBellTimeRange(entry.definition)}
                        </span>
                      </div>
                      <span
                        className={`pill bell-schedule__status-pill bell-schedule__status-pill--${entry.status}`}
                      >
                        {formatBellScheduleStatusLabel(entry)}
                      </span>
                    </div>

                    {entry.definition.kind === 'teaching' ? (
                      <>
                        <label className="bell-schedule-editor__toggle">
                          <input
                            checked={entry.assignment.enabled}
                            onChange={(event) =>
                              controller.updateSlotEnabled(
                                dayKey,
                                entry.definition.id,
                                event.target.checked
                              )
                            }
                            type="checkbox"
                          />
                          <span>
                            {entry.assignment.enabled ? 'Teaching this block' : 'Off / planning block'}
                          </span>
                        </label>
                        <select
                          className="text-field"
                          disabled={!entry.assignment.enabled || controller.classLists.length === 0}
                          onChange={(event) =>
                            controller.updateSlotClassList(
                              dayKey,
                              entry.definition.id,
                              event.target.value || null
                            )
                          }
                          value={entry.classList?.id ?? ''}
                        >
                          <option value="">
                            {controller.classLists.length === 0 ? 'Create a class list first' : 'Choose class'}
                          </option>
                          {controller.classLists.map((list) => (
                            <option key={list.id} value={list.id}>
                              {list.name}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <p className="helper-text">This break block stays fixed in every profile.</p>
                    )}
                  </article>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TimerWidgetPopoutCard({
  interfaceScaleControls
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
}) {
  const timer = useTimerWidgetState();

  return (
    <WidgetCard
      badge={timer.timerStatusLabel}
      badgeTone={timer.timerFinishedRecently ? 'alert' : 'default'}
      collapsed={false}
      description="Presets, custom minutes, and a quick class countdown."
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS.timer.title}
          widgetId="timer"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      title={WIDGET_DETAILS.timer.title}
      widgetId="timer"
      widthCategory="single"
    >
      <TimerWidgetContent
        activeDurationMs={timer.timer.baseDurationMs}
        customTimerActive={timer.customTimerActive}
        customTimerMinutes={timer.customTimerMinutes}
        customTimerMs={timer.customTimerMs}
        isTimerPaused={timer.isTimerPaused}
        isTimerRunning={timer.isTimerRunning}
        onPause={timer.pauseTimer}
        onReset={timer.resetTimer}
        onResume={timer.resumeTimer}
        onSetPreset={timer.setPreset}
        onStart={timer.startTimer}
        onUpdateCustomTimer={timer.updateCustomTimer}
        timerLabel={timer.timerLabel}
        timerProgress={timer.timerProgress}
      />
    </WidgetCard>
  );
}

function BellScheduleWidgetPopoutCard({
  interfaceScaleControls
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
}) {
  const [picker] = usePickerState();
  const bellSchedule = useBellScheduleController(picker.lists);
  const showEditor = bellSchedule.popoutMode === 'editor';

  return (
    <WidgetCard
      badge={bellSchedule.badgeLabel}
      collapsed={false}
      description={
        bellSchedule.activeProfile
          ? `Using ${bellSchedule.activeProfileDisplayName}`
          : 'Set up a weekly bell schedule.'
      }
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['bell-schedule'].title}
          widgetId="bell-schedule"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      title={WIDGET_DETAILS['bell-schedule'].title}
      widgetId="bell-schedule"
      widthCategory={showEditor ? 'double' : 'single'}
    >
      <BellScheduleWidgetContent
        controller={bellSchedule}
        onToggleEditor={() =>
          bellSchedule.setPopoutMode(showEditor ? 'summary' : 'editor')
        }
        showEditor={showEditor}
      />
    </WidgetCard>
  );
}

function PickerWidgetPopoutCard({
  interfaceScaleControls
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
}) {
  const picker = usePickerWidgetState();

  return (
    <WidgetCard
      badge={`${picker.rosterCount}`}
      collapsed={false}
      description={picker.selectedList ? `Using ${picker.selectedList.name}` : 'Choose a class from the main dashboard.'}
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS.picker.title}
          widgetId="picker"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      title={WIDGET_DETAILS.picker.title}
      widgetId="picker"
      widthCategory="single"
    >
      <PickerWidgetContent
        isPickerSpinning={picker.isPickerSpinning}
        onPick={picker.pickStudent}
        onResetCycle={picker.resetCurrentListCycle}
        onToggleRemovePickedStudents={picker.toggleRemovePickedStudents}
        pickerSpinnerNames={picker.pickerSpinnerNames}
        recentPicks={picker.recentPicks}
        removePickedStudents={picker.picker.removePickedStudents}
        selectedStudentCount={picker.selectedStudents.length}
      />
    </WidgetCard>
  );
}

function GroupMakerWidgetPopoutCard({
  interfaceScaleControls
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
}) {
  const groupMaker = useGroupMakerWidgetState();

  return (
    <WidgetCard
      badge={groupMaker.groupBadgeLabel}
      collapsed={false}
      description={
        groupMaker.selectedList
          ? `Using ${groupMaker.selectedList.name}`
          : 'Choose a class from the main dashboard.'
      }
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['group-maker'].title}
          widgetId="group-maker"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      title={WIDGET_DETAILS['group-maker'].title}
      widgetId="group-maker"
      widthCategory="double"
    >
      <GroupMakerWidgetContent
        activeGroups={groupMaker.activeGroups}
        emptyCopy={
          groupMaker.selectedList
            ? 'Groups will show up here after you shuffle the current list.'
            : 'Choose a class in the main dashboard to start making groups.'
        }
        groupMakerHint={groupMaker.groupMakerHint}
        groupSize={groupMaker.groupMaker.groupSize}
        hasSavedGroups={groupMaker.groupMaker.groups.length > 0}
        onClear={groupMaker.clearGroups}
        onShuffle={groupMaker.makeGroups}
        onUpdateGroupSize={groupMaker.updateGroupSize}
        selectedStudentCount={groupMaker.selectedStudents.length}
      />
    </WidgetCard>
  );
}

function SeatingChartWidgetPopoutCard({
  interfaceScaleControls
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
}) {
  const [picker] = usePickerState();
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const seatingChart = useSeatingChartController(selectedList);

  return (
    <WidgetCard
      badge={selectedList ? `${seatingChart.assignedSeatCount}/${selectedList.students.length}` : null}
      collapsed={false}
      description={
        selectedList
          ? `${activeLayoutNameForSeatingChart(seatingChart.activeLayout)} · ${selectedList.name}`
          : 'Choose a class from the main dashboard.'
      }
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['seating-chart'].title}
          widgetId="seating-chart"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      title={WIDGET_DETAILS['seating-chart'].title}
      widgetId="seating-chart"
      widthCategory="double"
    >
      <SeatingChartWidgetContent controller={seatingChart} mode="popout" />
    </WidgetCard>
  );
}

function PlannerWidgetPopoutCard({
  interfaceScaleControls
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
}) {
  const [picker] = usePickerState();
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const planner = useLessonPlannerController(picker.selectedListId);

  return (
    <WidgetCard
      badge={planner.documents.length > 0 ? `${planner.documents.length}` : null}
      collapsed={false}
      description={selectedList ? `Planning ${selectedList.name}` : 'Choose a class from the main dashboard.'}
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS.planner.title}
          widgetId="planner"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      title={WIDGET_DETAILS.planner.title}
      widgetId="planner"
      widthCategory="double"
    >
      <PlannerWidgetContent
        documents={planner.documents}
        entryDates={planner.entryDates}
        onAttachDocuments={planner.attachDocuments}
        onOpenDocument={planner.openDocument}
        onRemoveDocument={planner.removeDocument}
        onSelectDate={planner.setSelectedDate}
        onUpdatePlan={planner.updatePlan}
        planText={planner.plan}
        selectedDate={planner.selectedDate}
        selectedList={selectedList}
        statusMessage={planner.statusMessage}
      />
    </WidgetCard>
  );
}

function NotesWidgetPopoutCard({
  interfaceScaleControls
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
}) {
  const notes = useNotesWidgetState();

  return (
    <WidgetCard
      badge={notes.stickyNotes.length > 0 ? `${notes.stickyNotes.length}` : null}
      collapsed={false}
      description="Capture reminders and quick thoughts."
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS.notes.title}
          widgetId="notes"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      title={WIDGET_DETAILS.notes.title}
      widgetId="notes"
      widthCategory="single"
    >
      <NotesWidgetContent
        noteDraft={notes.noteDraft}
        notes={notes.stickyNotes}
        onAddNote={notes.addStickyNote}
        onDraftChange={notes.setNoteDraft}
        onRemoveNote={notes.removeStickyNote}
      />
    </WidgetCard>
  );
}

function usePickerState() {
  return usePersistentState<PickerSnapshot>('teacher-tools.picker', DEFAULT_PICKER, {
    normalize: normalizePickerSnapshot
  });
}

function useThemePreferenceState() {
  return usePersistentState<ThemePreference>('teacher-tools.theme', 'system');
}

function useInterfaceScaleState() {
  return usePersistentState<number>('teacher-tools.interface-scale', DEFAULT_INTERFACE_SCALE, {
    normalize: normalizeInterfaceScale
  });
}

function useInterfaceScaleControls() {
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

function useDashboardLayoutsState() {
  return usePersistentState<DashboardLayoutsSnapshot>(
    'teacher-tools.dashboard-layouts',
    DEFAULT_DASHBOARD_LAYOUTS,
    {
      normalize: normalizeDashboardLayoutsSnapshot
    }
  );
}

function usePlannerState() {
  return usePersistentState<PlannerSnapshot>('teacher-tools.planner', DEFAULT_PLANNER, {
    normalize: normalizePlannerSnapshot
  });
}

function useSeatingChartState() {
  return usePersistentState<SeatingChartSnapshot>(
    'teacher-tools.seating-chart',
    DEFAULT_SEATING_CHART,
    {
      normalize: normalizeSeatingChartSnapshot
    }
  );
}

function useBellScheduleState() {
  return usePersistentState<BellScheduleSnapshot>(
    'teacher-tools.bell-schedule',
    DEFAULT_BELL_SCHEDULE,
    {
      normalize: normalizeBellScheduleSnapshot
    }
  );
}

function useBellSchedulePopoutModeState() {
  return usePersistentState<BellSchedulePopoutMode>(
    'teacher-tools.bell-schedule-popout-mode',
    'summary',
    {
      normalize: normalizeBellSchedulePopoutMode
    }
  );
}

function useBellScheduleController(classLists: ClassList[]) {
  const [bellSchedule, setBellSchedule] = useBellScheduleState();
  const [popoutMode, setPopoutMode] = useBellSchedulePopoutModeState();
  const now = useClockNow();
  const activeProfile =
    bellSchedule.profiles.find((profile) => profile.id === bellSchedule.activeProfileId) ??
    bellSchedule.profiles[0] ??
    null;
  const activeProfileDisplayName = activeProfile
    ? getBellScheduleProfileDisplayName(activeProfile)
    : 'Bell Schedule';
  const todayDate = new Date(now);
  const todayDayKey = getBellScheduleDayKey(todayDate);
  const currentMinutes = getMinutesSinceMidnight(todayDate);
  const weekTimelineByDay = activeProfile
    ? Object.fromEntries(
        BELL_SCHEDULE_DAY_KEYS.map((dayKey) => [
          dayKey,
          buildBellTimelineEntries(activeProfile, dayKey, classLists)
        ])
      ) as Record<BellScheduleDayKey, BellTimelineEntry[]>
    : createEmptyBellTimelineByDay();
  const todayTimeline = todayDayKey ? weekTimelineByDay[todayDayKey] : [];
  const currentEntry =
    todayTimeline.find(
      (entry) =>
        currentMinutes >= entry.definition.startMinutes &&
        currentMinutes < entry.definition.endMinutes
    ) ?? null;
  const nextEntry =
    todayTimeline.find((entry) => entry.definition.startMinutes > currentMinutes) ?? null;
  const upcomingEntries = currentEntry
    ? todayTimeline.filter(
        (entry) => entry.definition.startMinutes >= currentEntry.definition.endMinutes
      )
    : todayTimeline.filter((entry) => entry.definition.startMinutes > currentMinutes);
  const currentStartMs = currentEntry
    ? getTimestampForMinutes(todayDate, currentEntry.definition.startMinutes)
    : null;
  const currentEndMs = currentEntry
    ? getTimestampForMinutes(todayDate, currentEntry.definition.endMinutes)
    : null;
  const currentDurationMs =
    currentEntry && currentStartMs !== null && currentEndMs !== null
      ? currentEndMs - currentStartMs
      : 0;
  const currentElapsedMs =
    currentEntry && currentStartMs !== null
      ? clampNumber(now - currentStartMs, 0, currentDurationMs)
      : 0;
  const currentRemainingMs =
    currentEntry && currentEndMs !== null
      ? clampNumber(currentEndMs - now, 0, currentDurationMs)
      : 0;
  const currentProgress =
    currentDurationMs > 0 ? clampNumber(currentElapsedMs / currentDurationMs, 0, 1) : 0;
  const currentPercentLabel = `${Math.round(currentProgress * 100)}%`;
  const nextEntryStartMs = nextEntry
    ? getTimestampForMinutes(todayDate, nextEntry.definition.startMinutes)
    : null;
  const timeUntilNextEntryMs =
    nextEntryStartMs !== null ? Math.max(nextEntryStartMs - now, 0) : 0;
  const configuredTodayCount = todayTimeline.filter((entry) => entry.status === 'teaching').length;
  const configuredWeekCount = BELL_SCHEDULE_DAY_KEYS.reduce((count, dayKey) => {
    return count + weekTimelineByDay[dayKey].filter((entry) => entry.status === 'teaching').length;
  }, 0);
  const badgeLabel = currentEntry
    ? currentEntry.definition.shortLabel
    : nextEntry
      ? `Next ${nextEntry.definition.shortLabel}`
      : null;

  const selectProfile = (profileId: string) => {
    setBellSchedule((current) => selectBellScheduleProfile(current, profileId));
  };

  const createProfile = () => {
    setBellSchedule((current) => addBellScheduleProfile(current, current.activeProfileId));
  };

  const deleteActiveProfile = () => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? removeBellScheduleProfile(current, current.activeProfileId)
        : current
    );
  };

  const renameActiveProfile = (name: string) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? renameBellScheduleProfile(current, current.activeProfileId, name)
        : current
    );
  };

  const updateSlotEnabled = (
    dayKey: BellScheduleDayKey,
    slotId: BellScheduleSlotId,
    enabled: boolean
  ) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? updateBellScheduleSlotAssignment(
            current,
            current.activeProfileId,
            dayKey,
            slotId,
            (assignment) => ({
              ...assignment,
              enabled
            })
          )
        : current
    );
  };

  const updateSlotClassList = (
    dayKey: BellScheduleDayKey,
    slotId: BellScheduleSlotId,
    classListId: string | null
  ) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? updateBellScheduleSlotAssignment(
            current,
            current.activeProfileId,
            dayKey,
            slotId,
            (assignment) => ({
              ...assignment,
              classListId
            })
          )
        : current
    );
  };

  return {
    activeProfile,
    activeProfileDisplayName,
    badgeLabel,
    bellSchedule,
    classLists,
    configuredTodayCount,
    configuredWeekCount,
    createProfile,
    currentElapsedMs,
    currentEntry,
    currentPercentLabel,
    currentProgress,
    currentRemainingMs,
    deleteActiveProfile,
    nextEntry,
    popoutMode,
    renameActiveProfile,
    selectProfile,
    setPopoutMode,
    timeUntilNextEntryMs,
    todayDayKey,
    todayTimeline,
    upcomingEntries,
    updateSlotClassList,
    updateSlotEnabled,
    weekTimelineByDay
  };
}

function useWidgetPopoutIds() {
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

function useTimerWidgetState() {
  const [timer, setTimer] = usePersistentState<TimerSnapshot>('teacher-tools.timer', DEFAULT_TIMER);
  const [customTimerMinutes, setCustomTimerMinutes] = usePersistentState<number>(
    'teacher-tools.custom-timer-minutes',
    0
  );
  const liveNowUntil = timer.endsAt ?? (timer.lastCompletedAt ? timer.lastCompletedAt + 5000 : null);
  const now = useNow(liveNowUntil);
  const remainingMs = timer.endsAt ? Math.max(timer.endsAt - now, 0) : timer.pausedRemainingMs;
  const isTimerRunning = timer.endsAt !== null && remainingMs > 0;
  const isTimerPaused =
    timer.endsAt === null &&
    timer.pausedRemainingMs > 0 &&
    timer.pausedRemainingMs < timer.baseDurationMs;
  const timerFinishedRecently = Boolean(timer.lastCompletedAt && now - timer.lastCompletedAt < 5000);
  const timerProgress = timer.baseDurationMs === 0 ? 0 : remainingMs / timer.baseDurationMs;
  const customTimerMs = customTimerMinutes * 60 * 1000;
  const customTimerActive = customTimerMinutes > 0 && timer.baseDurationMs === customTimerMs;

  useEffect(() => {
    if (timer.endsAt && remainingMs === 0) {
      setTimer((current) => ({
        ...current,
        endsAt: null,
        pausedRemainingMs: 0,
        lastCompletedAt: Date.now()
      }));
    }
  }, [remainingMs, setTimer, timer.endsAt]);

  const startTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: Date.now() + current.baseDurationMs,
      pausedRemainingMs: current.baseDurationMs,
      lastCompletedAt: null
    }));
  };

  const pauseTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: null,
      pausedRemainingMs: current.endsAt ? Math.max(current.endsAt - Date.now(), 0) : 0
    }));
  };

  const resumeTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: Date.now() + current.pausedRemainingMs,
      lastCompletedAt: null
    }));
  };

  const resetTimer = () => {
    setTimer((current) => ({
      ...current,
      endsAt: null,
      pausedRemainingMs: current.baseDurationMs,
      lastCompletedAt: null
    }));
  };

  const setPreset = (durationMs: number) => {
    setTimer({
      baseDurationMs: durationMs,
      endsAt: null,
      pausedRemainingMs: durationMs,
      lastCompletedAt: null
    });
  };

  const updateCustomTimer = (nextMinutes: number) => {
    const clampedMinutes = clampNumber(nextMinutes, 0, CUSTOM_TIMER_MAX_MINUTES);
    const previousCustomTimerMs = customTimerMinutes * 60 * 1000;

    setCustomTimerMinutes(clampedMinutes);

    if (clampedMinutes > 0) {
      setPreset(clampedMinutes * 60 * 1000);
      return;
    }

    if (timer.baseDurationMs === previousCustomTimerMs) {
      setPreset(DEFAULT_TIMER.baseDurationMs);
    }
  };

  return {
    customTimerActive,
    customTimerMinutes,
    customTimerMs,
    isTimerPaused,
    isTimerRunning,
    pauseTimer,
    resetTimer,
    resumeTimer,
    setPreset,
    startTimer,
    timer,
    timerFinishedRecently,
    timerLabel: formatDuration(remainingMs),
    timerProgress,
    timerStatusLabel: timerFinishedRecently
      ? 'Done'
      : isTimerRunning
        ? 'Live'
        : isTimerPaused
          ? 'Paused'
          : 'Ready',
    updateCustomTimer
  };
}

function usePickerWidgetState() {
  const pickerSpinIntervalRef = useRef<number | null>(null);
  const [picker, setPicker] = usePickerState();
  const [isPickerSpinning, setIsPickerSpinning] = useState(false);
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const selectedStudents = selectedList?.students ?? [];

  useEffect(() => {
    if (isPickerSpinning || !selectedStudents.length) {
      return;
    }

    if (picker.currentPick) {
      const nextIndex = selectedStudents.indexOf(picker.currentPick);
      if (nextIndex >= 0) {
        setSpinnerIndex(nextIndex);
        return;
      }
    }

    setSpinnerIndex(0);
  }, [isPickerSpinning, picker.currentPick, selectedStudents]);

  useEffect(() => {
    return () => {
      if (pickerSpinIntervalRef.current !== null) {
        window.clearInterval(pickerSpinIntervalRef.current);
      }
    };
  }, []);

  const resetCurrentListCycle = () => {
    if (!selectedList) {
      return;
    }

    setPicker((current) => ({
      ...current,
      pool: [...selectedList.students],
      currentPick: null,
      recentPicks: []
    }));
  };

  const toggleRemovePickedStudents = (removePickedStudents: boolean) => {
    setPicker((current) => {
      if (current.removePickedStudents === removePickedStudents) {
        return current;
      }

      const activeList = current.lists.find((list) => list.id === current.selectedListId) ?? null;

      return {
        ...current,
        removePickedStudents,
        pool: activeList ? [...activeList.students] : []
      };
    });
  };

  const pickStudent = () => {
    if (isPickerSpinning || !selectedList || !selectedStudents.length) {
      return;
    }

    const readyPool = getPickerSelectionPool(
      selectedStudents,
      picker.pool,
      picker.removePickedStudents
    );
    const pickedName = readyPool[Math.floor(Math.random() * readyPool.length)];
    const remainingPool = getPickerRemainingPool(
      selectedStudents,
      readyPool,
      pickedName,
      picker.removePickedStudents
    );
    const finalIndex = selectedStudents.indexOf(pickedName);
    const normalizedSpinnerIndex = selectedStudents.length
      ? ((spinnerIndex % selectedStudents.length) + selectedStudents.length) % selectedStudents.length
      : 0;
    const totalSteps =
      Math.max(selectedStudents.length * 2, 10) +
      ((finalIndex - normalizedSpinnerIndex + selectedStudents.length) % selectedStudents.length);
    let currentStep = 0;
    let currentIndex = normalizedSpinnerIndex;
    const selectedListId = selectedList.id;

    if (pickerSpinIntervalRef.current !== null) {
      window.clearInterval(pickerSpinIntervalRef.current);
    }

    setIsPickerSpinning(true);

    pickerSpinIntervalRef.current = window.setInterval(() => {
      currentIndex = (currentIndex + 1) % selectedStudents.length;
      currentStep += 1;
      setSpinnerIndex(currentIndex);

      if (currentStep < totalSteps) {
        return;
      }

      if (pickerSpinIntervalRef.current !== null) {
        window.clearInterval(pickerSpinIntervalRef.current);
        pickerSpinIntervalRef.current = null;
      }

      setSpinnerIndex(finalIndex);
      setIsPickerSpinning(false);
      setPicker((current) => {
        if (current.selectedListId !== selectedListId) {
          return current;
        }

        return {
          ...current,
          pool: remainingPool,
          currentPick: pickedName,
          recentPicks: [pickedName, ...current.recentPicks.filter((entry) => entry !== pickedName)].slice(
            0,
            5
          )
        };
      });
    }, 90);
  };

  return {
    isPickerSpinning,
    pickStudent,
    picker,
    pickerSpinnerNames: buildPickerSpinnerNames({
      currentPick: picker.currentPick,
      isSpinning: isPickerSpinning,
      names: selectedStudents,
      spinnerIndex
    }),
    recentPicks: picker.recentPicks.slice(0, 4),
    resetCurrentListCycle,
    rosterCount: selectedStudents.length,
    selectedList,
    selectedStudents,
    toggleRemovePickedStudents
  };
}

function useGroupMakerWidgetState() {
  const [picker] = usePickerState();
  const [groupMaker, setGroupMaker] = usePersistentState<GroupMakerSnapshot>(
    'teacher-tools.group-maker',
    DEFAULT_GROUP_MAKER,
    {
      normalize: normalizeGroupMakerSnapshot
    }
  );
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const selectedStudents = selectedList?.students ?? [];
  const activeGroups =
    selectedList &&
    groupMaker.listId === selectedList.id &&
    haveSameStudents(groupMaker.sourceStudents, selectedStudents)
      ? groupMaker.groups
      : [];
  const groupCount = activeGroups.length;

  const updateGroupSize = (nextSize: number) => {
    const clampedSize = clampNumber(nextSize, GROUP_SIZE_MIN, GROUP_SIZE_MAX);

    setGroupMaker((current) => {
      if (current.groupSize === clampedSize) {
        return current;
      }

      return {
        ...current,
        groupSize: clampedSize,
        groups: [],
        listId: null,
        sourceStudents: []
      };
    });
  };

  const clearGroups = () => {
    setGroupMaker((current) => ({
      ...current,
      groups: [],
      listId: null,
      sourceStudents: []
    }));
  };

  const makeGroups = () => {
    if (!selectedList || selectedStudents.length < 2) {
      return;
    }

    setGroupMaker((current) => ({
      ...current,
      groups: buildStudentGroups(selectedStudents, current.groupSize),
      listId: selectedList.id,
      sourceStudents: [...selectedStudents]
    }));
  };

  return {
    activeGroups,
    clearGroups,
    groupBadgeLabel:
      groupCount > 0
        ? `${groupCount} group${groupCount === 1 ? '' : 's'}`
        : `${groupMaker.groupSize}/group`,
    groupMaker,
    groupMakerHint: !selectedList
      ? 'Choose a class list to start grouping.'
      : selectedStudents.length < 2
        ? 'Add at least two students to make groups.'
        : groupCount > 0
          ? `${selectedStudents.length} students arranged into ${groupCount} balanced group${
              groupCount === 1 ? '' : 's'
            }.`
          : `Shuffle ${selectedStudents.length} students into groups of about ${groupMaker.groupSize}.`,
    makeGroups,
    selectedList,
    selectedStudents,
    updateGroupSize
  };
}

function useNotesWidgetState() {
  const [stickyNotes, setStickyNotes] = usePersistentState<StickyNote[]>('teacher-tools.note-items', []);
  const [noteDraft, setNoteDraft] = usePersistentState<string>('teacher-tools.note-draft', '');

  useEffect(() => {
    if (stickyNotes.length > 0) {
      return;
    }

    try {
      const legacyRaw = window.localStorage.getItem('teacher-tools.notes');
      if (!legacyRaw) {
        return;
      }

      const legacyValue = JSON.parse(legacyRaw);
      if (typeof legacyValue === 'string' && legacyValue.trim()) {
        setStickyNotes([
          {
            id: createStickyNoteId(),
            text: legacyValue.trim(),
            createdAt: Date.now()
          }
        ]);
      }

      window.localStorage.removeItem('teacher-tools.notes');
    } catch {
      // Ignore legacy migration failures.
    }
  }, [setStickyNotes, stickyNotes.length]);

  const addStickyNote = () => {
    const nextText = noteDraft.trim();
    if (!nextText) {
      return;
    }

    setStickyNotes((current) => [
      {
        id: createStickyNoteId(),
        text: nextText,
        createdAt: Date.now()
      },
      ...current
    ]);
    setNoteDraft('');
  };

  const removeStickyNote = (id: string) => {
    setStickyNotes((current) => current.filter((note) => note.id !== id));
  };

  return {
    addStickyNote,
    noteDraft,
    removeStickyNote,
    setNoteDraft,
    stickyNotes
  };
}

function useLessonPlannerController(selectedListId: string | null) {
  const [planner, setPlanner] = usePlannerState();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const selectedDate = getPlannerSelectedDate(planner, selectedListId);
  const entry = getPlannerEntry(planner, selectedListId, selectedDate);
  const documents = entry?.documents ?? [];
  const plan = entry?.plan ?? '';
  const entryDates = Object.keys(planner.entriesByListId[getDashboardLayoutKey(selectedListId)] ?? {});

  useEffect(() => {
    setStatusMessage(null);
  }, [selectedDate, selectedListId]);

  const setSelectedDate = (dateKey: string) => {
    const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();

    setPlanner((current) => setPlannerDateForList(current, selectedListId, normalizedDate));
  };

  const updatePlan = (nextPlan: string) => {
    setPlanner((current) =>
      updatePlannerEntry(current, selectedListId, selectedDate, (existing) => ({
        ...existing,
        plan: nextPlan,
        updatedAt: Date.now()
      }))
    );
  };

  const removeDocument = (documentId: string) => {
    setPlanner((current) =>
      updatePlannerEntry(current, selectedListId, selectedDate, (existing) => ({
        ...existing,
        documents: existing.documents.filter((document) => document.id !== documentId),
        updatedAt: Date.now()
      }))
    );
  };

  const attachDocuments = async () => {
    if (!window.electronAPI?.selectLessonDocuments) {
      setStatusMessage('Document links are available in the desktop app only.');
      return;
    }

    const selections = await window.electronAPI.selectLessonDocuments();
    if (selections.length === 0) {
      return;
    }

    setPlanner((current) =>
      updatePlannerEntry(current, selectedListId, selectedDate, (existing) => ({
        ...existing,
        documents: mergeLessonDocuments(existing.documents, selections),
        updatedAt: Date.now()
      }))
    );
    setStatusMessage(
      `${selections.length} document${selections.length === 1 ? '' : 's'} attached for ${formatLongDate(selectedDate)}.`
    );
  };

  const openDocument = async (document: PlannerDocument) => {
    if (!window.electronAPI?.openLessonDocument) {
      setStatusMessage('Opening documents is available in the desktop app only.');
      return;
    }

    const errorMessage = await window.electronAPI.openLessonDocument(document.path);
    if (errorMessage) {
      setStatusMessage(`Couldn't open ${document.name}. ${errorMessage}`);
      return;
    }

    setStatusMessage(`Opened ${document.name}.`);
  };

  return {
    attachDocuments,
    documents,
    entryDates,
    hasContent: Boolean(plan.trim() || documents.length > 0),
    openDocument,
    plan,
    removeDocument,
    selectedDate,
    setSelectedDate,
    statusMessage,
    updatePlan
  };
}

function useSeatingChartController(selectedList: ClassList | null) {
  const [seatingChart, setSeatingChart] = useSeatingChartState();
  const selectedStudents = selectedList?.students ?? [];
  const classState = selectedList
    ? getSeatingChartClassState(seatingChart, selectedList.id, selectedStudents.length)
    : null;
  const activeLayout = classState
    ? sanitizeSeatingChartLayout(
        getActiveSeatingChartLayout(classState, selectedStudents.length),
        selectedStudents
      )
    : null;
  const seatItems = activeLayout ? getSeatingChartSeatItems(activeLayout) : [];
  const assignedStudentNames = seatItems
    .map((item) => item.assignedStudent)
    .filter((student): student is string => Boolean(student));
  const assignedStudentSet = new Set(assignedStudentNames);
  const unseatedStudents = selectedStudents.filter((student) => !assignedStudentSet.has(student));
  const hasEnoughSeats = seatItems.length >= selectedStudents.length;

  const updateSelectedListChart = (
    updater: (classState: SeatingChartClassState) => SeatingChartClassState
  ) => {
    if (!selectedList) {
      return;
    }

    setSeatingChart((current) =>
      updateSeatingChartForList(current, selectedList.id, selectedStudents.length, updater)
    );
  };

  const updateActiveLayout = (
    updater: (layout: SeatingChartLayout) => SeatingChartLayout
  ) => {
    updateSelectedListChart((current) => ({
      ...current,
      layouts: current.layouts.map((layout) =>
        layout.id === current.activeLayoutId
          ? sanitizeSeatingChartLayout(updater(layout), selectedStudents)
          : layout
      )
    }));
  };

  return {
    activeLayout,
    assignedSeatCount: assignedStudentNames.length,
    canDeleteLayout: Boolean(classState && classState.layouts.length > 1),
    hasEnoughSeats,
    layoutCount: classState?.layouts.length ?? 0,
    layoutOptions: classState?.layouts ?? [],
    seatCount: seatItems.length,
    seatItems,
    selectedList,
    selectedStudents,
    seatingChart,
    unseatedStudents,
    addLayout: () =>
      updateSelectedListChart((current) => createEmptySeatingChartClassStateFromCurrent(current)),
    assignStudentToSeat: (studentName: string, targetSeatId: string, sourceSeatId: string | null = null) =>
      updateActiveLayout((layout) =>
        assignStudentToSeatInLayout(layout, studentName, targetSeatId, sourceSeatId)
      ),
    autofillAssignments: () =>
      updateActiveLayout((layout) =>
        autofillSeatingChartLayout(layout, selectedStudents)
      ),
    clearAssignments: () =>
      updateActiveLayout((layout) => clearSeatingChartLayoutAssignments(layout)),
    clearSeatAssignment: (seatId: string) =>
      updateActiveLayout((layout) => clearSeatingChartSeatAssignment(layout, seatId)),
    deleteActiveLayout: () =>
      updateSelectedListChart((current) =>
        current.activeLayoutId
          ? deleteSeatingChartLayout(current, current.activeLayoutId)
          : current
      ),
    duplicateActiveLayout: () =>
      updateSelectedListChart((current) => duplicateActiveSeatingChartLayout(current, selectedStudents.length)),
    moveItem: (itemId: string, x: number, y: number) =>
      updateActiveLayout((layout) => moveSeatingChartLayoutItem(layout, itemId, x, y)),
    removeItem: (itemId: string) =>
      updateActiveLayout((layout) => removeSeatingChartLayoutItem(layout, itemId)),
    renameActiveLayout: (name: string) =>
      updateSelectedListChart((current) =>
        current.activeLayoutId
          ? renameSeatingChartLayout(current, current.activeLayoutId, name)
          : current
      ),
    reshuffleAssignments: () =>
      updateActiveLayout((layout) =>
        reshuffleSeatingChartLayout(layout, selectedStudents)
      ),
    selectLayout: (layoutId: string) =>
      updateSelectedListChart((current) => selectSeatingChartLayout(current, layoutId)),
    setItemAtCell: (kind: SeatingChartItemKind, x: number, y: number) =>
      updateActiveLayout((layout) => setSeatingChartItemAtPosition(layout, kind, x, y)),
    updateItem: (
      itemId: string,
      updater: (item: SeatingChartLayoutItem) => SeatingChartLayoutItem
    ) =>
      updateActiveLayout((layout) => updateSeatingChartLayoutItem(layout, itemId, updater))
  };
}

function normalizeStoredStateValue<T>(
  raw: unknown,
  initialValue: T,
  normalize?: (raw: unknown, initialValue: T) => T
) {
  try {
    return normalize ? normalize(raw, initialValue) : (raw as T);
  } catch {
    return initialValue;
  }
}

function serializeStoredStateValue(value: unknown) {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

function parseStoredStateValue<T>(serialized: string, fallbackValue: T) {
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return fallbackValue;
  }
}

function readLocalStorageStateValue<T>(
  key: string,
  initialValue: T,
  normalize?: (raw: unknown, initialValue: T) => T
) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return {
        found: false,
        value: initialValue
      };
    }

    return {
      found: true,
      value: normalizeStoredStateValue(parseStoredStateValue(raw, initialValue), initialValue, normalize)
    };
  } catch {
    return {
      found: false,
      value: initialValue
    };
  }
}

function getInitialPersistentState<T>(
  key: string,
  initialValue: T,
  normalize?: (raw: unknown, initialValue: T) => T
) {
  const desktopState = window.electronAPI?.getPersistentState(key);
  if (desktopState?.found) {
    return {
      shouldMigrateLocalState: false,
      value: normalizeStoredStateValue(desktopState.value, initialValue, normalize)
    };
  }

  const localState = readLocalStorageStateValue(key, initialValue, normalize);
  return {
    shouldMigrateLocalState: Boolean(window.electronAPI && localState.found),
    value: localState.value
  };
}

function usePersistentState<T>(
  key: string,
  initialValue: T,
  options?: {
    normalize?: (raw: unknown, initialValue: T) => T;
  }
) {
  const normalize = options?.normalize;
  const shouldMigrateLocalStateRef = useRef(false);
  const lastPersistedSerializedRef = useRef<string | null>(null);
  const [state, setState] = useState<T>(() => {
    const initialState = getInitialPersistentState(key, initialValue, normalize);
    shouldMigrateLocalStateRef.current = initialState.shouldMigrateLocalState;
    lastPersistedSerializedRef.current = serializeStoredStateValue(initialState.value);
    return initialState.value;
  });

  useEffect(() => {
    const serialized = serializeStoredStateValue(state);

    if (!window.electronAPI?.setPersistentState) {
      try {
        window.localStorage.setItem(key, serialized);
        lastPersistedSerializedRef.current = serialized;
      } catch {
        // Ignore local fallback persistence failures.
      }
      return;
    }

    if (serialized === lastPersistedSerializedRef.current && !shouldMigrateLocalStateRef.current) {
      return;
    }

    const nextValue = parseStoredStateValue(serialized, state);
    let cancelled = false;

    void window.electronAPI
      .setPersistentState(key, nextValue)
      .then((saved) => {
        if (cancelled || !saved) {
          return;
        }

        lastPersistedSerializedRef.current = serialized;

        if (shouldMigrateLocalStateRef.current) {
          try {
            window.localStorage.removeItem(key);
          } catch {
            // Ignore cleanup failures and keep the desktop-backed value.
          }

          shouldMigrateLocalStateRef.current = false;
        }
      })
      .catch(() => {
        // Ignore IPC save failures and keep the in-memory state intact.
      });

    return () => {
      cancelled = true;
    };
  }, [key, state]);

  useEffect(() => {
    if (window.electronAPI?.onPersistentStateChanged) {
      return window.electronAPI.onPersistentStateChanged((change) => {
        if (change.key !== key) {
          return;
        }

        const nextState = normalizeStoredStateValue(change.value, initialValue, normalize);
        const nextSerialized = serializeStoredStateValue(nextState);
        lastPersistedSerializedRef.current = nextSerialized;
        shouldMigrateLocalStateRef.current = false;

        setState((current) =>
          serializeStoredStateValue(current) === nextSerialized ? current : nextState
        );
      });
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== key) {
        return;
      }

      if (event.newValue === null) {
        lastPersistedSerializedRef.current = serializeStoredStateValue(initialValue);
        setState(initialValue);
        return;
      }

      try {
        const nextState = normalizeStoredStateValue(
          parseStoredStateValue(event.newValue, initialValue),
          initialValue,
          normalize
        );
        lastPersistedSerializedRef.current = serializeStoredStateValue(nextState);
        setState(nextState);
      } catch {
        lastPersistedSerializedRef.current = serializeStoredStateValue(initialValue);
        setState(initialValue);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [initialValue, key, normalize]);

  return [state, setState] as const;
}

function useNow(liveUntil: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());

    if (liveUntil === null || Date.now() >= liveUntil) {
      return;
    }

    const interval = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);

      if (nextNow >= liveUntil) {
        window.clearInterval(interval);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [liveUntil]);

  return now;
}

function useClockNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return now;
}

function useResolvedTheme(preference: ThemePreference): ThemeMode {
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

function ThemeCycleIcon({ preference }: { preference: ThemePreference }) {
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

function InterfaceScaleControls({
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

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function splitNames(rawInput: string) {
  return dedupeNames(
    rawInput
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getNextThemePreference(preference: ThemePreference) {
  const currentIndex = THEME_CYCLE_ORDER.indexOf(preference);
  return THEME_CYCLE_ORDER[(currentIndex + 1) % THEME_CYCLE_ORDER.length];
}

function getThemePreferenceLabel(preference: ThemePreference) {
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

function normalizeInterfaceScale(raw: unknown, initialValue: number) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return initialValue;
  }

  return clampInterfaceScale(raw);
}

function normalizeBellSchedulePopoutMode(
  raw: unknown,
  initialValue: BellSchedulePopoutMode
) {
  return raw === 'editor' || raw === 'summary' ? raw : initialValue;
}

function shiftInterfaceScale(scale: number, delta: number) {
  return clampInterfaceScale(scale + delta);
}

function clampInterfaceScale(scale: number) {
  return Math.round(clampNumber(scale, INTERFACE_SCALE_MIN, INTERFACE_SCALE_MAX) * 10) / 10;
}

function formatInterfaceScaleLabel(scale: number) {
  return `${Math.round(scale * 100)}%`;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(Math.floor(durationMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatBellTime(minutes: number) {
  const normalizedHours = Math.floor(minutes / 60);
  const hours = normalizedHours % 12 || 12;
  const mins = minutes % 60;

  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

function formatBellTimeRange(definition: Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>) {
  return `${formatBellTime(definition.startMinutes)}-${formatBellTime(definition.endMinutes)}`;
}

function getMinutesSinceMidnight(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function getTimestampForMinutes(baseDate: Date, minutes: number) {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  ).getTime();
}

function getBellScheduleDayKey(date: Date): BellScheduleDayKey | null {
  const weekday = date.getDay();

  if (weekday === 1) {
    return 'monday';
  }

  if (weekday === 2) {
    return 'tuesday';
  }

  if (weekday === 3) {
    return 'wednesday';
  }

  if (weekday === 4) {
    return 'thursday';
  }

  if (weekday === 5) {
    return 'friday';
  }

  return null;
}

function getDefaultBellScheduleSlotAssignment(): BellScheduleSlotAssignment {
  return {
    classListId: null,
    enabled: false
  };
}

function createBellScheduleDay(source?: BellScheduleDay): BellScheduleDay {
  const assignmentsBySlotId: Partial<Record<BellScheduleSlotId, BellScheduleSlotAssignment>> = {};

  BELL_SCHEDULE_SLOT_DEFINITIONS.forEach((slot) => {
    if (slot.kind !== 'teaching') {
      return;
    }

    assignmentsBySlotId[slot.id] = normalizeBellScheduleSlotAssignment(
      source?.assignmentsBySlotId[slot.id],
      getDefaultBellScheduleSlotAssignment()
    );
  });

  return {
    assignmentsBySlotId
  };
}

function createBellScheduleProfile({
  id = createBellScheduleProfileId(),
  name = 'Schedule Profile',
  source
}: {
  id?: string;
  name?: string;
  source?: BellScheduleProfile;
} = {}): BellScheduleProfile {
  const days = {} as Record<BellScheduleDayKey, BellScheduleDay>;

  BELL_SCHEDULE_DAY_KEYS.forEach((dayKey) => {
    days[dayKey] = createBellScheduleDay(source?.days[dayKey]);
  });

  return {
    days,
    id,
    name
  };
}

function createBellScheduleProfileId() {
  return `bell-schedule-profile-${createStickyNoteId()}`;
}

function createEmptyBellTimelineByDay() {
  return BELL_SCHEDULE_DAY_KEYS.reduce(
    (result, dayKey) => ({
      ...result,
      [dayKey]: []
    }),
    {} as Record<BellScheduleDayKey, BellTimelineEntry[]>
  );
}

function getBellScheduleProfileDisplayName(profile: Pick<BellScheduleProfile, 'name'>) {
  return profile.name.trim() || 'Untitled Profile';
}

function createBellScheduleProfileName(profiles: BellScheduleProfile[]) {
  const seenNames = new Set(
    profiles.map((profile) => getBellScheduleProfileDisplayName(profile).toLowerCase())
  );
  const baseName = 'Schedule Profile';

  if (!seenNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;

  while (seenNames.has(`${baseName} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }

  return `${baseName} ${suffix}`;
}

function selectBellScheduleProfile(snapshot: BellScheduleSnapshot, profileId: string) {
  if (!snapshot.profiles.some((profile) => profile.id === profileId)) {
    return snapshot;
  }

  return {
    ...snapshot,
    activeProfileId: profileId
  };
}

function addBellScheduleProfile(
  snapshot: BellScheduleSnapshot,
  sourceProfileId: string | null
) {
  const sourceProfile =
    snapshot.profiles.find((profile) => profile.id === sourceProfileId) ??
    snapshot.profiles[0] ??
    DEFAULT_BELL_SCHEDULE_PROFILE;
  const nextProfile = createBellScheduleProfile({
    id: createBellScheduleProfileId(),
    name: createBellScheduleProfileName(snapshot.profiles),
    source: sourceProfile
  });

  return {
    activeProfileId: nextProfile.id,
    profiles: [...snapshot.profiles, nextProfile]
  };
}

function removeBellScheduleProfile(snapshot: BellScheduleSnapshot, profileId: string) {
  if (snapshot.profiles.length <= 1) {
    return snapshot;
  }

  const nextProfiles = snapshot.profiles.filter((profile) => profile.id !== profileId);
  const nextActiveProfileId =
    snapshot.activeProfileId === profileId
      ? nextProfiles[0]?.id ?? null
      : snapshot.activeProfileId;

  return {
    activeProfileId: nextActiveProfileId,
    profiles: nextProfiles
  };
}

function renameBellScheduleProfile(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  name: string
) {
  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) =>
      profile.id === profileId
        ? {
            ...profile,
            name
          }
        : profile
    )
  };
}

function updateBellScheduleSlotAssignment(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  dayKey: BellScheduleDayKey,
  slotId: BellScheduleSlotId,
  updater: (assignment: BellScheduleSlotAssignment) => BellScheduleSlotAssignment
) {
  const slotDefinition = BELL_SCHEDULE_SLOT_DEFINITIONS.find((slot) => slot.id === slotId);

  if (!slotDefinition || slotDefinition.kind !== 'teaching') {
    return snapshot;
  }

  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const currentAssignment =
        profile.days[dayKey].assignmentsBySlotId[slotId] ?? getDefaultBellScheduleSlotAssignment();

      return {
        ...profile,
        days: {
          ...profile.days,
          [dayKey]: {
            assignmentsBySlotId: {
              ...profile.days[dayKey].assignmentsBySlotId,
              [slotId]: normalizeBellScheduleSlotAssignment(
                updater(currentAssignment),
                currentAssignment
              )
            }
          }
        }
      };
    })
  };
}

function buildBellTimelineEntries(
  profile: BellScheduleProfile,
  dayKey: BellScheduleDayKey,
  classLists: ClassList[]
) {
  const classListById = new Map(classLists.map((list) => [list.id, list] as const));

  return BELL_SCHEDULE_SLOT_DEFINITIONS.map((definition) => {
    const assignment =
      definition.kind === 'teaching'
        ? profile.days[dayKey].assignmentsBySlotId[definition.id] ??
          getDefaultBellScheduleSlotAssignment()
        : getDefaultBellScheduleSlotAssignment();
    const classList =
      assignment.classListId !== null ? classListById.get(assignment.classListId) ?? null : null;
    const status =
      definition.kind === 'break' ? 'break' : assignment.enabled ? 'teaching' : 'free';

    return {
      assignment,
      classList,
      dayKey,
      definition,
      status
    } satisfies BellTimelineEntry;
  });
}

function formatBellScheduleStatusLabel(entry: BellTimelineEntry | null) {
  if (!entry) {
    return '';
  }

  if (entry.status === 'break') {
    return 'Break';
  }

  if (entry.status === 'teaching') {
    return 'Teaching';
  }

  return 'Free';
}

function formatBellScheduleEntryDetail(entry: BellTimelineEntry) {
  if (entry.status === 'break') {
    return 'Break block';
  }

  if (entry.status === 'free') {
    return 'Free period';
  }

  return entry.classList?.name ?? 'Class not set';
}

function formatDateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${`${monthIndex + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

function parseDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const nextDate = new Date(year, monthIndex, day);

  if (
    Number.isNaN(nextDate.getTime()) ||
    nextDate.getFullYear() !== year ||
    nextDate.getMonth() !== monthIndex ||
    nextDate.getDate() !== day
  ) {
    return null;
  }

  return {
    day,
    monthIndex,
    year
  };
}

function normalizeDateKey(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  return formatDateKey(parsed.year, parsed.monthIndex, parsed.day);
}

function getTodayDateKey() {
  const today = new Date();
  return formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
}

function formatLongDate(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return dateKey;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date(parsed.year, parsed.monthIndex, parsed.day));
}

function getMonthKeyFromDateKey(dateKey: string) {
  const parsed = parseDateKey(dateKey) ?? parseDateKey(getTodayDateKey());
  if (!parsed) {
    return getTodayDateKey().slice(0, 7);
  }

  return `${parsed.year}-${`${parsed.monthIndex + 1}`.padStart(2, '0')}`;
}

function shiftMonthKey(monthKey: string, delta: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return getMonthKeyFromDateKey(getTodayDateKey());
  }

  const nextDate = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
  return `${nextDate.getFullYear()}-${`${nextDate.getMonth() + 1}`.padStart(2, '0')}`;
}

function formatMonthLabel(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric'
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

function buildCalendarDays(monthKey: string, selectedDate: string, entryDates: Set<string>) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return [] as Array<{
      dateKey: string;
      day: number;
      hasEntry: boolean;
      isCurrentMonth: boolean;
      isToday: boolean;
    }>;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const firstOfMonth = new Date(year, monthIndex, 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const firstVisibleDay = new Date(year, monthIndex, 1 - mondayOffset);
  const todayKey = getTodayDateKey();

  return Array.from({ length: 42 }, (_value, index) => {
    const dayDate = new Date(
      firstVisibleDay.getFullYear(),
      firstVisibleDay.getMonth(),
      firstVisibleDay.getDate() + index
    );
    const dateKey = formatDateKey(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());

    return {
      dateKey,
      day: dayDate.getDate(),
      hasEntry: entryDates.has(dateKey),
      isCurrentMonth: dayDate.getMonth() === monthIndex,
      isToday: dateKey === todayKey || dateKey === selectedDate && selectedDate === todayKey
    };
  });
}

function getPlannerSelectedDate(snapshot: PlannerSnapshot, listId: string | null) {
  return snapshot.activeDateByListId[getDashboardLayoutKey(listId)] ?? getTodayDateKey();
}

function getPlannerEntry(snapshot: PlannerSnapshot, listId: string | null, dateKey: string) {
  const normalizedDate = normalizeDateKey(dateKey);
  if (!normalizedDate) {
    return null;
  }

  return snapshot.entriesByListId[getDashboardLayoutKey(listId)]?.[normalizedDate] ?? null;
}

function setPlannerDateForList(snapshot: PlannerSnapshot, listId: string | null, dateKey: string) {
  const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();

  return {
    ...snapshot,
    activeDateByListId: {
      ...snapshot.activeDateByListId,
      [getDashboardLayoutKey(listId)]: normalizedDate
    }
  };
}

function updatePlannerEntry(
  snapshot: PlannerSnapshot,
  listId: string | null,
  dateKey: string,
  updater: (entry: LessonPlanEntry) => LessonPlanEntry
) {
  const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();
  const listKey = getDashboardLayoutKey(listId);
  const currentEntry = snapshot.entriesByListId[listKey]?.[normalizedDate] ?? {
    documents: [],
    plan: '',
    updatedAt: 0
  };
  const nextEntry = normalizeLessonPlanEntry(updater(currentEntry));
  const nextEntriesByListId = { ...snapshot.entriesByListId };
  const nextEntriesForList = { ...(nextEntriesByListId[listKey] ?? {}) };

  if (nextEntry) {
    nextEntriesForList[normalizedDate] = nextEntry;
  } else {
    delete nextEntriesForList[normalizedDate];
  }

  if (Object.keys(nextEntriesForList).length > 0) {
    nextEntriesByListId[listKey] = nextEntriesForList;
  } else {
    delete nextEntriesByListId[listKey];
  }

  return {
    ...setPlannerDateForList(snapshot, listId, normalizedDate),
    entriesByListId: nextEntriesByListId
  };
}

function normalizePlannerSnapshot(raw: unknown, initialValue: PlannerSnapshot) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    activeDateByListId?: Record<string, unknown>;
    entriesByListId?: Record<string, Record<string, unknown>>;
  };
  const activeDateByListId: Record<string, string> = {};
  const entriesByListId: Record<string, Record<string, LessonPlanEntry>> = {};

  if (nextRaw.activeDateByListId && typeof nextRaw.activeDateByListId === 'object') {
    for (const [listId, dateValue] of Object.entries(nextRaw.activeDateByListId)) {
      if (typeof dateValue !== 'string') {
        continue;
      }

      const normalizedDate = normalizeDateKey(dateValue);
      if (normalizedDate) {
        activeDateByListId[listId] = normalizedDate;
      }
    }
  }

  if (nextRaw.entriesByListId && typeof nextRaw.entriesByListId === 'object') {
    for (const [listId, entriesRaw] of Object.entries(nextRaw.entriesByListId)) {
      if (!entriesRaw || typeof entriesRaw !== 'object') {
        continue;
      }

      const nextEntriesForList: Record<string, LessonPlanEntry> = {};

      for (const [dateKey, entryRaw] of Object.entries(entriesRaw)) {
        const normalizedDate = normalizeDateKey(dateKey);
        const normalizedEntry = normalizeLessonPlanEntry(entryRaw);

        if (normalizedDate && normalizedEntry) {
          nextEntriesForList[normalizedDate] = normalizedEntry;
        }
      }

      if (Object.keys(nextEntriesForList).length > 0) {
        entriesByListId[listId] = nextEntriesForList;
      }
    }
  }

  return {
    activeDateByListId,
    entriesByListId
  };
}

function normalizeLessonPlanEntry(raw: unknown): LessonPlanEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    documents?: unknown[];
    plan?: unknown;
    updatedAt?: unknown;
  };
  const plan = typeof nextRaw.plan === 'string' ? nextRaw.plan : '';
  const documents = Array.isArray(nextRaw.documents)
    ? nextRaw.documents
        .map((document) => normalizePlannerDocument(document))
        .filter((document): document is PlannerDocument => document !== null)
    : [];
  const updatedAt =
    typeof nextRaw.updatedAt === 'number' && Number.isFinite(nextRaw.updatedAt)
      ? nextRaw.updatedAt
      : Date.now();

  if (!plan.trim() && documents.length === 0) {
    return null;
  }

  return {
    documents,
    plan,
    updatedAt
  };
}

function normalizePlannerDocument(raw: unknown): PlannerDocument | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    addedAt?: unknown;
    id?: unknown;
    name?: unknown;
    path?: unknown;
  };

  if (
    typeof nextRaw.id !== 'string' ||
    typeof nextRaw.name !== 'string' ||
    typeof nextRaw.path !== 'string'
  ) {
    return null;
  }

  const name = nextRaw.name.trim() || getFilenameFromPath(nextRaw.path);
  const filePath = nextRaw.path.trim();

  if (!name || !filePath) {
    return null;
  }

  return {
    addedAt:
      typeof nextRaw.addedAt === 'number' && Number.isFinite(nextRaw.addedAt)
        ? nextRaw.addedAt
        : Date.now(),
    id: nextRaw.id,
    name,
    path: filePath
  };
}

function mergeLessonDocuments(
  currentDocuments: PlannerDocument[],
  selections: LessonDocumentSelection[]
) {
  const nextDocuments = [...currentDocuments];
  const seenPaths = new Set(currentDocuments.map((document) => document.path));

  selections.forEach((selection) => {
    const filePath = selection.path.trim();
    if (!filePath || seenPaths.has(filePath)) {
      return;
    }

    seenPaths.add(filePath);
    nextDocuments.push({
      addedAt: Date.now(),
      id: createStickyNoteId(),
      name: selection.name.trim() || getFilenameFromPath(filePath),
      path: filePath
    });
  });

  return nextDocuments;
}

function getFilenameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function normalizeSeatingChartSnapshot(
  raw: unknown,
  initialValue: SeatingChartSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    chartsByListId?: Record<string, unknown>;
  };
  const chartsByListId: Record<string, SeatingChartClassState> = {};

  if (nextRaw.chartsByListId && typeof nextRaw.chartsByListId === 'object') {
    for (const [listId, chartRaw] of Object.entries(nextRaw.chartsByListId)) {
      chartsByListId[listId] = normalizeSeatingChartClassState(chartRaw);
    }
  }

  return {
    chartsByListId
  };
}

function normalizeSeatingChartClassState(raw: unknown): SeatingChartClassState {
  if (!raw || typeof raw !== 'object') {
    return {
      activeLayoutId: null,
      layouts: []
    };
  }

  const nextRaw = raw as {
    activeLayoutId?: unknown;
    layouts?: unknown[];
  };
  const layouts = Array.isArray(nextRaw.layouts)
    ? nextRaw.layouts
        .map((layout) => normalizeSeatingChartLayout(layout))
        .filter((layout): layout is SeatingChartLayout => layout !== null)
    : [];
  const activeLayoutId =
    typeof nextRaw.activeLayoutId === 'string' &&
    layouts.some((layout) => layout.id === nextRaw.activeLayoutId)
      ? nextRaw.activeLayoutId
      : layouts[0]?.id ?? null;

  return {
    activeLayoutId,
    layouts
  };
}

function normalizeSeatingChartLayout(raw: unknown): SeatingChartLayout | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    id?: unknown;
    items?: unknown[];
    name?: unknown;
    updatedAt?: unknown;
  };

  if (typeof nextRaw.id !== 'string' || !nextRaw.id.trim()) {
    return null;
  }

  const items = Array.isArray(nextRaw.items)
    ? normalizeSeatingChartItems(nextRaw.items)
    : [];

  return {
    id: nextRaw.id,
    items,
    name: typeof nextRaw.name === 'string' ? nextRaw.name : '',
    updatedAt:
      typeof nextRaw.updatedAt === 'number' && Number.isFinite(nextRaw.updatedAt)
        ? nextRaw.updatedAt
        : 0
  };
}

function normalizeSeatingChartItems(rawItems: unknown[]) {
  const items: SeatingChartLayoutItem[] = [];
  const occupiedCells = new Set<string>();

  rawItems.forEach((itemRaw) => {
    const item = normalizeSeatingChartItem(itemRaw);
    if (!item) {
      return;
    }

    const key = getSeatingChartCellKey(item.x, item.y);
    if (occupiedCells.has(key)) {
      return;
    }

    occupiedCells.add(key);
    items.push(item);
  });

  return sortSeatingChartItems(items);
}

function normalizeSeatingChartItem(raw: unknown): SeatingChartLayoutItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    assignedStudent?: unknown;
    color?: unknown;
    id?: unknown;
    kind?: unknown;
    label?: unknown;
    seatStyle?: unknown;
    x?: unknown;
    y?: unknown;
  };

  if (
    typeof nextRaw.id !== 'string' ||
    !isSeatingChartItemKind(nextRaw.kind) ||
    typeof nextRaw.x !== 'number' ||
    typeof nextRaw.y !== 'number'
  ) {
    return null;
  }

  const details = SEATING_CHART_ITEM_DETAILS[nextRaw.kind];

  return {
    assignedStudent:
      nextRaw.kind === 'seat' && typeof nextRaw.assignedStudent === 'string'
        ? nextRaw.assignedStudent
        : null,
    color: typeof nextRaw.color === 'string' && nextRaw.color.trim() ? nextRaw.color : details.defaultColor,
    id: nextRaw.id,
    kind: nextRaw.kind,
    label:
      typeof nextRaw.label === 'string' && nextRaw.label.trim()
        ? nextRaw.label
        : details.defaultLabel,
    seatStyle: isSeatingChartSeatStyle(nextRaw.seatStyle) ? nextRaw.seatStyle : 'desk',
    x: clampNumber(Math.round(nextRaw.x), 0, SEATING_CHART_GRID_COLUMNS - 1),
    y: clampNumber(Math.round(nextRaw.y), 0, SEATING_CHART_GRID_ROWS - 1)
  };
}

function getSeatingChartClassState(
  snapshot: SeatingChartSnapshot,
  listId: string,
  studentCount: number
) {
  const existing = snapshot.chartsByListId[listId];

  if (!existing || existing.layouts.length === 0) {
    return createDefaultSeatingChartClassState(studentCount);
  }

  return existing;
}

function updateSeatingChartForList(
  snapshot: SeatingChartSnapshot,
  listId: string,
  studentCount: number,
  updater: (classState: SeatingChartClassState) => SeatingChartClassState
) {
  const current = getSeatingChartClassState(snapshot, listId, studentCount);
  const next = normalizeSeatingChartClassState(updater(current));

  return {
    chartsByListId: {
      ...snapshot.chartsByListId,
      [listId]: next
    }
  };
}

function createDefaultSeatingChartClassState(studentCount: number): SeatingChartClassState {
  const layout = createDefaultSeatingChartLayout(studentCount);

  return {
    activeLayoutId: layout.id,
    layouts: [layout]
  };
}

function createDefaultSeatingChartLayout(studentCount: number): SeatingChartLayout {
  return {
    id: 'seating-layout-main',
    items: createDefaultSeatingChartItems(studentCount),
    name: 'Main layout',
    updatedAt: 0
  };
}

function createEmptySeatingChartClassStateFromCurrent(current: SeatingChartClassState) {
  const nextLayout = createEmptySeatingChartLayout(current.layouts);

  return {
    activeLayoutId: nextLayout.id,
    layouts: [...current.layouts, nextLayout]
  };
}

function createEmptySeatingChartLayout(existingLayouts: SeatingChartLayout[]) {
  return {
    id: createSeatingChartLayoutId(),
    items: createSeatingChartScaffoldItems(false),
    name: createSeatingChartLayoutName(existingLayouts, 'New layout'),
    updatedAt: Date.now()
  };
}

function duplicateActiveSeatingChartLayout(
  classState: SeatingChartClassState,
  studentCount: number
) {
  const activeLayout = getActiveSeatingChartLayout(classState, studentCount);
  const duplicatedLayout: SeatingChartLayout = {
    id: createSeatingChartLayoutId(),
    items: activeLayout.items.map((item) => ({
      ...item,
      id: createSeatingChartLayoutItemId()
    })),
    name: createSeatingChartLayoutName(classState.layouts, activeLayoutNameForSeatingChart(activeLayout)),
    updatedAt: Date.now()
  };

  return {
    activeLayoutId: duplicatedLayout.id,
    layouts: [...classState.layouts, duplicatedLayout]
  };
}

function selectSeatingChartLayout(classState: SeatingChartClassState, layoutId: string) {
  if (!classState.layouts.some((layout) => layout.id === layoutId)) {
    return classState;
  }

  return {
    ...classState,
    activeLayoutId: layoutId
  };
}

function renameSeatingChartLayout(
  classState: SeatingChartClassState,
  layoutId: string,
  name: string
) {
  return {
    ...classState,
    layouts: classState.layouts.map((layout) =>
      layout.id === layoutId
        ? {
            ...layout,
            name,
            updatedAt: Date.now()
          }
        : layout
    )
  };
}

function deleteSeatingChartLayout(classState: SeatingChartClassState, layoutId: string) {
  if (classState.layouts.length <= 1) {
    return classState;
  }

  const nextLayouts = classState.layouts.filter((layout) => layout.id !== layoutId);

  return {
    activeLayoutId:
      classState.activeLayoutId === layoutId ? nextLayouts[0]?.id ?? null : classState.activeLayoutId,
    layouts: nextLayouts
  };
}

function getActiveSeatingChartLayout(
  classState: SeatingChartClassState,
  studentCount: number
) {
  return (
    classState.layouts.find((layout) => layout.id === classState.activeLayoutId) ??
    classState.layouts[0] ??
    createDefaultSeatingChartLayout(studentCount)
  );
}

function activeLayoutNameForSeatingChart(layout: SeatingChartLayout | null) {
  return layout?.name.trim() || 'Main layout';
}

function createDefaultSeatingChartItems(studentCount: number) {
  const items = createSeatingChartScaffoldItems(true);
  const occupied = new Set(items.map((item) => getSeatingChartCellKey(item.x, item.y)));
  const seatTarget = Math.max(studentCount, SEATING_CHART_MIN_SEATS);
  const seatColumns = [1, 2, 4, 5, 7, 8, 10, 11];
  let seatNumber = 1;

  for (let y = 2; y < SEATING_CHART_GRID_ROWS; y += 1) {
    for (const x of seatColumns) {
      const key = getSeatingChartCellKey(x, y);

      if (occupied.has(key)) {
        continue;
      }

      items.push({
        assignedStudent: null,
        color: SEATING_CHART_ITEM_DETAILS.seat.defaultColor,
        id: `seating-default-seat-${seatNumber}`,
        kind: 'seat',
        label: String(seatNumber),
        seatStyle: 'desk',
        x,
        y
      });
      seatNumber += 1;

      if (seatNumber > seatTarget) {
        return items;
      }
    }
  }

  return items;
}

function createSeatingChartScaffoldItems(deterministic: boolean) {
  return [
    createSeatingChartLayoutItem('board', 5, 0, [], {
      id: deterministic ? 'seating-default-board' : undefined
    }),
    createSeatingChartLayoutItem('teacher-desk', 5, 1, [], {
      id: deterministic ? 'seating-default-teacher-desk' : undefined
    }),
    createSeatingChartLayoutItem('door', 11, 9, [], {
      id: deterministic ? 'seating-default-door' : undefined
    })
  ];
}

function createSeatingChartLayoutItem(
  kind: SeatingChartItemKind,
  x: number,
  y: number,
  items: SeatingChartLayoutItem[],
  options?: {
    id?: string;
  }
): SeatingChartLayoutItem {
  const details = SEATING_CHART_ITEM_DETAILS[kind];

  return {
    assignedStudent: null,
    color: details.defaultColor,
    id: options?.id ?? createSeatingChartLayoutItemId(),
    kind,
    label: kind === 'seat' ? String(getNextSeatLabelNumber(items)) : details.defaultLabel,
    seatStyle: 'desk',
    x,
    y
  };
}

function getNextSeatLabelNumber(items: SeatingChartLayoutItem[]) {
  const numericLabels = items
    .filter((item) => item.kind === 'seat')
    .map((item) => Number(item.label))
    .filter((value) => Number.isFinite(value));

  return (numericLabels.length ? Math.max(...numericLabels) : 0) + 1;
}

function getSeatingChartSeatItems(layout: SeatingChartLayout) {
  return layout.items
    .filter((item) => item.kind === 'seat')
    .sort((left, right) => (left.y - right.y) || (left.x - right.x));
}

function sanitizeSeatingChartLayout(layout: SeatingChartLayout, roster: string[]) {
  const rosterSet = new Set(roster);
  const occupied = new Set<string>();
  const items: SeatingChartLayoutItem[] = [];

  layout.items.forEach((item) => {
    const normalized = normalizeSeatingChartItem(item);
    if (!normalized) {
      return;
    }

    const key = getSeatingChartCellKey(normalized.x, normalized.y);
    if (occupied.has(key)) {
      return;
    }

    occupied.add(key);
    items.push({
      ...normalized,
      assignedStudent:
        normalized.kind === 'seat' && normalized.assignedStudent && rosterSet.has(normalized.assignedStudent)
          ? normalized.assignedStudent
          : null
    });
  });

  return {
    ...layout,
    items: sortSeatingChartItems(items)
  };
}

function sortSeatingChartItems(items: SeatingChartLayoutItem[]) {
  return [...items].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }

    if (left.x !== right.x) {
      return left.x - right.x;
    }

    return left.kind.localeCompare(right.kind);
  });
}

function getSeatingChartCellKey(x: number, y: number) {
  return `${x}:${y}`;
}

function getSeatingChartCellItem(items: SeatingChartLayoutItem[], x: number, y: number) {
  return items.find((item) => item.x === x && item.y === y) ?? null;
}

function readSeatingChartGridCoordinatesFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  const cellElement = target.closest<HTMLElement>('[data-grid-x][data-grid-y]');
  if (!cellElement) {
    return null;
  }

  const x = Number(cellElement.dataset.gridX);
  const y = Number(cellElement.dataset.gridY);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x,
    y
  };
}

function getSeatingChartGridCoordinatesFromPoint(
  gridElement: HTMLElement,
  clientX: number,
  clientY: number
) {
  const bounds = gridElement.getBoundingClientRect();
  const styles = window.getComputedStyle(gridElement);
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const columnGap = parseFloat(styles.columnGap || styles.gap) || 0;
  const rowGap = parseFloat(styles.rowGap || styles.gap) || 0;
  const usableWidth = bounds.width - paddingLeft - paddingRight;
  const usableHeight = bounds.height - paddingTop - paddingBottom;

  if (usableWidth <= 0 || usableHeight <= 0) {
    return null;
  }

  const cellWidth =
    (usableWidth - columnGap * (SEATING_CHART_GRID_COLUMNS - 1)) / SEATING_CHART_GRID_COLUMNS;
  const cellHeight =
    (usableHeight - rowGap * (SEATING_CHART_GRID_ROWS - 1)) / SEATING_CHART_GRID_ROWS;

  if (cellWidth <= 0 || cellHeight <= 0) {
    return null;
  }

  const relativeX = clampNumber(clientX - bounds.left - paddingLeft, 0, usableWidth - 1);
  const relativeY = clampNumber(clientY - bounds.top - paddingTop, 0, usableHeight - 1);
  const x = clampNumber(
    Math.floor(relativeX / (cellWidth + columnGap)),
    0,
    SEATING_CHART_GRID_COLUMNS - 1
  );
  const y = clampNumber(
    Math.floor(relativeY / (cellHeight + rowGap)),
    0,
    SEATING_CHART_GRID_ROWS - 1
  );

  return {
    x,
    y
  };
}

function resolveSeatingChartGridCell(
  gridElement: HTMLDivElement | null,
  target: EventTarget | null,
  clientX: number,
  clientY: number
) {
  const targetCell = readSeatingChartGridCoordinatesFromTarget(target);
  if (targetCell) {
    return targetCell;
  }

  if (!gridElement) {
    return null;
  }

  return getSeatingChartGridCoordinatesFromPoint(gridElement, clientX, clientY);
}

function setSeatingChartItemAtPosition(
  layout: SeatingChartLayout,
  kind: SeatingChartItemKind,
  x: number,
  y: number
) {
  const existingItem = getSeatingChartCellItem(layout.items, x, y);

  if (existingItem) {
    return {
      ...layout,
      items: sortSeatingChartItems(
        layout.items.map((item) =>
          item.id === existingItem.id ? resetSeatingChartItemKind(item, kind, layout.items) : item
        )
      ),
      updatedAt: Date.now()
    };
  }

  return {
    ...layout,
    items: sortSeatingChartItems([...layout.items, createSeatingChartLayoutItem(kind, x, y, layout.items)]),
    updatedAt: Date.now()
  };
}

function resetSeatingChartItemKind(
  item: SeatingChartLayoutItem,
  kind: SeatingChartItemKind,
  items: SeatingChartLayoutItem[]
): SeatingChartLayoutItem {
  if (item.kind === kind) {
    return item;
  }

  const details = SEATING_CHART_ITEM_DETAILS[kind];

  return {
    ...item,
    assignedStudent: null,
    color: details.defaultColor,
    kind,
    label: kind === 'seat' ? String(getNextSeatLabelNumber(items.filter((entry) => entry.id !== item.id))) : details.defaultLabel,
    seatStyle: 'desk'
  };
}

function moveSeatingChartLayoutItem(
  layout: SeatingChartLayout,
  itemId: string,
  x: number,
  y: number
) {
  const nextX = clampNumber(Math.round(x), 0, SEATING_CHART_GRID_COLUMNS - 1);
  const nextY = clampNumber(Math.round(y), 0, SEATING_CHART_GRID_ROWS - 1);
  const movingItem = layout.items.find((item) => item.id === itemId);

  if (!movingItem || (movingItem.x === nextX && movingItem.y === nextY)) {
    return layout;
  }

  const targetItem = getSeatingChartCellItem(layout.items, nextX, nextY);

  return {
    ...layout,
    items: sortSeatingChartItems(
      layout.items.map((item) => {
        if (item.id === itemId) {
          return {
            ...item,
            x: nextX,
            y: nextY
          };
        }

        if (targetItem && item.id === targetItem.id) {
          return {
            ...item,
            x: movingItem.x,
            y: movingItem.y
          };
        }

        return item;
      })
    ),
    updatedAt: Date.now()
  };
}

function updateSeatingChartLayoutItem(
  layout: SeatingChartLayout,
  itemId: string,
  updater: (item: SeatingChartLayoutItem) => SeatingChartLayoutItem
) {
  return {
    ...layout,
    items: sortSeatingChartItems(
      layout.items.map((item) =>
        item.id === itemId ? normalizeSeatingChartItem(updater(item)) ?? item : item
      )
    ),
    updatedAt: Date.now()
  };
}

function removeSeatingChartLayoutItem(layout: SeatingChartLayout, itemId: string) {
  return {
    ...layout,
    items: layout.items.filter((item) => item.id !== itemId),
    updatedAt: Date.now()
  };
}

function clearSeatingChartLayoutAssignments(layout: SeatingChartLayout) {
  return {
    ...layout,
    items: layout.items.map((item) =>
      item.kind === 'seat'
        ? {
            ...item,
            assignedStudent: null
          }
        : item
    ),
    updatedAt: Date.now()
  };
}

function clearSeatingChartSeatAssignment(layout: SeatingChartLayout, seatId: string) {
  return {
    ...layout,
    items: layout.items.map((item) =>
      item.id === seatId && item.kind === 'seat'
        ? {
            ...item,
            assignedStudent: null
          }
        : item
    ),
    updatedAt: Date.now()
  };
}

function assignStudentToSeatInLayout(
  layout: SeatingChartLayout,
  studentName: string,
  targetSeatId: string,
  sourceSeatId: string | null
) {
  const targetSeat = layout.items.find((item) => item.id === targetSeatId && item.kind === 'seat');

  if (!targetSeat) {
    return layout;
  }

  const targetOccupant = targetSeat.assignedStudent;

  return {
    ...layout,
    items: layout.items.map((item) => {
      if (item.kind !== 'seat') {
        return item;
      }

      if (item.id === targetSeatId) {
        return {
          ...item,
          assignedStudent: studentName
        };
      }

      if (sourceSeatId && item.id === sourceSeatId) {
        return {
          ...item,
          assignedStudent: sourceSeatId === targetSeatId ? studentName : targetOccupant ?? null
        };
      }

      if (item.assignedStudent === studentName) {
        return {
          ...item,
          assignedStudent: null
        };
      }

      return item;
    }),
    updatedAt: Date.now()
  };
}

function autofillSeatingChartLayout(layout: SeatingChartLayout, students: string[]) {
  return applySeatingChartAssignments(layout, students);
}

function reshuffleSeatingChartLayout(layout: SeatingChartLayout, students: string[]) {
  return applySeatingChartAssignments(layout, shuffleNames(students));
}

function applySeatingChartAssignments(layout: SeatingChartLayout, students: string[]) {
  const seats = getSeatingChartSeatItems(layout);
  const assignments = new Map<string, string | null>();

  seats.forEach((seat, index) => {
    assignments.set(seat.id, students[index] ?? null);
  });

  return {
    ...layout,
    items: layout.items.map((item) =>
      item.kind === 'seat'
        ? {
            ...item,
            assignedStudent: assignments.get(item.id) ?? null
          }
        : item
    ),
    updatedAt: Date.now()
  };
}

function buildSeatingChartItemTitle(item: SeatingChartLayoutItem) {
  if (item.kind !== 'seat') {
    return `${SEATING_CHART_ITEM_DETAILS[item.kind].title}: ${item.label}`;
  }

  return item.assignedStudent ? item.assignedStudent : 'Empty seat';
}

function getSeatingChartPreviewToken(item: SeatingChartLayoutItem) {
  if (item.kind === 'seat') {
    return item.assignedStudent ? formatStudentInitials(item.assignedStudent) : '';
  }

  if (item.kind === 'teacher-desk') {
    return 'T';
  }

  if (item.kind === 'board') {
    return 'B';
  }

  if (item.kind === 'door') {
    return 'D';
  }

  return 'S';
}

function getSeatingChartPreviewTooltip(item: SeatingChartLayoutItem) {
  if (item.kind === 'seat') {
    return buildSeatingChartItemTitle(item);
  }

  return SEATING_CHART_ITEM_DETAILS[item.kind].title;
}

function getSeatingChartToolToneClass(tool: 'select' | SeatingChartItemKind | 'erase') {
  if (tool === 'seat') {
    return 'button-tone--action';
  }

  if (tool === 'erase') {
    return 'button-tone--warning';
  }

  if (tool === 'select') {
    return 'button-tone--selection';
  }

  if (tool === 'door') {
    return 'button-tone--warning';
  }

  if (tool === 'board') {
    return 'button-tone--theme';
  }

  return 'button-tone--utility';
}

function formatStudentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function writeSeatingChartDragPayload(
  dataTransfer: DataTransfer,
  payload: SeatingChartDragPayload
) {
  const serializedPayload = JSON.stringify(payload);
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(SEATING_CHART_DRAG_MIME, serializedPayload);
  dataTransfer.setData('text/plain', serializedPayload);
}

function readSeatingChartDragPayload(dataTransfer: DataTransfer) {
  try {
    const raw =
      dataTransfer.getData(SEATING_CHART_DRAG_MIME) ||
      dataTransfer.getData('text/plain');
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SeatingChartDragPayload>;

    if (parsed.type === 'item' && typeof parsed.itemId === 'string') {
      return {
        itemId: parsed.itemId,
        type: 'item'
      } satisfies SeatingChartDragPayload;
    }

    if (
      parsed.type === 'student' &&
      typeof parsed.studentName === 'string' &&
      (typeof parsed.sourceSeatId === 'string' || parsed.sourceSeatId === null)
    ) {
      return {
        sourceSeatId: parsed.sourceSeatId,
        studentName: parsed.studentName,
        type: 'student'
      } satisfies SeatingChartDragPayload;
    }
  } catch {
    // Ignore invalid drag payloads.
  }

  return null;
}

function hasSeatingChartDragPayload(dataTransfer: DataTransfer) {
  if (Array.from(dataTransfer.types).includes(SEATING_CHART_DRAG_MIME)) {
    return true;
  }

  return readSeatingChartDragPayload(dataTransfer) !== null;
}

function createSeatingChartLayoutName(
  existingLayouts: SeatingChartLayout[],
  baseName: string
) {
  const seenNames = new Set(existingLayouts.map((layout) => activeLayoutNameForSeatingChart(layout).toLowerCase()));
  const normalizedBase = baseName.trim() || 'Layout';

  if (!seenNames.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let suffix = 2;

  while (seenNames.has(`${normalizedBase} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }

  return `${normalizedBase} ${suffix}`;
}

function createSeatingChartLayoutId() {
  return `seating-layout-${createStickyNoteId()}`;
}

function createSeatingChartLayoutItemId() {
  return `seating-item-${createStickyNoteId()}`;
}

function isSeatingChartItemKind(value: unknown): value is SeatingChartItemKind {
  return (
    value === 'seat' ||
    value === 'teacher-desk' ||
    value === 'board' ||
    value === 'door' ||
    value === 'storage'
  );
}

function isSeatingChartSeatStyle(value: unknown): value is SeatingChartSeatStyle {
  return value === 'desk' || value === 'round';
}

function normalizeBellScheduleSnapshot(
  raw: unknown,
  initialValue: BellScheduleSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    activeProfileId?: unknown;
    profiles?: unknown[];
  };
  const profiles = Array.isArray(nextRaw.profiles)
    ? nextRaw.profiles
        .map((profile) => normalizeBellScheduleProfile(profile))
        .filter((profile): profile is BellScheduleProfile => profile !== null)
    : [];
  const nextProfiles = profiles.length > 0 ? profiles : initialValue.profiles;
  const activeProfileId =
    typeof nextRaw.activeProfileId === 'string' &&
    nextProfiles.some((profile) => profile.id === nextRaw.activeProfileId)
      ? nextRaw.activeProfileId
      : nextProfiles[0]?.id ?? null;

  return {
    activeProfileId,
    profiles: nextProfiles
  };
}

function normalizeBellScheduleProfile(raw: unknown): BellScheduleProfile | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    days?: Record<string, unknown>;
    id?: unknown;
    name?: unknown;
  };

  if (typeof nextRaw.id !== 'string' || !nextRaw.id.trim()) {
    return null;
  }

  const days = {} as Record<BellScheduleDayKey, BellScheduleDay>;

  BELL_SCHEDULE_DAY_KEYS.forEach((dayKey) => {
    days[dayKey] = normalizeBellScheduleDay(nextRaw.days?.[dayKey]);
  });

  return {
    days,
    id: nextRaw.id,
    name: typeof nextRaw.name === 'string' ? nextRaw.name : ''
  };
}

function normalizeBellScheduleDay(raw: unknown): BellScheduleDay {
  const nextRaw = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const assignmentsRaw =
    nextRaw.assignmentsBySlotId && typeof nextRaw.assignmentsBySlotId === 'object'
      ? (nextRaw.assignmentsBySlotId as Record<string, unknown>)
      : {};
  const assignmentsBySlotId: Partial<Record<BellScheduleSlotId, BellScheduleSlotAssignment>> = {};

  BELL_SCHEDULE_SLOT_DEFINITIONS.forEach((slot) => {
    if (slot.kind !== 'teaching') {
      return;
    }

    assignmentsBySlotId[slot.id] = normalizeBellScheduleSlotAssignment(
      assignmentsRaw[slot.id] ?? nextRaw[slot.id],
      getDefaultBellScheduleSlotAssignment()
    );
  });

  return {
    assignmentsBySlotId
  };
}

function normalizeBellScheduleSlotAssignment(
  raw: unknown,
  initialValue = getDefaultBellScheduleSlotAssignment()
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    classListId?: unknown;
    enabled?: unknown;
  };

  return {
    classListId: typeof nextRaw.classListId === 'string' ? nextRaw.classListId : null,
    enabled: typeof nextRaw.enabled === 'boolean' ? nextRaw.enabled : initialValue.enabled
  };
}

function normalizePickerSnapshot(raw: unknown, initialValue: PickerSnapshot) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    currentPick?: unknown;
    lists?: unknown[];
    pool?: unknown;
    recentPicks?: unknown[];
    removePickedStudents?: unknown;
    selectedListId?: unknown;
  };

  if (Array.isArray(nextRaw.lists)) {
    const normalizedLists = nextRaw.lists
      .map((list) => normalizeClassList(list))
      .filter((list): list is ClassList => list !== null);
    const allowEmptyLists = nextRaw.lists.length === 0;
    const fallbackLists =
      normalizedLists.length > 0 || allowEmptyLists ? normalizedLists : initialValue.lists;
    const selectedListId =
      typeof nextRaw.selectedListId === 'string' &&
      fallbackLists.some((list) => list.id === nextRaw.selectedListId)
        ? nextRaw.selectedListId
        : fallbackLists[0]?.id ?? null;
    const selectedList = fallbackLists.find((list) => list.id === selectedListId) ?? null;
    const poolSource = Array.isArray(nextRaw.pool) ? nextRaw.pool.filter(isString) : [];
    const currentPick =
      typeof nextRaw.currentPick === 'string' && selectedList?.students.includes(nextRaw.currentPick)
        ? nextRaw.currentPick
        : null;
    const recentPicks = Array.isArray(nextRaw.recentPicks)
      ? nextRaw.recentPicks
          .filter(isString)
          .filter((name: string) => selectedList?.students.includes(name))
      : [];

    return {
      lists: fallbackLists,
      selectedListId,
      pool: selectedList ? syncPoolWithRoster(selectedList.students, poolSource) : [],
      currentPick,
      recentPicks,
      removePickedStudents:
        typeof nextRaw.removePickedStudents === 'boolean'
          ? nextRaw.removePickedStudents
          : initialValue.removePickedStudents
    };
  }

  const legacy = raw as LegacyPickerSnapshot;
  const legacyStudents = Array.isArray(legacy.roster) ? dedupeNames(legacy.roster.filter(isString)) : [];
  const fallbackStudents = legacyStudents.length ? legacyStudents : DEFAULT_CLASS_LIST.students;
  const fallbackList: ClassList = {
    id: DEFAULT_CLASS_LIST.id,
    name: DEFAULT_CLASS_LIST.name,
    students: fallbackStudents
  };

  return {
    lists: [fallbackList],
    selectedListId: fallbackList.id,
    pool: syncPoolWithRoster(
      fallbackStudents,
      Array.isArray(legacy.pool) ? legacy.pool.filter(isString) : []
    ),
    currentPick:
      typeof legacy.currentPick === 'string' && fallbackStudents.includes(legacy.currentPick)
        ? legacy.currentPick
        : null,
    recentPicks: Array.isArray(legacy.recentPicks)
      ? legacy.recentPicks.filter(isString).filter((name) => fallbackStudents.includes(name))
      : [],
    removePickedStudents: initialValue.removePickedStudents
  };
}

function normalizeGroupMakerSnapshot(raw: unknown, initialValue: GroupMakerSnapshot) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    groupSize?: unknown;
    groups?: unknown[];
    listId?: unknown;
    sourceStudents?: unknown[];
  };

  return {
    groupSize:
      typeof nextRaw.groupSize === 'number' && Number.isFinite(nextRaw.groupSize)
        ? clampNumber(Math.round(nextRaw.groupSize), GROUP_SIZE_MIN, GROUP_SIZE_MAX)
        : initialValue.groupSize,
    groups: Array.isArray(nextRaw.groups)
      ? nextRaw.groups
          .map((group) =>
            Array.isArray(group) ? dedupeNames(group.filter(isString)).filter(Boolean) : []
          )
          .filter((group) => group.length > 0)
      : initialValue.groups,
    listId: typeof nextRaw.listId === 'string' ? nextRaw.listId : null,
    sourceStudents: Array.isArray(nextRaw.sourceStudents)
      ? dedupeNames(nextRaw.sourceStudents.filter(isString))
      : initialValue.sourceStudents
  };
}

function normalizeDashboardLayoutsSnapshot(
  raw: unknown,
  initialValue: DashboardLayoutsSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    layoutsByListId?: Record<string, unknown>;
  };

  if (!nextRaw.layoutsByListId || typeof nextRaw.layoutsByListId !== 'object') {
    return initialValue;
  }

  const layoutsByListId: Record<string, WidgetLayout> = {};

  for (const [listId, layoutRaw] of Object.entries(nextRaw.layoutsByListId)) {
    layoutsByListId[listId] = normalizeWidgetLayout(layoutRaw);
  }

  return {
    layoutsByListId
  };
}

function normalizeWidgetLayout(raw: unknown): WidgetLayout {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_WIDGET_LAYOUT;
  }

  const nextRaw = raw as {
    collapsed?: unknown[];
    hidden?: unknown[];
    order?: unknown[];
  };

  return {
    order: normalizeWidgetOrder(Array.isArray(nextRaw.order) ? nextRaw.order.filter(isString) : []),
    hidden: normalizeWidgetIdCollection(Array.isArray(nextRaw.hidden) ? nextRaw.hidden.filter(isString) : []),
    collapsed: normalizeWidgetIdCollection(
      Array.isArray(nextRaw.collapsed) ? nextRaw.collapsed.filter(isString) : []
    )
  };
}

function normalizeWidgetOrder(widgetIds: string[]) {
  const seen = new Set<WidgetId>();
  const result: WidgetId[] = [];

  for (const widgetId of widgetIds) {
    if (!isWidgetId(widgetId) || seen.has(widgetId)) {
      continue;
    }

    seen.add(widgetId);
    result.push(widgetId);
  }

  for (const widgetId of WIDGET_IDS) {
    if (!seen.has(widgetId)) {
      result.push(widgetId);
    }
  }

  return result;
}

function normalizeWidgetIdCollection(widgetIds: string[]) {
  const seen = new Set<WidgetId>();
  const result: WidgetId[] = [];

  for (const widgetId of widgetIds) {
    if (!isWidgetId(widgetId) || seen.has(widgetId)) {
      continue;
    }

    seen.add(widgetId);
    result.push(widgetId);
  }

  return result;
}

function getDashboardLayoutKey(listId: string | null) {
  return listId ?? LAYOUT_FALLBACK_KEY;
}

function getWidgetLayoutForList(snapshot: DashboardLayoutsSnapshot, listId: string | null) {
  const key = getDashboardLayoutKey(listId);
  return snapshot.layoutsByListId[key] ?? DEFAULT_WIDGET_LAYOUT;
}

function updateWidgetLayoutForList(
  snapshot: DashboardLayoutsSnapshot,
  listId: string | null,
  updater: (layout: WidgetLayout) => WidgetLayout
) {
  const key = getDashboardLayoutKey(listId);
  const currentLayout = getWidgetLayoutForList(snapshot, listId);

  return {
    layoutsByListId: {
      ...snapshot.layoutsByListId,
      [key]: normalizeWidgetLayout(updater(currentLayout))
    }
  };
}

function reorderWidgetIds(order: WidgetId[], fromId: WidgetId, toId: WidgetId) {
  const normalizedOrder = normalizeWidgetOrder(order);
  const fromIndex = normalizedOrder.indexOf(fromId);
  const toIndex = normalizedOrder.indexOf(toId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return normalizedOrder;
  }

  const nextOrder = [...normalizedOrder];
  const [movedWidget] = nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, movedWidget);
  return nextOrder;
}

function toggleWidgetIdInList(widgetIds: WidgetId[], widgetId: WidgetId) {
  return widgetIds.includes(widgetId)
    ? widgetIds.filter((entry) => entry !== widgetId)
    : normalizeWidgetIdCollection([...widgetIds, widgetId]);
}

function getWidgetWidthCategory(widgetId: WidgetId): WidgetWidthCategory {
  return WIDGET_DETAILS[widgetId].width;
}

function getWidgetColumnSpan(widgetId: WidgetId, columnCount: number): 1 | 2 {
  return getWidgetWidthCategory(widgetId) === 'double' && columnCount > 1 ? 2 : 1;
}

function computeDashboardMetrics(containerWidth: number): DashboardMetrics {
  const safeWidth = Math.max(containerWidth, MIN_POPOVER_WIDTH);
  const maxColumnCount = Math.max(
    1,
    Math.floor((safeWidth + DASHBOARD_COLUMN_GAP) / (DASHBOARD_SINGLE_MIN_WIDTH + DASHBOARD_COLUMN_GAP))
  );
  const targetColumnCount = Math.max(
    1,
    Math.ceil((safeWidth + DASHBOARD_COLUMN_GAP) / (DASHBOARD_SINGLE_MAX_WIDTH + DASHBOARD_COLUMN_GAP))
  );
  const columnCount = clampNumber(targetColumnCount, 1, maxColumnCount);
  const laneWidth = Math.max(
    DASHBOARD_SINGLE_MIN_WIDTH,
    Math.floor((safeWidth - DASHBOARD_COLUMN_GAP * Math.max(columnCount - 1, 0)) / columnCount)
  );

  return {
    columnCount,
    gap: DASHBOARD_COLUMN_GAP,
    laneWidth: Math.min(laneWidth, DASHBOARD_SINGLE_MAX_WIDTH)
  };
}

function buildDashboardColumns({
  columnCount,
  widgetHeights,
  widgetIds
}: {
  columnCount: number;
  widgetHeights: Partial<Record<WidgetId, number>>;
  widgetIds: WidgetId[];
}) {
  if (widgetIds.length === 0) {
    return [];
  }

  const normalizedColumnCount = Math.max(1, columnCount);
  const columnSpans = getDashboardColumnSpans({
    hasDoubleWidgets: widgetIds.some((widgetId) => getWidgetWidthCategory(widgetId) === 'double'),
    laneCount: normalizedColumnCount
  });
  const widgets = widgetIds.map((widgetId) => ({
    id: widgetId,
    estimatedHeight: widgetHeights[widgetId] ?? WIDGET_ESTIMATED_HEIGHTS[widgetId],
    span: getWidgetColumnSpan(widgetId, normalizedColumnCount)
  }));
  const columns: Array<
    DashboardColumn & {
      estimatedHeight: number;
    }
  > = columnSpans.map((span) => ({
    span,
    widgetIds: [],
    estimatedHeight: 0
  }));

  const pickShortestColumn = (availableColumns: typeof columns) => {
    return availableColumns.reduce((shortestColumn, column) =>
      column.estimatedHeight < shortestColumn.estimatedHeight ? column : shortestColumn
    );
  };

  for (const widget of widgets) {
    const exactColumns = columns.filter((column) => column.span === widget.span);
    const compatibleColumns = columns.filter((column) => column.span >= widget.span);
    const targetColumn = pickShortestColumn(
      exactColumns.length > 0 ? exactColumns : compatibleColumns.length > 0 ? compatibleColumns : columns
    );

    targetColumn.widgetIds.push(widget.id);
    targetColumn.estimatedHeight += widget.estimatedHeight + DASHBOARD_COLUMN_GAP;
  }

  return columns.map(({ estimatedHeight: _estimatedHeight, ...column }) => column);
}

function getDashboardColumnSpans({
  hasDoubleWidgets,
  laneCount
}: {
  hasDoubleWidgets: boolean;
  laneCount: number;
}) {
  if (laneCount <= 1) {
    return [1 as const];
  }

  if (!hasDoubleWidgets) {
    return Array.from({ length: laneCount }, () => 1 as const);
  }

  if (laneCount === 2) {
    return [1 as const, 1 as const];
  }

  return [...Array.from({ length: laneCount - 2 }, () => 1 as const), 2 as const];
}

function mergeMeasuredWidgetHeights(
  current: Partial<Record<WidgetId, number>>,
  next: Partial<Record<WidgetId, number>>,
  visibleWidgetIds: WidgetId[]
) {
  const merged: Partial<Record<WidgetId, number>> = {};
  let changed = false;

  for (const widgetId of visibleWidgetIds) {
    const nextHeight = next[widgetId] ?? current[widgetId];

    if (typeof nextHeight !== 'number') {
      continue;
    }

    merged[widgetId] = nextHeight;

    if (current[widgetId] !== nextHeight) {
      changed = true;
    }
  }

  if (Object.keys(current).length !== Object.keys(merged).length) {
    changed = true;
  }

  return changed ? merged : current;
}

function normalizeClassList(raw: unknown): ClassList | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    id?: unknown;
    name?: unknown;
    students?: unknown[];
  };

  if (
    typeof nextRaw.id !== 'string' ||
    typeof nextRaw.name !== 'string' ||
    !Array.isArray(nextRaw.students)
  ) {
    return null;
  }

  const students = dedupeNames(nextRaw.students.filter(isString));
  if (!nextRaw.name.trim()) {
    return null;
  }

  return {
    id: nextRaw.id,
    name: nextRaw.name.trim(),
    students
  };
}

function activateClassList(snapshot: PickerSnapshot, listId: string) {
  const nextList = snapshot.lists.find((list) => list.id === listId);
  if (!nextList) {
    return snapshot;
  }

  const isSameList = snapshot.selectedListId === listId;

  return {
    ...snapshot,
    selectedListId: listId,
    pool: syncPoolWithRoster(nextList.students, isSameList ? snapshot.pool : []),
    currentPick:
      isSameList && snapshot.currentPick && nextList.students.includes(snapshot.currentPick)
        ? snapshot.currentPick
        : null,
    recentPicks: isSameList
      ? snapshot.recentPicks.filter((name) => nextList.students.includes(name))
      : []
  };
}

function upsertClassList(
  snapshot: PickerSnapshot,
  entry: {
    listId: string;
    name: string;
    students: string[];
  }
) {
  const nextList: ClassList = {
    id: entry.listId,
    name: entry.name.trim(),
    students: dedupeNames(entry.students)
  };
  const existingIndex = snapshot.lists.findIndex((list) => list.id === entry.listId);
  const nextLists =
    existingIndex >= 0
      ? snapshot.lists.map((list) => (list.id === entry.listId ? nextList : list))
      : [nextList, ...snapshot.lists];

  return {
    lists: nextLists,
    selectedListId: nextList.id,
    pool: [...nextList.students],
    currentPick: null,
    recentPicks: [],
    removePickedStudents: snapshot.removePickedStudents
  };
}

function removeClassListFromPicker(snapshot: PickerSnapshot, listId: string) {
  const nextLists = snapshot.lists.filter((list) => list.id !== listId);
  if (nextLists.length === 0) {
    return {
      lists: [],
      selectedListId: null,
      pool: [],
      currentPick: null,
      recentPicks: [],
      removePickedStudents: snapshot.removePickedStudents
    };
  }

  if (snapshot.selectedListId && snapshot.selectedListId !== listId) {
    const selectedList = nextLists.find((list) => list.id === snapshot.selectedListId);
    if (selectedList) {
      return {
        ...snapshot,
        lists: nextLists,
        pool: syncPoolWithRoster(selectedList.students, snapshot.pool),
        currentPick:
          snapshot.currentPick && selectedList.students.includes(snapshot.currentPick)
            ? snapshot.currentPick
            : null,
        recentPicks: snapshot.recentPicks.filter((name) => selectedList.students.includes(name))
      };
    }
  }

  const fallbackList = nextLists[0];
  return {
    lists: nextLists,
    selectedListId: fallbackList.id,
    pool: [...fallbackList.students],
    currentPick: null,
    recentPicks: [],
    removePickedStudents: snapshot.removePickedStudents
  };
}

function createPredictableListId(name: string, existingIds: string[]) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug ? `class-list-${slug}` : createClassListId();
  let candidate = base;
  let suffix = 2;

  while (existingIds.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function buildPickerSpinnerNames({
  currentPick,
  isSpinning,
  names,
  spinnerIndex
}: {
  currentPick: string | null;
  isSpinning: boolean;
  names: string[];
  spinnerIndex: number;
}) {
  const centerIndex = Math.floor(PICKER_SPINNER_WINDOW_SIZE / 2);

  if (!names.length) {
    return Array.from({ length: PICKER_SPINNER_WINDOW_SIZE }, (_value, index) =>
      index === centerIndex ? 'No list selected' : ''
    );
  }

  if (!isSpinning) {
    return Array.from({ length: PICKER_SPINNER_WINDOW_SIZE }, (_value, index) =>
      index === centerIndex ? currentPick ?? 'Press Pick' : ''
    );
  }

  return Array.from({ length: PICKER_SPINNER_WINDOW_SIZE }, (_value, index) => {
    const offset = index - centerIndex;
    const normalizedIndex =
      ((spinnerIndex + offset) % names.length + names.length) % names.length;
    return names[normalizedIndex];
  });
}

function dedupeNames(names: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(name);
  }

  return result;
}

function haveSameStudents(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right.map((name) => name.toLowerCase()));
  return left.every((name) => rightSet.has(name.toLowerCase()));
}

function buildStudentGroups(students: string[], preferredSize: number) {
  if (students.length === 0) {
    return [];
  }

  const shuffledStudents = shuffleNames(students);
  const clampedSize = clampNumber(preferredSize, GROUP_SIZE_MIN, GROUP_SIZE_MAX);

  if (shuffledStudents.length <= clampedSize) {
    return [shuffledStudents];
  }

  let groupCount = Math.ceil(shuffledStudents.length / clampedSize);

  if (shuffledStudents.length % clampedSize === 1 && groupCount > 1) {
    groupCount -= 1;
  }

  const groups = Array.from({ length: groupCount }, () => [] as string[]);

  shuffledStudents.forEach((student, index) => {
    groups[index % groupCount].push(student);
  });

  return groups;
}

function shuffleNames(names: string[]) {
  const nextNames = [...names];

  for (let index = nextNames.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextNames[index], nextNames[swapIndex]] = [nextNames[swapIndex], nextNames[index]];
  }

  return nextNames;
}

function syncPoolWithRoster(roster: string[], pool: string[]) {
  const nextPool = pool.filter((name) => roster.includes(name));
  return nextPool.length ? nextPool : [...roster];
}

function getPickerSelectionPool(roster: string[], pool: string[], removePickedStudents: boolean) {
  return removePickedStudents ? syncPoolWithRoster(roster, pool) : [...roster];
}

function getPickerRemainingPool(
  roster: string[],
  currentPool: string[],
  pickedName: string,
  removePickedStudents: boolean
) {
  return removePickedStudents ? currentPool.filter((entry) => entry !== pickedName) : [...roster];
}

function isWidgetId(value: string): value is WidgetId {
  return WIDGET_IDS.includes(value as WidgetId);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function createClassListId() {
  return `class-list-${createStickyNoteId()}`;
}

function createStickyNoteId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default App;
