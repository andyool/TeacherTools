import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { CSSProperties, Ref, RefObject } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  AppUpdateState,
  DesktopWindowContext,
  LessonDocumentSelection,
  WidgetPopoutId,
  WindowBounds
} from './electron-types';
import { buildQrSvgPath, QrCode } from './qrcode';

type TimerSnapshot = {
  baseDurationMs: number;
  endsAt: number | null;
  lastCompletionAcknowledgedAt: number | null;
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

type PickerSpinnerView = {
  items: Array<{
    isActive: boolean;
    isAdjacent: boolean;
    key: string;
    name: string;
  }>;
  translatePercent: number;
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

type AssessmentTrackerStatus = 'planned' | 'set' | 'marking' | 'complete';
type HomeworkTrackerStatus = 'set' | 'collecting' | 'reviewed' | 'complete';

type HomeworkAssessmentEntryBase = {
  classLabel: string;
  classListId: string | null;
  description: string;
  dueDate: string;
  id: string;
  reminderDaysBefore: number;
  title: string;
  updatedAt: number;
};

type AssessmentTrackerEntry = HomeworkAssessmentEntryBase & {
  status: AssessmentTrackerStatus;
};

type HomeworkTrackerEntry = HomeworkAssessmentEntryBase & {
  status: HomeworkTrackerStatus;
};

type HomeworkAssessmentTrackerSnapshot = {
  assessments: AssessmentTrackerEntry[];
  homework: HomeworkTrackerEntry[];
  homeworkCompletionsByHomeworkId: Record<string, string[]>;
};

type AssessmentTrackerDraft = {
  classListId: string;
  description: string;
  dueDate: string;
  reminderDaysBefore: number;
  status: AssessmentTrackerStatus;
  title: string;
};

type HomeworkTrackerDraft = {
  classListId: string;
  description: string;
  dueDate: string;
  reminderDaysBefore: number;
  status: HomeworkTrackerStatus;
  title: string;
};

type BellScheduleDayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
type BellScheduleSlotId = string;
type BellScheduleSlotKind = 'break' | 'teaching';
type BellScheduleSlotAssignment = {
  classListId: string | null;
  enabled: boolean;
};

type BellScheduleDay = {
  assignmentsBySlotId: Partial<Record<BellScheduleSlotId, BellScheduleSlotAssignment>>;
  slotDefinitions: BellScheduleSlotDefinition[];
};

type BellScheduleProfile = {
  days: Record<BellScheduleDayKey, BellScheduleDay>;
  id: string;
  name: string;
};

type BellSchedulePopoutMode = 'editor' | 'summary';
type HomeworkAssessmentPopoutMode = 'editor' | 'completion';

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
type ColorModeSwatchId =
  | 'sand'
  | 'apricot'
  | 'coral'
  | 'gold'
  | 'mint'
  | 'teal'
  | 'sky'
  | 'ocean'
  | 'lavender'
  | 'berry';
type ColorModeSwatch = {
  id: ColorModeSwatchId;
  label: string;
  panelBorder: string;
  panelBottom: string;
  panelTop: string;
  widgetBorder: string;
  widgetFill: string;
  widgetHighlight: string;
  widgetInk: string;
};
type ColorModePreferences = {
  backgroundColorId: ColorModeSwatchId;
  widgetColorsByWidgetId: Record<WidgetId, ColorModeSwatchId>;
};
type ColorModePaletteTarget =
  | {
      anchorRect: DOMRect;
      kind: 'background';
    }
  | {
      anchorRect: DOMRect;
      kind: 'widget';
      widgetId: WidgetId;
    };
type ColorModeAppearanceContextValue = {
  preferences: ColorModePreferences;
  theme: ThemeMode;
};
type WidgetSizeTier = 1 | 2 | 3 | 4 | 5;

type WidgetLayout = {
  order: WidgetId[];
  hidden: WidgetId[];
  collapsed: WidgetId[];
};

type DashboardMetrics = {
  columnCount: number;
  gap: number;
  height: number;
};

type DashboardColumn = {
  widgetIds: WidgetId[];
};

type DashboardLayoutFit = {
  columns: DashboardColumn[];
  isScrollable: boolean;
  widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>>;
};

type DashboardLayoutsSnapshot = {
  layoutsByListId: Record<string, WidgetLayout>;
};

type QrWidgetPreviewState = {
  error: string | null;
  hostLabel: string | null;
  normalizedUrl: string | null;
  qrCode: QrCode | null;
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
const TRACKER_REMINDER_OPTIONS = [
  { label: 'No reminder', value: 0 },
  { label: '1 day before', value: 1 },
  { label: '3 days before', value: 3 },
  { label: '1 week before', value: 7 },
  { label: '2 weeks before', value: 14 }
] as const;
const ASSESSMENT_TRACKER_STATUS_OPTIONS = [
  { label: 'Planned', value: 'planned' },
  { label: 'Set', value: 'set' },
  { label: 'Marking', value: 'marking' },
  { label: 'Complete', value: 'complete' }
] as const satisfies ReadonlyArray<{ label: string; value: AssessmentTrackerStatus }>;
const HOMEWORK_TRACKER_STATUS_OPTIONS = [
  { label: 'Set', value: 'set' },
  { label: 'Collecting', value: 'collecting' },
  { label: 'Reviewed', value: 'reviewed' },
  { label: 'Complete', value: 'complete' }
] as const satisfies ReadonlyArray<{ label: string; value: HomeworkTrackerStatus }>;
const GROUP_SIZE_MIN = 2;
const GROUP_SIZE_MAX = 8;
const GROUP_GRID_GAP = 8;
const GROUP_GRID_MIN_COLUMNS = 2;
const GROUP_GRID_MAX_COLUMNS = 4;
const GROUP_GRID_MIN_COLUMN_WIDTH = 136;
const PICKER_SPINNER_WINDOW_SIZE = 5;
const PICKER_SPINNER_VISIBLE_SIZE = 3;
const PICKER_SPINNER_CENTER_INDEX = Math.floor(PICKER_SPINNER_WINDOW_SIZE / 2);
const PICKER_SPIN_MIN_STEPS = 8;
const PICKER_SPIN_MIN_DURATION_MS = 620;
const PICKER_SPIN_MAX_DURATION_MS = 1100;
const PICKER_SPIN_STEP_DURATION_MS = 36;
const MIN_POPOVER_WIDTH = 260;
const MIN_POPOVER_HEIGHT = 300;
const QR_WIDGET_SVG_BORDER_MODULES = 2;
const CLASS_LIST_TEXTAREA_MIN_HEIGHT = 176;
const WINDOW_EDGE_MARGIN = 14;
const LAYOUT_FALLBACK_KEY = '__default__';
const DASHBOARD_COLUMN_GAP = 12;
const DASHBOARD_SINGLE_MAX_WIDTH = 360;
const DASHBOARD_SINGLE_MIN_WIDTH = 184;
const DASHBOARD_FIT_BOTTOM_PADDING = 8;
const DASHBOARD_FIT_SCALE_MIN = 0.72;
const WIDGET_SIZE_MIN: WidgetSizeTier = 1;
const WIDGET_SIZE_MAX: WidgetSizeTier = 5;
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
  'homework-assessment',
  'qr-generator',
  'notes'
];
const WIDGET_POPOUT_MIN_SIZES: Record<WidgetId, { minHeight: number; minWidth: number }> = {
  timer: { minWidth: 280, minHeight: 224 },
  picker: { minWidth: 300, minHeight: 240 },
  'group-maker': { minWidth: 320, minHeight: 280 },
  'seating-chart': { minWidth: 760, minHeight: 560 },
  'bell-schedule': { minWidth: 340, minHeight: 300 },
  'homework-assessment': { minWidth: 520, minHeight: 520 },
  'qr-generator': { minWidth: 320, minHeight: 320 },
  notes: { minWidth: 300, minHeight: 244 },
  planner: { minWidth: 360, minHeight: 420 }
};
const WIDGET_POPOUT_DEFAULT_SIZES: Record<WidgetId, { height: number; width: number }> = {
  timer: { width: 352, height: 304 },
  picker: { width: 392, height: 332 },
  'group-maker': { width: 600, height: 456 },
  'seating-chart': { width: 980, height: 760 },
  'bell-schedule': { width: 380, height: 340 },
  'homework-assessment': { width: 820, height: 860 },
  'qr-generator': { width: 420, height: 460 },
  notes: { width: 420, height: 420 },
  planner: { width: 600, height: 720 }
};
const THEME_CYCLE_ORDER: ThemePreference[] = ['system', 'light', 'dark', 'color'];
const COLOR_MODE_SWATCHES: ColorModeSwatch[] = [
  {
    id: 'sand',
    label: 'Sand',
    panelTop: '#efe2c0',
    panelBottom: '#e7d4ab',
    panelBorder: '#5d4522',
    widgetFill: '#f6edd5',
    widgetBorder: '#5d4522',
    widgetHighlight: '#6b4b1d',
    widgetInk: '#2f2212'
  },
  {
    id: 'apricot',
    label: 'Apricot',
    panelTop: '#f2d1b2',
    panelBottom: '#e9b98e',
    panelBorder: '#7d4a20',
    widgetFill: '#f7e3d2',
    widgetBorder: '#7d4a20',
    widgetHighlight: '#9a5a22',
    widgetInk: '#3d2412'
  },
  {
    id: 'coral',
    label: 'Coral',
    panelTop: '#f0beb8',
    panelBottom: '#e79f96',
    panelBorder: '#82342f',
    widgetFill: '#f7dbd8',
    widgetBorder: '#82342f',
    widgetHighlight: '#a0443a',
    widgetInk: '#3f1815'
  },
  {
    id: 'gold',
    label: 'Gold',
    panelTop: '#efd88a',
    panelBottom: '#e4bd57',
    panelBorder: '#7f5b16',
    widgetFill: '#f5e7be',
    widgetBorder: '#7f5b16',
    widgetHighlight: '#9a6d12',
    widgetInk: '#36270f'
  },
  {
    id: 'mint',
    label: 'Mint',
    panelTop: '#cde6c3',
    panelBottom: '#a9d599',
    panelBorder: '#2d6234',
    widgetFill: '#e3f1dc',
    widgetBorder: '#2d6234',
    widgetHighlight: '#2f7b3f',
    widgetInk: '#17311c'
  },
  {
    id: 'teal',
    label: 'Teal',
    panelTop: '#bce3df',
    panelBottom: '#8dcfc7',
    panelBorder: '#225c60',
    widgetFill: '#daf0ee',
    widgetBorder: '#225c60',
    widgetHighlight: '#257277',
    widgetInk: '#102a2c'
  },
  {
    id: 'sky',
    label: 'Sky',
    panelTop: '#c7dcf8',
    panelBottom: '#97bdf2',
    panelBorder: '#295283',
    widgetFill: '#e0ecfc',
    widgetBorder: '#295283',
    widgetHighlight: '#2d64a7',
    widgetInk: '#14253e'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    panelTop: '#b8d3ee',
    panelBottom: '#80afd9',
    panelBorder: '#21466a',
    widgetFill: '#d9e8f7',
    widgetBorder: '#21466a',
    widgetHighlight: '#295980',
    widgetInk: '#112337'
  },
  {
    id: 'lavender',
    label: 'Lavender',
    panelTop: '#ddcff7',
    panelBottom: '#b9a0eb',
    panelBorder: '#5a3b88',
    widgetFill: '#ede4fb',
    widgetBorder: '#5a3b88',
    widgetHighlight: '#6d47a4',
    widgetInk: '#29193d'
  },
  {
    id: 'berry',
    label: 'Berry',
    panelTop: '#e5c2da',
    panelBottom: '#d898c0',
    panelBorder: '#7a365b',
    widgetFill: '#f2dcec',
    widgetBorder: '#7a365b',
    widgetHighlight: '#95406d',
    widgetInk: '#341625'
  }
];
const WIDGET_DETAILS: Record<
  WidgetId,
  {
    description: string;
    title: string;
  }
> = {
  timer: {
    title: 'Timer',
    description: 'Countdown presets and a custom class timer.'
  },
  picker: {
    title: 'Student Picker',
    description: 'Cycle through the current roster and choose a student at random.'
  },
  'group-maker': {
    title: 'Group Maker',
    description: 'Shuffle the current class into balanced groups.'
  },
  'seating-chart': {
    title: 'Seating Chart',
    description: 'Preview the current seating plan and open the editor to make changes.'
  },
  'bell-schedule': {
    title: 'Bell Schedule',
    description: 'Track the current period, time remaining, and your saved weekly profiles.'
  },
  planner: {
    title: 'Class Planner',
    description: 'Plan each class by date and keep lesson documents attached.'
  },
  'homework-assessment': {
    title: 'Homework / Assessment Tracker',
    description: 'Track due dates, status, and reminders across classes.'
  },
  'qr-generator': {
    title: 'QR Generator',
    description: 'Paste a link and generate a scan-ready QR code on the dashboard.'
  },
  notes: {
    title: 'Notes',
    description: 'Quick sticky notes for reminders, tasks, and prompts.'
  }
};
const WIDGET_ESTIMATED_HEIGHTS: Record<WidgetId, number> = {
  timer: 264,
  picker: 252,
  'group-maker': 428,
  'seating-chart': 352,
  'bell-schedule': 312,
  planner: 624,
  'homework-assessment': 392,
  'qr-generator': 428,
  notes: 246
};
const WIDGET_DASHBOARD_HEIGHTS: Record<WidgetId, Record<WidgetSizeTier, number>> = {
  timer: { 1: 108, 2: 150, 3: 186, 4: 230, 5: WIDGET_ESTIMATED_HEIGHTS.timer },
  picker: { 1: 114, 2: 156, 3: 198, 4: 234, 5: WIDGET_ESTIMATED_HEIGHTS.picker },
  'group-maker': { 1: 126, 2: 182, 3: 244, 4: 340, 5: WIDGET_ESTIMATED_HEIGHTS['group-maker'] },
  'seating-chart': { 1: 96, 2: 148, 3: 226, 4: 306, 5: WIDGET_ESTIMATED_HEIGHTS['seating-chart'] },
  'bell-schedule': { 1: 118, 2: 164, 3: 220, 4: 274, 5: WIDGET_ESTIMATED_HEIGHTS['bell-schedule'] },
  planner: { 1: 146, 2: 228, 3: 338, 4: 474, 5: WIDGET_ESTIMATED_HEIGHTS.planner },
  'homework-assessment': { 1: 106, 2: 162, 3: 238, 4: 332, 5: WIDGET_ESTIMATED_HEIGHTS['homework-assessment'] },
  'qr-generator': { 1: 144, 2: 208, 3: 294, 4: 368, 5: WIDGET_ESTIMATED_HEIGHTS['qr-generator'] },
  notes: { 1: 98, 2: 142, 3: 190, 4: 228, 5: WIDGET_ESTIMATED_HEIGHTS.notes }
};
const WIDGET_COLLAPSED_DASHBOARD_HEIGHT = 52;
const WIDGET_SIZE_TIER_LABELS: Record<WidgetSizeTier, string> = {
  1: 'compact',
  2: 'small',
  3: 'medium',
  4: 'large',
  5: 'full'
};
const DEFAULT_TIMER: TimerSnapshot = {
  baseDurationMs: 5 * 60 * 1000,
  endsAt: null,
  lastCompletionAcknowledgedAt: null,
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

const DEFAULT_HOMEWORK_ASSESSMENT_TRACKER: HomeworkAssessmentTrackerSnapshot = {
  assessments: [],
  homework: [],
  homeworkCompletionsByHomeworkId: {}
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
const DEFAULT_COLOR_MODE_PREFERENCES: ColorModePreferences = {
  backgroundColorId: 'sand',
  widgetColorsByWidgetId: {
    timer: 'coral',
    picker: 'sky',
    'group-maker': 'mint',
    'seating-chart': 'ocean',
    'bell-schedule': 'teal',
    planner: 'gold',
    'homework-assessment': 'sand',
    'qr-generator': 'apricot',
    notes: 'lavender'
  }
};
const DEFAULT_COLOR_MODE_APPEARANCE: ColorModeAppearanceContextValue = {
  preferences: DEFAULT_COLOR_MODE_PREFERENCES,
  theme: 'light'
};
const ColorModeAppearanceContext = createContext<ColorModeAppearanceContextValue>(
  DEFAULT_COLOR_MODE_APPEARANCE
);
const COLOR_MODE_POPOVER_WIDTH = 312;
const COLOR_MODE_POPOVER_HEIGHT = 174;
const COLOR_MODE_POPOVER_GAP = 14;

function useColorModeAppearance() {
  return useContext(ColorModeAppearanceContext);
}

function getColorModeSwatch(swatchId: ColorModeSwatchId) {
  return COLOR_MODE_SWATCHES.find((swatch) => swatch.id === swatchId) ?? COLOR_MODE_SWATCHES[0];
}

function getColorModeWidgetStyle(
  theme: ThemeMode,
  preferences: ColorModePreferences,
  widgetId: WidgetId
): CSSProperties | undefined {
  if (theme !== 'color') {
    return undefined;
  }

  const swatch = getColorModeSwatch(preferences.widgetColorsByWidgetId[widgetId]);

  return {
    '--widget-card-fill': swatch.widgetFill,
    '--widget-card-border': swatch.widgetBorder,
    '--widget-card-shadow': hexToRgba(swatch.widgetBorder, 0.18),
    '--widget-ink': swatch.widgetInk,
    '--widget-highlight': swatch.widgetHighlight,
    '--widget-highlight-soft': hexToRgba(swatch.widgetHighlight, 0.12),
    '--widget-highlight-border': hexToRgba(swatch.widgetHighlight, 0.22),
    '--widget-highlight-border-strong': hexToRgba(swatch.widgetHighlight, 0.36)
  } as CSSProperties;
}

function getColorModePanelStyle(
  theme: ThemeMode,
  preferences: ColorModePreferences
): CSSProperties | undefined {
  if (theme !== 'color') {
    return undefined;
  }

  const swatch = getColorModeSwatch(preferences.backgroundColorId);

  return {
    '--panel-fill-top': swatch.panelTop,
    '--panel-fill-bottom': swatch.panelBottom,
    '--panel-border': swatch.panelBorder,
    '--panel-bottom-edge': hexToRgba(swatch.panelBorder, 0.18)
  } as CSSProperties;
}

function getColorModePopoverPosition(anchorRect: DOMRect) {
  const viewportPadding = 12;
  const canPlaceRight =
    anchorRect.right + COLOR_MODE_POPOVER_GAP + COLOR_MODE_POPOVER_WIDTH <=
    window.innerWidth - viewportPadding;
  const left = canPlaceRight
    ? anchorRect.right + COLOR_MODE_POPOVER_GAP
    : Math.max(viewportPadding, anchorRect.left - COLOR_MODE_POPOVER_GAP - COLOR_MODE_POPOVER_WIDTH);

  return {
    left,
    side: canPlaceRight ? ('right' as const) : ('left' as const),
    top: clampNumber(
      anchorRect.top,
      viewportPadding,
      Math.max(viewportPadding, window.innerHeight - COLOR_MODE_POPOVER_HEIGHT - viewportPadding)
    )
  };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.trim().replace('#', '');
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((channel) => `${channel}${channel}`)
          .join('')
      : normalized;

  if (fullHex.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const red = Number.parseInt(fullHex.slice(0, 2), 16);
  const green = Number.parseInt(fullHex.slice(2, 4), 16);
  const blue = Number.parseInt(fullHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizeTimerSnapshot(raw: unknown, initialValue: TimerSnapshot): TimerSnapshot {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as Partial<TimerSnapshot>;
  const baseDurationMs =
    typeof nextRaw.baseDurationMs === 'number' && Number.isFinite(nextRaw.baseDurationMs)
      ? nextRaw.baseDurationMs
      : initialValue.baseDurationMs;
  const pausedRemainingMs =
    typeof nextRaw.pausedRemainingMs === 'number' && Number.isFinite(nextRaw.pausedRemainingMs)
      ? nextRaw.pausedRemainingMs
      : baseDurationMs;

  return {
    baseDurationMs,
    endsAt:
      typeof nextRaw.endsAt === 'number' && Number.isFinite(nextRaw.endsAt) ? nextRaw.endsAt : null,
    lastCompletionAcknowledgedAt:
      typeof nextRaw.lastCompletionAcknowledgedAt === 'number' &&
      Number.isFinite(nextRaw.lastCompletionAcknowledgedAt)
        ? nextRaw.lastCompletionAcknowledgedAt
        : null,
    pausedRemainingMs,
    lastCompletedAt:
      typeof nextRaw.lastCompletedAt === 'number' && Number.isFinite(nextRaw.lastCompletedAt)
        ? nextRaw.lastCompletedAt
        : null
  };
}

function hasUnacknowledgedTimerCompletion(timer: Pick<TimerSnapshot, 'lastCompletedAt' | 'lastCompletionAcknowledgedAt'>) {
  return (
    timer.lastCompletedAt !== null &&
    timer.lastCompletedAt !== (timer.lastCompletionAcknowledgedAt ?? null)
  );
}

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
const fallbackAppUpdateState: AppUpdateState = {
  availableVersion: null,
  currentVersion: 'dev',
  message: 'Updates are available in installed desktop builds.',
  progressPercent: null,
  status: 'unsupported'
};

function returnToTeacherTools() {
  window.electronAPI?.returnToTeacherTools();
}

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

      return target.closest<HTMLElement>(
        '[data-tooltip-content], .widget-card button, .widget-card [role="button"], .widget-picker-window button'
      );
    };

    const getTooltipText = (element: HTMLElement) => {
      const explicitText = element.dataset.tooltipContent?.trim();
      if (explicitText) {
        return explicitText;
      }

      if (!element.closest('.widget-card') && !element.closest('.widget-picker-window')) {
        return '';
      }

      const labelText = element.getAttribute('aria-label')?.trim();
      if (labelText) {
        return labelText;
      }

      const titleText = element.getAttribute('title')?.trim();
      if (titleText) {
        return titleText;
      }

      return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
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

      const text = getTooltipText(activeElement);
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

      const title = getTooltipText(element);
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
  const [timer, setTimer] = usePersistentState<TimerSnapshot>('teacher-tools.timer', DEFAULT_TIMER, {
    normalize: normalizeTimerSnapshot
  });
  const dragStateRef = useRef<{
    moved: boolean;
    pointerId: number;
    startBounds: WindowBounds;
    startPointerX: number;
    startPointerY: number;
  } | null>(null);
  const pendingOverlayPositionRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDragAnimationFrameRef = useRef<number | null>(null);
  const now = useNow(timer.endsAt);
  const remainingMs = timer.endsAt ? Math.max(timer.endsAt - now, 0) : timer.pausedRemainingMs;
  const isTimerAlertActive = hasUnacknowledgedTimerCompletion(timer);

  useEffect(() => {
    window.electronAPI?.getOverlayBounds().then((bounds) => {
      overlayBoundsRef.current = bounds;
    });

    return () => {
      if (overlayDragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayDragAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (timer.endsAt && remainingMs === 0) {
      setTimer((current) =>
        current.endsAt === null
          ? current
          : {
              ...current,
              endsAt: null,
              pausedRemainingMs: 0,
              lastCompletedAt: Date.now()
            }
      );
    }
  }, [remainingMs, setTimer, timer.endsAt]);

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
    pendingOverlayPositionRef.current = {
      x: nextBounds.x,
      y: nextBounds.y
    };

    if (overlayDragAnimationFrameRef.current === null) {
      overlayDragAnimationFrameRef.current = window.requestAnimationFrame(() => {
        overlayDragAnimationFrameRef.current = null;
        const pendingPosition = pendingOverlayPositionRef.current;
        pendingOverlayPositionRef.current = null;

        if (pendingPosition) {
          window.electronAPI?.setOverlayPosition(pendingPosition);
        }
      });
    }
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
      setTimer((current) =>
        hasUnacknowledgedTimerCompletion(current)
          ? {
              ...current,
              lastCompletionAcknowledgedAt: current.lastCompletedAt
            }
          : current
      );
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
          className={`overlay-dot${isTimerAlertActive ? ' overlay-dot--timer-alert' : ''}`}
          onPointerCancel={cancelPointerInteraction}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerInteraction}
          type="button"
        >
          <span
            aria-hidden="true"
            className="overlay-dot__alert"
          />
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

function getWidgetPopoutSizeTier(widgetId: WidgetId, width: number, height: number): WidgetSizeTier {
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

function useResponsiveWidgetPopoutSizeTier({
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
  const colorModePopoverRef = useRef<HTMLElement | null>(null);
  const dashboardShellRef = useRef<HTMLDivElement | null>(null);
  const dragOverWidgetIdRef = useRef<WidgetId | null>(null);
  const pickerSpinAnimationFrameRef = useRef<number | null>(null);
  const pickerSpinnerTrackRef = useRef<HTMLDivElement | null>(null);
  const pickerRenderedPositionRef = useRef(0);
  const widgetDragAnimationFrameRef = useRef<number | null>(null);
  const widgetDragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const stableDashboardLayoutFitRef = useRef<DashboardLayoutFit | null>(null);
  const widgetDragStateRef = useRef<{
    draggedWidgetId: WidgetId;
    hasMoved: boolean;
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
  } | null>(null);
  const [timer, setTimer] = usePersistentState<TimerSnapshot>('teacher-tools.timer', DEFAULT_TIMER, {
    normalize: normalizeTimerSnapshot
  });
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
  const homeworkAssessmentTracker = useHomeworkAssessmentTrackerController(
    picker.selectedListId,
    picker.lists
  );
  const [, setHomeworkAssessmentPopoutMode] = useHomeworkAssessmentPopoutModeState();
  const bellSchedule = useBellScheduleController(picker.lists);
  const qrGenerator = useQrWidgetState();
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
  const [colorModePreferences, setColorModePreferences] = useColorModePreferencesState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const [isClassMenuOpen, setIsClassMenuOpen] = useState(false);
  const [isPickerSpinning, setIsPickerSpinning] = useState(false);
  const [spinnerPosition, setSpinnerPosition] = useState(0);
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
  const [appUpdate, setAppUpdate] = useAppUpdateState();
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
  const collapsedWidgetKey = selectedLayout.collapsed.join('|');
  const { beginResize, continueResize, endResize, isResizing } = useWindowResizeHandles({
    minWidth: MIN_POPOVER_WIDTH,
    minHeight: MIN_POPOVER_HEIGHT
  });
  const calculatedDashboardLayoutFit = useMemo(
    () =>
      buildResponsiveDashboardLayout({
        availableHeight: Math.max(0, dashboardMetrics.height - dashboardMeasuredFitBuffer),
        collapsedWidgetIds: selectedLayout.collapsed,
        columnCount: dashboardMetrics.columnCount,
        widgetIds: visibleWidgetIds
      }),
    [
      collapsedWidgetKey,
      dashboardMeasuredFitBuffer,
      dashboardMetrics.columnCount,
      dashboardMetrics.height,
      visibleWidgetKey
    ]
  );
  const dashboardLayoutFit =
    isResizing && stableDashboardLayoutFitRef.current
      ? stableDashboardLayoutFitRef.current
      : calculatedDashboardLayoutFit;

  if (!isResizing) {
    stableDashboardLayoutFitRef.current = calculatedDashboardLayoutFit;
  }

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
    shouldPreferDashboardScroll ||
    calculatedDashboardLayoutFit.isScrollable ||
    dashboardLayoutFit.isScrollable ||
    dashboardForceScroll;
  const effectiveDashboardFitScale = shouldAllowDashboardScroll ? 1 : dashboardFitScale;
  const rosterCount = selectedStudents.length;
  const timerLabel = formatDuration(remainingMs);
  const todayLabel = formatSchoolDateLabel(new Date(now));
  const appUpdateButtonLabel = getAppUpdateButtonLabel(appUpdate);
  const appUpdateStatusLabel = getAppUpdateStatusLabel(appUpdate);
  const appUpdateStatusTone = getAppUpdateStatusTone(appUpdate);
  const appUpdateActionDisabled =
    appUpdate.status === 'checking' ||
    appUpdate.status === 'available' ||
    appUpdate.status === 'downloading' ||
    appUpdate.status === 'unsupported';
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
  const pickerSpinnerView = buildPickerSpinnerView({
    currentPick: picker.currentPick,
    isSpinning: isPickerSpinning,
    names: selectedStudents,
    spinnerPosition
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
      if (isResizing) {
        return;
      }

      const nextMetrics = computeDashboardMetrics(
        dashboardShell.clientWidth,
        dashboardShell.clientHeight
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

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [interfaceScale, isResizing, visibleWidgetKey]);

  useEffect(() => {
    setDashboardMeasuredFitBuffer(0);
    setDashboardFitScale(1);
    setDashboardForceScroll(false);
  }, [collapsedWidgetKey, interfaceScale, visibleWidgetKey]);

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

    frameId = window.requestAnimationFrame(measureRenderedOverflow);

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
    if (timer.endsAt && remainingMs === 0) {
      setTimer((current) =>
        current.endsAt === null
          ? current
          : {
              ...current,
              endsAt: null,
              pausedRemainingMs: 0,
              lastCompletedAt: Date.now()
            }
      );
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
        setSpinnerPosition(nextIndex);
        return;
      }
    }

    setSpinnerPosition(0);
  }, [isPickerSpinning, picker.currentPick, selectedStudents]);

  useEffect(() => {
    return () => {
      if (pickerSpinAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(pickerSpinAnimationFrameRef.current);
      }
      if (widgetDragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(widgetDragAnimationFrameRef.current);
      }
    };
  }, []);

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
      ? getNormalizedPickerIndex(spinnerPosition, selectedStudents.length)
      : 0;
    const totalSteps = getPickerSpinStepCount(
      selectedStudents.length,
      normalizedSpinnerIndex,
      finalIndex
    );
    const spinDurationMs = getPickerSpinDuration(totalSteps);
    const startPosition = normalizedSpinnerIndex;
    const endPosition = normalizedSpinnerIndex + totalSteps;
    const selectedListId = selectedList.id;

    if (pickerSpinAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(pickerSpinAnimationFrameRef.current);
    }

    const syncSpinnerPosition = (nextPosition: number, shouldRender: boolean) => {
      pickerSpinnerTrackRef.current?.style.setProperty(
        '--picker-spinner-translate',
        `${getPickerSpinnerTranslatePercent(nextPosition - Math.floor(nextPosition))}%`
      );

      if (shouldRender) {
        pickerRenderedPositionRef.current = nextPosition;
        setSpinnerPosition(nextPosition);
      }
    };

    setIsClassMenuOpen(false);
    setIsPickerSpinning(true);
    syncSpinnerPosition(startPosition, true);

    const spinStartedAt = window.performance.now();

    const animatePickerSpin = (timestamp: number) => {
      const progress = Math.min((timestamp - spinStartedAt) / spinDurationMs, 1);
      const easedProgress = easeOutPickerSpin(progress);
      const nextPosition = startPosition + (endPosition - startPosition) * easedProgress;
      const nextBaseIndex = Math.floor(nextPosition);
      const nextActiveStep = Math.round(nextPosition - nextBaseIndex);
      const renderedBaseIndex = Math.floor(pickerRenderedPositionRef.current);
      const renderedActiveStep = Math.round(
        pickerRenderedPositionRef.current - renderedBaseIndex
      );

      syncSpinnerPosition(
        nextPosition,
        nextBaseIndex !== renderedBaseIndex || nextActiveStep !== renderedActiveStep
      );

      if (progress < 1) {
        pickerSpinAnimationFrameRef.current = window.requestAnimationFrame(animatePickerSpin);
        return;
      }

      pickerSpinAnimationFrameRef.current = null;

      syncSpinnerPosition(finalIndex, true);
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
    };

    pickerSpinAnimationFrameRef.current = window.requestAnimationFrame(animatePickerSpin);
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
      lastCompletionAcknowledgedAt: timer.lastCompletionAcknowledgedAt,
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
    const isColorModePaletteOpen =
      colorModePaletteTarget?.kind === 'widget' && colorModePaletteTarget.widgetId === widgetId;
    const sizeTier = dashboardLayoutFit.widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX;
    const targetHeight = getWidgetDashboardHeight(widgetId, sizeTier, collapsed);

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
          badge={timerStatusLabel}
          badgeTone={timerFinishedRecently ? 'alert' : 'default'}
          collapsed={collapsed}
          description="Presets, custom minutes, and a quick class countdown."
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          targetHeight={targetHeight}
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
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          targetHeight={targetHeight}
          {...dragProps}
        >
          <PickerWidgetContent
            isPickerSpinning={isPickerSpinning}
            onPick={pickStudent}
            onResetCycle={resetCurrentListCycle}
            onToggleRemovePickedStudents={toggleRemovePickedStudents}
            pickerSpinnerView={pickerSpinnerView}
            spinnerTrackRef={pickerSpinnerTrackRef}
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
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          targetHeight={targetHeight}
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
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
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
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
          targetHeight={targetHeight}
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

    if (widgetId === 'homework-assessment') {
      return (
        <WidgetCard
          badge={homeworkAssessmentTracker.badgeLabel}
          badgeTone={homeworkAssessmentTracker.badgeTone}
          collapsed={collapsed}
          description={homeworkAssessmentTracker.summaryDescription}
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
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
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
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
              : 'Set up a weekly bell schedule.'
          }
          headerDragMode="interactive"
          headerActions={headerActions}
          isDragOver={isDragOver}
          isDragging={isDragging}
          key={widgetId}
          onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
          onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
          title={WIDGET_DETAILS[widgetId].title}
          widgetId={widgetId}
          sizeTier={sizeTier}
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
        badge={stickyNotes.length > 0 ? `${stickyNotes.length}` : null}
        collapsed={collapsed}
        description="Capture reminders and quick thoughts."
        headerDragMode="interactive"
        headerActions={headerActions}
        isDragOver={isDragOver}
        isDragging={isDragging}
        key={widgetId}
        onDoubleClick={() => toggleWidgetCollapsed(widgetId)}
        onToggleCollapsed={() => toggleWidgetCollapsed(widgetId)}
        title={WIDGET_DETAILS[widgetId].title}
        widgetId={widgetId}
        sizeTier={sizeTier}
        targetHeight={targetHeight}
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
                  <div className="update-toolbar">
                    <span className={`update-status-pill update-status-pill--${appUpdateStatusTone}`}>
                      {appUpdateStatusLabel}
                    </span>
                    <button
                      aria-label={appUpdateButtonLabel}
                      className={`toolbar-link ${
                        appUpdate.status === 'downloaded'
                          ? 'toolbar-link--accent'
                          : appUpdate.status === 'error' || appUpdate.status === 'unsupported'
                            ? 'button-tone--warning'
                            : appUpdate.status === 'up-to-date'
                              ? 'button-tone--selection'
                              : ''
                      }`}
                      data-tooltip-content={getAppUpdateTooltip(appUpdate)}
                      disabled={appUpdateActionDisabled}
                      onClick={handleAppUpdateAction}
                      type="button"
                    >
                      <span className="toolbar-button__label toolbar-button__label--full">
                        {appUpdateButtonLabel}
                      </span>
                      <span
                        aria-hidden="true"
                        className="toolbar-button__label toolbar-button__label--compact"
                      >
                        ↻
                      </span>
                    </button>
                  </div>
                  <button
                    aria-label="Widgets"
                    className="toolbar-link"
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
                    className="toolbar-link"
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
                  <InterfaceScaleControls
                    canDecrease={canDecreaseInterfaceScale}
                    canIncrease={canIncreaseInterfaceScale}
                    onDecrease={decreaseInterfaceScale}
                    onIncrease={increaseInterfaceScale}
                    scale={interfaceScale}
                  />
                  {resolvedTheme === 'color' ? (
                    <ColorModeTriggerButton
                      active={colorModePaletteTarget?.kind === 'background'}
                      appearance="background"
                      label="Change dashboard background colour"
                      onClick={(event) =>
                        toggleColorModePalette({
                          anchorRect: event.currentTarget.getBoundingClientRect(),
                          kind: 'background'
                        })
                      }
                      swatchId={colorModePreferences.backgroundColorId}
                      variant="toolbar"
                    />
                  ) : null}
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
        returnToTeacherTools();
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
          returnToTeacherTools();
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
                onClick={returnToTeacherTools}
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
                        {details.description}
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
        returnToTeacherTools();
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

function ColorModePalette({
  backgroundColorId,
  onBackgroundColorChange,
  onWidgetColorChange,
  popoverRef,
  target,
  widgetColorId
}: {
  backgroundColorId: ColorModeSwatchId;
  onBackgroundColorChange: (swatchId: ColorModeSwatchId) => void;
  onWidgetColorChange: (swatchId: ColorModeSwatchId) => void;
  popoverRef: (element: HTMLElement | null) => void;
  target: ColorModePaletteTarget;
  widgetColorId: ColorModeSwatchId | null;
}) {
  const position = getColorModePopoverPosition(target.anchorRect);
  const isWidgetTarget = target.kind === 'widget';
  const title = isWidgetTarget ? WIDGET_DETAILS[target.widgetId].title : 'Dashboard background';

  return (
    <aside
      aria-label={`Colour options for ${title}`}
      className={`color-mode-popover color-mode-popover--${position.side}`}
      ref={popoverRef}
      style={
        {
          left: `${position.left}px`,
          top: `${position.top}px`
        } as CSSProperties
      }
    >
      <div className="color-mode-popover__header">
        <span className="color-mode-popover__kicker">Colour mode</span>
        <strong className="color-mode-popover__title">{title}</strong>
      </div>

      {isWidgetTarget && widgetColorId ? (
        <div className="color-mode-popover__section">
          <span className="color-mode-popover__label">Widget</span>
          <div className="color-mode-popover__swatches">
            {COLOR_MODE_SWATCHES.map((swatch) => (
              <ColorModeSwatchButton
                appearance="widget"
                isSelected={widgetColorId === swatch.id}
                key={`widget-${swatch.id}`}
                label={`Set ${title} to ${swatch.label}`}
                onClick={() => onWidgetColorChange(swatch.id)}
                swatch={swatch}
              />
            ))}
          </div>
        </div>
      ) : null}

      {!isWidgetTarget ? (
        <div className="color-mode-popover__section">
          <span className="color-mode-popover__label">Background</span>
          <div className="color-mode-popover__swatches">
            {COLOR_MODE_SWATCHES.map((swatch) => (
              <ColorModeSwatchButton
                appearance="background"
                isSelected={backgroundColorId === swatch.id}
                key={`background-${swatch.id}`}
                label={`Set background to ${swatch.label}`}
                onClick={() => onBackgroundColorChange(swatch.id)}
                swatch={swatch}
              />
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ColorModeSwatchButton({
  appearance,
  isSelected,
  label,
  onClick,
  swatch
}: {
  appearance: 'background' | 'widget';
  isSelected: boolean;
  label: string;
  onClick: () => void;
  swatch: ColorModeSwatch;
}) {
  const previewStyle =
    appearance === 'background'
      ? {
          background: `linear-gradient(180deg, ${swatch.panelTop}, ${swatch.panelBottom})`,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.panelBorder, 0.24)}`
        }
      : {
          background: swatch.widgetFill,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.widgetBorder, 0.22)}`
        };

  return (
    <button
      aria-label={label}
      aria-pressed={isSelected}
      className={`color-mode-popover__swatch ${isSelected ? 'color-mode-popover__swatch--selected' : ''}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className="color-mode-popover__swatch-preview" style={previewStyle} />
    </button>
  );
}

function ColorModeTriggerButton({
  active,
  appearance,
  label,
  onClick,
  swatchId,
  variant
}: {
  active: boolean;
  appearance: 'background' | 'widget';
  label: string;
  onClick: (event: ReactPointerEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>) => void;
  swatchId: ColorModeSwatchId;
  variant: 'toolbar' | 'widget';
}) {
  const swatch = getColorModeSwatch(swatchId);
  const previewStyle =
    appearance === 'background'
      ? {
          background: `linear-gradient(180deg, ${swatch.panelTop}, ${swatch.panelBottom})`,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.panelBorder, 0.24)}`
        }
      : {
          background: swatch.widgetFill,
          boxShadow: `inset 0 0 0 1px ${hexToRgba(swatch.widgetBorder, 0.22)}`
        };
  const className =
    variant === 'toolbar'
      ? `toolbar-link button-tone--utility color-mode-trigger color-mode-trigger--toolbar ${
          active ? 'color-mode-trigger--active' : ''
        }`
      : `widget-icon-button button-tone--utility color-mode-trigger color-mode-trigger--widget ${
          active ? 'color-mode-trigger--active' : ''
        }`;

  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={className}
      data-color-mode-trigger={variant}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      title={label}
      type="button"
    >
      <span
        aria-hidden="true"
        className="color-mode-trigger__preview"
        style={previewStyle}
      />
      {variant === 'toolbar' ? <span className="color-mode-trigger__text">Background</span> : null}
    </button>
  );
}

function WidgetCard({
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
      <PopoutIcon />
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

function PopoutIcon() {
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
      <div className="action-row widget-primary-actions">
        {!isTimerRunning && !isTimerPaused && (
          <button
            aria-label="Start timer"
            className="primary-link"
            data-compact-icon="▶"
            onClick={onStart}
            type="button"
          >
            Start
          </button>
        )}
        {isTimerRunning && (
          <button
            aria-label="Pause timer"
            className="primary-link"
            data-compact-icon="❚❚"
            onClick={onPause}
            type="button"
          >
            Pause
          </button>
        )}
        {isTimerPaused && (
          <button
            aria-label="Resume timer"
            className="primary-link"
            data-compact-icon="▶"
            onClick={onResume}
            type="button"
          >
            Resume
          </button>
        )}
        <button
          aria-label="Reset timer"
          className="secondary-link"
          data-compact-icon="↻"
          onClick={onReset}
          type="button"
        >
          Reset
        </button>
      </div>

      <div className="segmented-row widget-top-controls">
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

      <div className="custom-row widget-top-controls">
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

      <div className="timer-readout">{timerLabel}</div>

      <div className="progress">
        <span className="progress__fill" style={{ transform: `scaleX(${timerProgress})` }} />
      </div>
    </>
  );
}

function PickerWidgetContent({
  isPickerSpinning,
  onPick,
  onResetCycle,
  onToggleRemovePickedStudents,
  pickerSpinnerView,
  spinnerTrackRef,
  recentPicks,
  removePickedStudents,
  selectedStudentCount
}: {
  isPickerSpinning: boolean;
  onPick: () => void;
  onResetCycle: () => void;
  onToggleRemovePickedStudents: (removePickedStudents: boolean) => void;
  pickerSpinnerView: PickerSpinnerView;
  spinnerTrackRef?: Ref<HTMLDivElement>;
  recentPicks: string[];
  removePickedStudents: boolean;
  selectedStudentCount: number;
}) {
  const pickerModeLabel = removePickedStudents ? 'Remove after pick' : 'Keep in list';
  const pickerSpinnerStyle = {
    '--picker-spinner-translate': `${pickerSpinnerView.translatePercent}%`
  } as CSSProperties;

  return (
    <>
      <div className="widget-top-controls picker-widget__top-controls">
        <div className="action-row widget-primary-actions">
          <button
            aria-label={removePickedStudents ? 'Reset picker cycle' : 'Clear recent picks'}
            className="secondary-link"
            data-compact-icon="↻"
            disabled={selectedStudentCount === 0}
            onClick={onResetCycle}
            type="button"
          >
            {removePickedStudents ? 'Reset cycle' : 'Clear picks'}
          </button>
          <button
            aria-label={isPickerSpinning ? 'Picking student' : 'Pick student'}
            className="primary-link"
            data-compact-icon="✦"
            disabled={selectedStudentCount === 0 || isPickerSpinning}
            onClick={onPick}
            type="button"
          >
            {isPickerSpinning ? 'Picking…' : 'Pick'}
          </button>
        </div>

        <div className="helper-row picker-controls-row">
          <button
            aria-label={pickerModeLabel}
            aria-pressed={removePickedStudents}
            className="text-toggle picker-mode-toggle button-tone--utility"
            data-compact-icon={removePickedStudents ? '−' : '='}
            onClick={() => onToggleRemovePickedStudents(!removePickedStudents)}
            type="button"
          >
            {pickerModeLabel}
          </button>
        </div>
      </div>

      <div className="picker-stack">
        <div className={`picker-spinner ${isPickerSpinning ? 'picker-spinner--running' : ''}`}>
          <div className="picker-spinner__fade" />
          <div className="picker-spinner__track" ref={spinnerTrackRef} style={pickerSpinnerStyle}>
            {pickerSpinnerView.items.map((item) => (
              <span
                className={`picker-spinner__name${item.isActive ? ' picker-spinner__name--active' : ''}${
                  item.isAdjacent ? ' picker-spinner__name--adjacent' : ''
                }`}
                key={item.key}
              >
                {item.name}
              </span>
            ))}
          </div>
        </div>
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
  groupMakerHint: string | null;
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
      <div className="widget-top-controls group-maker__top-controls">
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

          {groupMakerHint ? <p className="helper-text">{groupMakerHint}</p> : null}
        </div>

        <div className="action-row widget-primary-actions">
          <button
            aria-label="Clear saved groups"
            className="secondary-link"
            data-compact-icon="×"
            disabled={!hasSavedGroups}
            onClick={onClear}
            type="button"
          >
            Clear
          </button>
          <button
            aria-label="Shuffle groups"
            className="primary-link"
            data-compact-icon="↻"
            disabled={selectedStudentCount < 2}
            onClick={onShuffle}
            type="button"
          >
            Shuffle groups
          </button>
        </div>
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
      <div className="note-input-row widget-top-controls">
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
        <button
          aria-label="Add note"
          className="primary-link"
          data-compact-icon="+"
          onClick={onAddNote}
          type="button"
        >
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

function QrGeneratorWidgetContent({
  linkDraft,
  onClear,
  onDraftChange,
  preview
}: {
  linkDraft: string;
  onClear: () => void;
  onDraftChange: (value: string) => void;
  preview: QrWidgetPreviewState;
}) {
  const qrSvgViewBoxSize = preview.qrCode ? preview.qrCode.size + QR_WIDGET_SVG_BORDER_MODULES * 2 : 0;
  const qrSvgPath = preview.qrCode
    ? buildQrSvgPath(preview.qrCode, QR_WIDGET_SVG_BORDER_MODULES)
    : '';

  return (
    <div className="qr-widget">
      <div className="qr-widget__top-controls widget-top-controls">
        <div className="field-stack">
          <label className="field-label" htmlFor="qr-generator-link">
            Link
          </label>
          <input
            className="text-field"
            id="qr-generator-link"
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="https://school.example.com/check-in"
            spellCheck={false}
            type="text"
            value={linkDraft}
          />
        </div>
        <button
          aria-label="Clear QR link"
          className="secondary-link"
          data-compact-icon="×"
          disabled={!linkDraft.trim()}
          onClick={onClear}
          type="button"
        >
          Clear
        </button>
      </div>

      {preview.qrCode ? (
        <div className="qr-widget__preview-shell">
          <div className="qr-widget__preview-card">
            <svg
              aria-label={`QR code for ${preview.normalizedUrl}`}
              className="qr-widget__svg"
              role="img"
              viewBox={`0 0 ${qrSvgViewBoxSize} ${qrSvgViewBoxSize}`}
            >
              <rect fill="#ffffff" height={qrSvgViewBoxSize} rx="2" width={qrSvgViewBoxSize} />
              <path d={qrSvgPath} fill="currentColor" />
            </svg>
          </div>

          <div className="qr-widget__meta">
            {preview.hostLabel ? <span className="pill">{preview.hostLabel}</span> : null}
            <p className="helper-text qr-widget__url">{preview.normalizedUrl}</p>
          </div>
        </div>
      ) : (
        <div className="widget-empty-state qr-widget__empty">
          <p className="empty-copy">
            {preview.error ?? 'Paste a web link and the QR code will generate here instantly.'}
          </p>
        </div>
      )}

      <p className="helper-text qr-widget__hint">
        {preview.qrCode
          ? 'The code updates directly on the dashboard as you type.'
          : 'Use a full web address or a domain name and the widget will handle the rest.'}
      </p>
    </div>
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
  const planTextareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  useLayoutEffect(() => {
    const textarea = planTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [planText, selectedList]);

  const helperCopy = !selectedList
    ? 'Choose a class first, then save lesson plans and documents by date.'
    : planText.trim() || documents.length > 0
      ? `Saved plan for ${selectedList.name} on ${formatLongDate(selectedDate)}.`
      : `Select a date and start planning ${selectedList.name}.`;

  return (
    <div className={`planner-widget ${isCalendarCollapsed ? '' : 'planner-widget--calendar-open'}`}>
      <div className="planner-widget__toolbar widget-top-controls">
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
          </div>
        </div>
        <div className="planner-widget__action-row">
          <button
            aria-label="Select today"
            className="secondary-link button-tone--utility planner-widget__action-button planner-widget__today"
            disabled={!selectedList}
            onClick={() => onSelectDate(getTodayDateKey())}
            type="button"
          >
            <span className="planner-widget__action-label">Today</span>
          </button>
          <button
            aria-label={isCalendarCollapsed ? 'Show calendar' : 'Hide calendar'}
            aria-expanded={!isCalendarCollapsed}
            className="secondary-link button-tone--utility planner-widget__action-button planner-calendar__toggle"
            onClick={() => setIsCalendarCollapsed((current) => !current)}
            type="button"
          >
            <span className="planner-widget__action-label">
              {isCalendarCollapsed ? 'Show calendar' : 'Hide calendar'}
            </span>
          </button>
          <button
            aria-label="Attach lesson files"
            className="primary-link planner-widget__action-button planner-widget__attach"
            disabled={!selectedList}
            onClick={() => void onAttachDocuments()}
            type="button"
          >
            <span className="planner-widget__action-label">Attach files</span>
          </button>
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
          {!isCalendarCollapsed ? (
            <div className="planner-calendar__month-nav" aria-label="Calendar month navigation">
              <button
                aria-label="Previous month"
                className="widget-icon-button button-tone--utility planner-calendar__month-button"
                disabled={!selectedList}
                onClick={() => setVisibleMonth(shiftMonthKey(visibleMonth, -1))}
                type="button"
              >
                ‹
              </button>
              <button
                aria-label="Next month"
                className="widget-icon-button button-tone--utility planner-calendar__month-button"
                disabled={!selectedList}
                onClick={() => setVisibleMonth(shiftMonthKey(visibleMonth, 1))}
                type="button"
              >
                ›
              </button>
            </div>
          ) : null}
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

      <div className="field-stack field-stack--fill planner-widget__plan">
        <label className="field-label" htmlFor="lesson-plan-text">
          Lesson plan
        </label>
        <textarea
          className="text-area text-area--planner"
          disabled={!selectedList}
          id="lesson-plan-text"
          onChange={(event) => onUpdatePlan(event.target.value)}
          placeholder="Outline your lesson, activities, reminders, and follow-up."
          ref={planTextareaRef}
          value={planText}
        />
      </div>

      <div className="planner-documents">
        <div className="planner-documents__header">
          <div>
            <span className="field-label">Documents</span>
            <p className="helper-text">Attach files from your computer and reopen them from here.</p>
          </div>
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

function HomeworkAssessmentTrackerWidgetContent({
  controller,
  mode,
  onOpenCompletion,
  onOpenManager,
  popoutMode = 'editor',
  setPopoutMode
}: {
  controller: ReturnType<typeof useHomeworkAssessmentTrackerController>;
  mode: 'dashboard' | 'popout';
  onOpenCompletion?: () => void;
  onOpenManager?: () => void;
  popoutMode?: HomeworkAssessmentPopoutMode;
  setPopoutMode?: (mode: HomeworkAssessmentPopoutMode) => void;
}) {
  const isPopout = mode === 'popout';
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  const [editingHomeworkId, setEditingHomeworkId] = useState<string | null>(null);
  const [completionClassListId, setCompletionClassListId] = useState(
    controller.defaultClassListId
  );
  const [assessmentDraft, setAssessmentDraft] = useState<AssessmentTrackerDraft>(() =>
    createAssessmentTrackerDraft(controller.defaultClassListId)
  );
  const [homeworkDraft, setHomeworkDraft] = useState<HomeworkTrackerDraft>(() =>
    createHomeworkTrackerDraft(controller.defaultClassListId)
  );

  useEffect(() => {
    setAssessmentDraft((current) => ({
      ...current,
      classListId: resolveTrackerDraftClassListId(
        current.classListId,
        controller.defaultClassListId,
        controller.classLists
      )
    }));
    setHomeworkDraft((current) => ({
      ...current,
      classListId: resolveTrackerDraftClassListId(
        current.classListId,
        controller.defaultClassListId,
        controller.classLists
      )
    }));
    setCompletionClassListId((current) =>
      resolveTrackerDraftClassListId(current, controller.defaultClassListId, controller.classLists)
    );
  }, [controller.classLists, controller.defaultClassListId]);

  const resetAssessmentDraft = (nextClassListId = assessmentDraft.classListId) => {
    const resolvedClassListId = resolveTrackerDraftClassListId(
      nextClassListId,
      controller.defaultClassListId,
      controller.classLists
    );
    setAssessmentDraft({
      ...createAssessmentTrackerDraft(resolvedClassListId),
      classListId: resolvedClassListId
    });
    setEditingAssessmentId(null);
  };

  const resetHomeworkDraft = (nextClassListId = homeworkDraft.classListId) => {
    const resolvedClassListId = resolveTrackerDraftClassListId(
      nextClassListId,
      controller.defaultClassListId,
      controller.classLists
    );
    setHomeworkDraft({
      ...createHomeworkTrackerDraft(resolvedClassListId),
      classListId: resolvedClassListId
    });
    setEditingHomeworkId(null);
  };

  const saveAssessment = () => {
    const title = assessmentDraft.title.trim();
    const dueDate = normalizeDateKey(assessmentDraft.dueDate);
    const classListId = resolveTrackerDraftClassListId(
      assessmentDraft.classListId,
      controller.defaultClassListId,
      controller.classLists
    );

    if (!title || !dueDate) {
      return;
    }

    const nextEntry = {
      classListId,
      description: assessmentDraft.description.trim(),
      dueDate,
      reminderDaysBefore: assessmentDraft.reminderDaysBefore,
      status: assessmentDraft.status,
      title
    };

    if (editingAssessmentId) {
      controller.updateAssessment(editingAssessmentId, nextEntry);
    } else {
      controller.addAssessment(nextEntry);
    }

    resetAssessmentDraft(classListId);
  };

  const saveHomework = () => {
    const title = homeworkDraft.title.trim();
    const dueDate = normalizeDateKey(homeworkDraft.dueDate);
    const classListId = resolveTrackerDraftClassListId(
      homeworkDraft.classListId,
      controller.defaultClassListId,
      controller.classLists
    );

    if (!title || !dueDate) {
      return;
    }

    const nextEntry = {
      classListId,
      description: homeworkDraft.description.trim(),
      dueDate,
      reminderDaysBefore: homeworkDraft.reminderDaysBefore,
      status: homeworkDraft.status,
      title
    };

    if (editingHomeworkId) {
      controller.updateHomework(editingHomeworkId, nextEntry);
    } else {
      controller.addHomework(nextEntry);
    }

    resetHomeworkDraft(classListId);
  };

  const completionClassList =
    controller.classLists.find((list) => list.id === completionClassListId) ??
    controller.classLists[0] ??
    null;
  const completionHomework = completionClassList
    ? controller.homework
        .filter((item) => item.classListId === completionClassList.id)
        .sort((left, right) => {
          const dateDelta = getDaysUntilDateKey(left.dueDate, right.dueDate);
          return dateDelta === 0 ? right.updatedAt - left.updatedAt : dateDelta;
        })
    : [];
  const homeworkCompletionSets = new Map(
    completionHomework.map((item) => [
      item.id,
      new Set(controller.tracker.homeworkCompletionsByHomeworkId[item.id] ?? [])
    ])
  );
  const completedCellCount = completionHomework.reduce(
    (total, item) =>
      total + (controller.tracker.homeworkCompletionsByHomeworkId[item.id]?.length ?? 0),
    0
  );

  return (
    <div className="tracker-widget">
      {!isPopout && (onOpenManager || onOpenCompletion) ? (
        <div className="tracker-summary__footer widget-top-controls">
          {onOpenManager ? (
            <button
              aria-label="Open homework and assessment editor"
              className="secondary-link button-tone--utility"
              data-compact-icon="✎"
              onClick={onOpenManager}
              type="button"
            >
              Open editor
            </button>
          ) : null}
          {onOpenCompletion ? (
            <button
              aria-label="Open homework completion tracker"
              className="secondary-link button-tone--selection"
              data-compact-icon="✓"
              onClick={onOpenCompletion}
              type="button"
            >
              Completion
            </button>
          ) : null}
        </div>
      ) : null}

      <section className={`tracker-summary ${isPopout ? '' : 'tracker-summary--compact'}`}>
        <section className="tracker-summary__section">
          <div className="tracker-summary__section-head">
            <span className="field-label">Assessments</span>
            {controller.upcomingAssessments.length > 0 ? (
              <span className="badge">{controller.upcomingAssessments.length}</span>
            ) : null}
          </div>

          {controller.upcomingAssessments.length > 0 ? (
            <div className="tracker-record-list">
              {controller.upcomingAssessments.map((item) => (
                <TrackerItemCard
                  classLists={controller.classLists}
                  compact
                  item={item}
                  key={item.id}
                  kind="assessment"
                  todayKey={controller.todayKey}
                />
              ))}
            </div>
          ) : (
            <p className="empty-copy tracker-summary__empty">No assessments</p>
          )}
        </section>

        <section className="tracker-summary__section">
          <div className="tracker-summary__section-head">
            <span className="field-label">Today</span>
            {controller.homeworkDueToday.length > 0 ? (
              <span className="badge">{controller.homeworkDueToday.length}</span>
            ) : null}
          </div>

          {controller.homeworkDueToday.length > 0 ? (
            <div className="tracker-record-list">
              {controller.homeworkDueToday.map((item) => (
                <TrackerItemCard
                  classLists={controller.classLists}
                  compact
                  item={item}
                  key={item.id}
                  kind="homework"
                  todayKey={controller.todayKey}
                />
              ))}
            </div>
          ) : (
            <p className="empty-copy tracker-summary__empty">Nothing due today</p>
          )}
        </section>

      </section>

      {isPopout ? (
        <>
          <div className="tracker-popout-tabs" role="tablist" aria-label="Homework tracker view">
            <button
              aria-selected={popoutMode === 'editor'}
              className="text-toggle"
              onClick={() => setPopoutMode?.('editor')}
              role="tab"
              type="button"
            >
              Editor
            </button>
            <button
              aria-selected={popoutMode === 'completion'}
              className="text-toggle"
              onClick={() => setPopoutMode?.('completion')}
              role="tab"
              type="button"
            >
              Completion
            </button>
          </div>

          {popoutMode === 'completion' ? (
            <section className="tracker-panel tracker-completion-panel">
              <div className="tracker-panel__header">
                <div>
                  <span className="field-label">Homework completion</span>
                  <p className="helper-text">Tick students off against each homework due date.</p>
                </div>
                <span className="badge">{completedCellCount}</span>
              </div>

              <div className="field-stack tracker-completion__class">
                <label className="field-label" htmlFor="tracker-completion-class">
                  Class
                </label>
                <select
                  className="text-field"
                  id="tracker-completion-class"
                  onChange={(event) => setCompletionClassListId(event.target.value)}
                  value={completionClassList?.id ?? ''}
                >
                  {controller.classLists.map((list) => (
                    <option key={`completion-class-${list.id}`} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </div>

              {completionClassList && completionHomework.length > 0 ? (
                <div className="tracker-completion-table-wrap">
                  <table className="tracker-completion-table">
                    <thead>
                      <tr>
                        <th scope="col">Student</th>
                        {completionHomework.map((item) => (
                          <th
                            data-tooltip-content={item.title}
                            key={`completion-head-${item.id}`}
                            scope="col"
                          >
                            <span className="tracker-completion-table__date">
                              {formatLongDate(item.dueDate)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {completionClassList.students.map((studentName, studentIndex) => (
                        <tr key={`completion-student-${studentIndex}-${studentName}`}>
                          <th scope="row">{studentName}</th>
                          {completionHomework.map((item) => {
                            const checked = homeworkCompletionSets.get(item.id)?.has(studentName) ?? false;

                            return (
                              <td key={`completion-cell-${item.id}-${studentIndex}-${studentName}`}>
                                <label className="tracker-completion-check">
                                  <input
                                    aria-label={`${studentName} completed ${item.title}`}
                                    checked={checked}
                                    onChange={(event) =>
                                      controller.toggleHomeworkCompletion(
                                        item.id,
                                        studentName,
                                        event.target.checked
                                      )
                                    }
                                    type="checkbox"
                                  />
                                  <span aria-hidden="true" />
                                </label>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="group-maker__empty">
                  <p className="empty-copy">
                    {completionClassList
                      ? 'Add homework for this class to start ticking students off.'
                      : 'Choose a class list to track homework completion.'}
                  </p>
                </div>
              )}
            </section>
          ) : (
            <>
              <div className="tracker-editor-grid">
                <section className="tracker-panel tracker-panel--editor">
                  <div className="tracker-panel__header">
                    <div>
                      <span className="field-label">
                        {editingAssessmentId ? 'Edit assessment' : 'New assessment'}
                      </span>
                      <p className="helper-text">Add due dates, notes, and a status for each class.</p>
                    </div>
                  </div>

              <div className="field-stack">
                <label className="field-label" htmlFor="tracker-assessment-class">
                  Class
                </label>
                <select
                  className="text-field"
                  id="tracker-assessment-class"
                  onChange={(event) =>
                    setAssessmentDraft((current) => ({
                      ...current,
                      classListId: event.target.value
                    }))
                  }
                  value={assessmentDraft.classListId}
                >
                  {controller.classLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-stack">
                <label className="field-label" htmlFor="tracker-assessment-title">
                  Assessment title
                </label>
                <input
                  className="text-field"
                  id="tracker-assessment-title"
                  onChange={(event) =>
                    setAssessmentDraft((current) => ({
                      ...current,
                      title: event.target.value
                    }))
                  }
                  placeholder="Semester test, oral presentation, essay..."
                  type="text"
                  value={assessmentDraft.title}
                />
              </div>

              <div className="tracker-form-row">
                <div className="field-stack">
                  <TrackerDateField
                    id="tracker-assessment-date"
                    label="Due date"
                    onChange={(dueDate) =>
                      setAssessmentDraft((current) => ({
                        ...current,
                        dueDate
                      }))
                    }
                    value={assessmentDraft.dueDate}
                  />
                </div>

                <div className="field-stack">
                  <label className="field-label" htmlFor="tracker-assessment-reminder">
                    Reminder
                  </label>
                  <select
                    className="text-field"
                    id="tracker-assessment-reminder"
                    onChange={(event) =>
                      setAssessmentDraft((current) => ({
                        ...current,
                        reminderDaysBefore: Number(event.target.value)
                      }))
                    }
                    value={assessmentDraft.reminderDaysBefore}
                  >
                    {TRACKER_REMINDER_OPTIONS.map((option) => (
                      <option key={`assessment-reminder-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-stack">
                  <label className="field-label" htmlFor="tracker-assessment-status">
                    Status
                  </label>
                  <select
                    className="text-field"
                    id="tracker-assessment-status"
                    onChange={(event) =>
                      setAssessmentDraft((current) => ({
                        ...current,
                        status: event.target.value as AssessmentTrackerStatus
                      }))
                    }
                    value={assessmentDraft.status}
                  >
                    {ASSESSMENT_TRACKER_STATUS_OPTIONS.map((option) => (
                      <option key={`assessment-status-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-stack">
                <label className="field-label" htmlFor="tracker-assessment-description">
                  Description
                </label>
                <textarea
                  className="text-area text-area--tracker"
                  id="tracker-assessment-description"
                  onChange={(event) =>
                    setAssessmentDraft((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                  placeholder="Add instructions, outcomes, marking notes, or preparation details."
                  value={assessmentDraft.description}
                />
              </div>

              <div className="action-row">
                <button className="primary-link" onClick={saveAssessment} type="button">
                  {editingAssessmentId ? 'Save assessment' : 'Add assessment'}
                </button>
                <button
                  className="secondary-link button-tone--utility"
                  onClick={() => resetAssessmentDraft()}
                  type="button"
                >
                  {editingAssessmentId ? 'Cancel edit' : 'Clear'}
                </button>
              </div>
            </section>

            <section className="tracker-panel tracker-panel--editor">
              <div className="tracker-panel__header">
                <div>
                  <span className="field-label">
                    {editingHomeworkId ? 'Edit homework' : 'New homework'}
                  </span>
                  <p className="helper-text">Track what has been set and what is due today.</p>
                </div>
              </div>

              <div className="field-stack">
                <label className="field-label" htmlFor="tracker-homework-class">
                  Class
                </label>
                <select
                  className="text-field"
                  id="tracker-homework-class"
                  onChange={(event) =>
                    setHomeworkDraft((current) => ({
                      ...current,
                      classListId: event.target.value
                    }))
                  }
                  value={homeworkDraft.classListId}
                >
                  {controller.classLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-stack">
                <label className="field-label" htmlFor="tracker-homework-title">
                  Homework title
                </label>
                <input
                  className="text-field"
                  id="tracker-homework-title"
                  onChange={(event) =>
                    setHomeworkDraft((current) => ({
                      ...current,
                      title: event.target.value
                    }))
                  }
                  placeholder="Worksheet 4, reading response, revision task..."
                  type="text"
                  value={homeworkDraft.title}
                />
              </div>

              <div className="tracker-form-row">
                <div className="field-stack">
                  <TrackerDateField
                    id="tracker-homework-date"
                    label="Due date"
                    onChange={(dueDate) =>
                      setHomeworkDraft((current) => ({
                        ...current,
                        dueDate
                      }))
                    }
                    value={homeworkDraft.dueDate}
                  />
                </div>

                <div className="field-stack">
                  <label className="field-label" htmlFor="tracker-homework-reminder">
                    Reminder
                  </label>
                  <select
                    className="text-field"
                    id="tracker-homework-reminder"
                    onChange={(event) =>
                      setHomeworkDraft((current) => ({
                        ...current,
                        reminderDaysBefore: Number(event.target.value)
                      }))
                    }
                    value={homeworkDraft.reminderDaysBefore}
                  >
                    {TRACKER_REMINDER_OPTIONS.map((option) => (
                      <option key={`homework-reminder-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-stack">
                  <label className="field-label" htmlFor="tracker-homework-status">
                    Status
                  </label>
                  <select
                    className="text-field"
                    id="tracker-homework-status"
                    onChange={(event) =>
                      setHomeworkDraft((current) => ({
                        ...current,
                        status: event.target.value as HomeworkTrackerStatus
                      }))
                    }
                    value={homeworkDraft.status}
                  >
                    {HOMEWORK_TRACKER_STATUS_OPTIONS.map((option) => (
                      <option key={`homework-status-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-stack">
                <label className="field-label" htmlFor="tracker-homework-description">
                  Description
                </label>
                <textarea
                  className="text-area text-area--tracker"
                  id="tracker-homework-description"
                  onChange={(event) =>
                    setHomeworkDraft((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                  placeholder="Add task notes, expected completion, or collection reminders."
                  value={homeworkDraft.description}
                />
              </div>

              <div className="action-row">
                <button className="primary-link" onClick={saveHomework} type="button">
                  {editingHomeworkId ? 'Save homework' : 'Add homework'}
                </button>
                <button
                  className="secondary-link button-tone--utility"
                  onClick={() => resetHomeworkDraft()}
                  type="button"
                >
                  {editingHomeworkId ? 'Cancel edit' : 'Clear'}
                </button>
              </div>
            </section>
          </div>

          <div className="tracker-editor-grid">
            <section className="tracker-panel">
              <div className="tracker-panel__header">
                <div>
                  <span className="field-label">Assessment log</span>
                  <p className="helper-text">Update status, due dates, and details as plans change.</p>
                </div>
                <span className="badge">{controller.assessments.length}</span>
              </div>

              {controller.assessments.length > 0 ? (
                <div className="tracker-record-list tracker-record-list--full">
                  {controller.assessments.map((item) => (
                    <TrackerItemCard
                      classLists={controller.classLists}
                      item={item}
                      key={item.id}
                      kind="assessment"
                      onDelete={() => {
                        controller.removeAssessment(item.id);
                        if (editingAssessmentId === item.id) {
                          resetAssessmentDraft();
                        }
                      }}
                      onEdit={() => {
                        setEditingAssessmentId(item.id);
                        setAssessmentDraft({
                          classListId: resolveTrackerDraftClassListId(
                            item.classListId ?? '',
                            controller.defaultClassListId,
                            controller.classLists
                          ),
                          description: item.description,
                          dueDate: item.dueDate,
                          reminderDaysBefore: item.reminderDaysBefore,
                          status: item.status,
                          title: item.title
                        });
                      }}
                      onStatusChange={(status) =>
                        controller.updateAssessmentStatus(item.id, status as AssessmentTrackerStatus)
                      }
                      todayKey={controller.todayKey}
                    />
                  ))}
                </div>
              ) : (
                <div className="group-maker__empty">
                  <p className="empty-copy">No assessments tracked yet.</p>
                </div>
              )}
            </section>

            <section className="tracker-panel">
              <div className="tracker-panel__header">
                <div>
                  <span className="field-label">Homework log</span>
                  <p className="helper-text">Keep due dates visible and move items through collection.</p>
                </div>
                <span className="badge">{controller.homework.length}</span>
              </div>

              {controller.homework.length > 0 ? (
                <div className="tracker-record-list tracker-record-list--full">
                  {controller.homework.map((item) => (
                    <TrackerItemCard
                      classLists={controller.classLists}
                      item={item}
                      key={item.id}
                      kind="homework"
                      onDelete={() => {
                        controller.removeHomework(item.id);
                        if (editingHomeworkId === item.id) {
                          resetHomeworkDraft();
                        }
                      }}
                      onEdit={() => {
                        setEditingHomeworkId(item.id);
                        setHomeworkDraft({
                          classListId: resolveTrackerDraftClassListId(
                            item.classListId ?? '',
                            controller.defaultClassListId,
                            controller.classLists
                          ),
                          description: item.description,
                          dueDate: item.dueDate,
                          reminderDaysBefore: item.reminderDaysBefore,
                          status: item.status,
                          title: item.title
                        });
                      }}
                      onStatusChange={(status) =>
                        controller.updateHomeworkStatus(item.id, status as HomeworkTrackerStatus)
                      }
                      todayKey={controller.todayKey}
                    />
                  ))}
                </div>
              ) : (
                <div className="group-maker__empty">
                  <p className="empty-copy">No homework tracked yet.</p>
                </div>
              )}
            </section>
          </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function TrackerDateField({
  id,
  label,
  onChange,
  value
}: {
  id: string;
  label: string;
  onChange: (dateKey: string) => void;
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => getMonthKeyFromDateKey(value));
  const selectedDate = normalizeDateKey(value) ?? getTodayDateKey();
  const calendarDays = buildCalendarDays(visibleMonth, selectedDate, new Set<string>());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setVisibleMonth(getMonthKeyFromDateKey(value));
    }
  }, [isOpen, value]);

  const openCalendar = () => {
    setVisibleMonth(getMonthKeyFromDateKey(value));
    setIsOpen((current) => !current);
  };

  return (
    <div className="tracker-date-field" ref={rootRef}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="tracker-date-field__control">
        <input
          className="text-field text-field--date tracker-date-field__input"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          type="date"
          value={value}
        />
        <button
          aria-expanded={isOpen}
          aria-label={`Choose ${label.toLowerCase()}`}
          className="widget-icon-button button-tone--utility tracker-date-field__button"
          onClick={openCalendar}
          type="button"
        >
          <CalendarIcon />
        </button>
      </div>

      {isOpen ? (
        <div className="tracker-date-picker" role="dialog" aria-label={`${label} calendar`}>
          <div className="tracker-date-picker__header">
            <button
              aria-label="Previous month"
              className="widget-icon-button button-tone--utility tracker-date-picker__month-button"
              onClick={() => setVisibleMonth((current) => shiftMonthKey(current, -1))}
              type="button"
            >
              &lt;
            </button>
            <span className="tracker-date-picker__month">{formatMonthLabel(visibleMonth)}</span>
            <button
              aria-label="Next month"
              className="widget-icon-button button-tone--utility tracker-date-picker__month-button"
              onClick={() => setVisibleMonth((current) => shiftMonthKey(current, 1))}
              type="button"
            >
              &gt;
            </button>
          </div>

          <div className="tracker-date-picker__weekdays" aria-hidden="true">
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
            <span>Sun</span>
          </div>

          <div className="tracker-date-picker__grid">
            {calendarDays.map((day) => (
              <button
                className={`tracker-date-picker__day ${
                  day.isCurrentMonth ? '' : 'tracker-date-picker__day--muted'
                } ${day.dateKey === selectedDate ? 'tracker-date-picker__day--selected' : ''} ${
                  day.isToday ? 'tracker-date-picker__day--today' : ''
                }`}
                key={`tracker-date-${id}-${day.dateKey}`}
                onClick={() => {
                  onChange(day.dateKey);
                  setIsOpen(false);
                }}
                type="button"
              >
                {day.day}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="calendar-icon" viewBox="0 0 16 16">
      <path d="M4 2.5v2M12 2.5v2M2.75 6.25h10.5M4 3.5h8A1.5 1.5 0 0 1 13.5 5v7A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5Z" />
    </svg>
  );
}

function TrackerItemCard({
  classLists,
  compact = false,
  item,
  kind,
  onDelete,
  onEdit,
  onStatusChange,
  todayKey
}: {
  classLists: ClassList[];
  compact?: boolean;
  item: AssessmentTrackerEntry | HomeworkTrackerEntry;
  kind: 'assessment' | 'homework';
  onDelete?: () => void;
  onEdit?: () => void;
  onStatusChange?: (status: AssessmentTrackerStatus | HomeworkTrackerStatus) => void;
  todayKey: string;
}) {
  const isAssessment = kind === 'assessment';
  const statusLabel = isAssessment
    ? getAssessmentTrackerStatusLabel(item.status as AssessmentTrackerStatus)
    : getHomeworkTrackerStatusLabel(item.status as HomeworkTrackerStatus);
  const reminderLabel = formatTrackerReminderBadgeLabel(
    item.dueDate,
    item.reminderDaysBefore,
    todayKey
  );
  const classLabel = getTrackerItemClassLabel(item, classLists);
  const dueContext = formatTrackerDueContextLabel(item.dueDate, todayKey);
  const isAlert = isTrackerItemOverdue(item.dueDate, todayKey) && item.status !== 'complete';
  const statusTone = getTrackerStatusTone(kind, item.status);

  return (
    <article
      className={`tracker-record ${compact ? 'tracker-record--compact' : ''} ${
        isAlert ? 'tracker-record--alert' : ''
      }`}
    >
      <div className="tracker-record__copy">
        <div className="tracker-record__title-row">
          <strong className="tracker-record__title">{item.title}</strong>
          <span className="tracker-record__date">{formatLongDate(item.dueDate)}</span>
        </div>

        <span className="tracker-record__meta">
          {classLabel} · {dueContext}
        </span>

        {!compact && item.description ? (
          <p className="tracker-record__description">{item.description}</p>
        ) : null}

        {!compact ? (
          <div className="pill-list">
            <span className={`pill tracker-status-pill tracker-status-pill--${statusTone}`}>
              {statusLabel}
            </span>
            {reminderLabel ? (
              <span className="pill tracker-status-pill tracker-status-pill--reminder">
                {reminderLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {!compact ? (
        <div className="tracker-record__actions">
          <select
            className="text-field tracker-record__status-select"
            onChange={(event) =>
              onStatusChange?.(event.target.value as AssessmentTrackerStatus | HomeworkTrackerStatus)
            }
            value={item.status}
          >
            {(isAssessment ? ASSESSMENT_TRACKER_STATUS_OPTIONS : HOMEWORK_TRACKER_STATUS_OPTIONS).map(
              (option) => (
                <option key={`${kind}-row-status-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              )
            )}
          </select>
          <div className="action-row tracker-record__button-row">
            <button
              className="secondary-link button-tone--utility"
              onClick={onEdit}
              type="button"
            >
              Edit
            </button>
            <button
              aria-label={`Delete ${item.title}`}
              className="note-row__delete tracker-record__delete"
              onClick={onDelete}
              type="button"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </article>
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
      {onOpenEditor ? (
        <div className="seating-chart__preview-actions widget-top-controls">
          <button
            aria-label="Open seating chart editor"
            className="primary-link"
            data-compact-icon="✎"
            onClick={onOpenEditor}
            type="button"
          >
            Open editor
          </button>
        </div>
      ) : null}

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
      if (activeDrag.targetSeatId !== targetSeatId) {
        activeDrag.targetSeatId = targetSeatId;
        setAssignmentTargetSeatId(targetSeatId);
      }
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
                            className={`text-toggle button-tone--utility ${
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
    const targetCellKey = targetCell ? getSeatingChartCellKey(targetCell.x, targetCell.y) : null;
    const currentCellKey = activeDrag.targetCell
      ? getSeatingChartCellKey(activeDrag.targetCell.x, activeDrag.targetCell.y)
      : null;

    if (targetCellKey === currentCellKey) {
      return;
    }

    activeDrag.targetCell = targetCell;
    setDragTargetCellKey(targetCellKey);
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
  const visibleUpcomingEntries = controller.upcomingEntries;
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
      <div className="bell-schedule__compact-toolbar widget-top-controls">
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
          <button
            aria-label={primaryActionLabel}
            className="secondary-link button-tone--utility"
            data-compact-icon={showEditor ? '✓' : '✎'}
            onClick={handlePrimaryAction}
            type="button"
          >
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
  const [addMenuDayKey, setAddMenuDayKey] = useState<BellScheduleDayKey | null>(null);
  const [timeEditorDayKey, setTimeEditorDayKey] = useState<BellScheduleDayKey | null>(null);

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
          const isAddMenuOpen = addMenuDayKey === dayKey;
          const isTimeEditorOpen = timeEditorDayKey === dayKey;

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
                <div className="bell-schedule-editor__day-actions">
                  <button
                    aria-label={`Add block to ${BELL_SCHEDULE_DAY_LABELS[dayKey]}`}
                    className="icon-button button-tone--utility"
                    onClick={() =>
                      setAddMenuDayKey((currentDayKey) =>
                        currentDayKey === dayKey ? null : dayKey
                      )
                    }
                    type="button"
                  >
                    +
                  </button>
                  <button
                    aria-label={`Remove last block from ${BELL_SCHEDULE_DAY_LABELS[dayKey]}`}
                    className="icon-button"
                    disabled={dayEntries.length === 0}
                    onClick={() => controller.removeDaySlot(dayKey)}
                    type="button"
                  >
                    -
                  </button>
                  <button
                    aria-label={`Edit ${BELL_SCHEDULE_DAY_LABELS[dayKey]} times`}
                    className={`icon-button button-tone--utility ${
                      isTimeEditorOpen ? 'icon-button--active' : ''
                    }`}
                    onClick={() =>
                      setTimeEditorDayKey((currentDayKey) =>
                        currentDayKey === dayKey ? null : dayKey
                      )
                    }
                    type="button"
                  >
                    ✎
                  </button>
                  {isAddMenuOpen ? (
                    <div className="bell-schedule-editor__add-menu">
                      <button
                        className="secondary-link button-tone--utility"
                        onClick={() => {
                          controller.addDaySlot(dayKey, 'teaching');
                          setAddMenuDayKey(null);
                        }}
                        type="button"
                      >
                        Lesson
                      </button>
                      <button
                        className="secondary-link"
                        onClick={() => {
                          controller.addDaySlot(dayKey, 'break');
                          setAddMenuDayKey(null);
                        }}
                        type="button"
                      >
                        Break
                      </button>
                    </div>
                  ) : null}
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
                        {isTimeEditorOpen ? (
                          <div className="bell-schedule-editor__time-row">
                            <label>
                              <span>Start</span>
                              <input
                                className="text-field"
                                onChange={(event) =>
                                  controller.updateDaySlotTime(
                                    dayKey,
                                    entry.definition.id,
                                    'startMinutes',
                                    event.target.value
                                  )
                                }
                                type="time"
                                value={formatBellTimeInputValue(entry.definition.startMinutes)}
                              />
                            </label>
                            <label>
                              <span>End</span>
                              <input
                                className="text-field"
                                onChange={(event) =>
                                  controller.updateDaySlotTime(
                                    dayKey,
                                    entry.definition.id,
                                    'endMinutes',
                                    event.target.value
                                  )
                                }
                                type="time"
                                value={formatBellTimeInputValue(entry.definition.endMinutes)}
                              />
                            </label>
                          </div>
                        ) : null}
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
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
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
      sizeTier={sizeTier}
      title={WIDGET_DETAILS.timer.title}
      widgetId="timer"
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
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
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
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['bell-schedule'].title}
      widgetId="bell-schedule"
    >
      <BellScheduleWidgetContent
        controller={bellSchedule}
        onToggleEditor={() => {
          if (showEditor) {
            bellSchedule.setPopoutMode('summary');
            returnToTeacherTools();
            return;
          }

          bellSchedule.setPopoutMode('editor');
        }}
        showEditor={showEditor}
      />
    </WidgetCard>
  );
}

function PickerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
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
      sizeTier={sizeTier}
      title={WIDGET_DETAILS.picker.title}
      widgetId="picker"
    >
      <PickerWidgetContent
        isPickerSpinning={picker.isPickerSpinning}
        onPick={picker.pickStudent}
        onResetCycle={picker.resetCurrentListCycle}
        onToggleRemovePickedStudents={picker.toggleRemovePickedStudents}
        pickerSpinnerView={picker.pickerSpinnerView}
        spinnerTrackRef={picker.spinnerTrackRef}
        recentPicks={picker.recentPicks}
        removePickedStudents={picker.picker.removePickedStudents}
        selectedStudentCount={picker.selectedStudents.length}
      />
    </WidgetCard>
  );
}

function GroupMakerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
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
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['group-maker'].title}
      widgetId="group-maker"
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
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
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
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['seating-chart'].title}
      widgetId="seating-chart"
    >
      <SeatingChartWidgetContent controller={seatingChart} mode="popout" />
    </WidgetCard>
  );
}

function PlannerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
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
      sizeTier={sizeTier}
      title={WIDGET_DETAILS.planner.title}
      widgetId="planner"
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

function HomeworkAssessmentTrackerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const [picker] = usePickerState();
  const tracker = useHomeworkAssessmentTrackerController(picker.selectedListId, picker.lists);
  const [popoutMode, setPopoutMode] = useHomeworkAssessmentPopoutModeState();

  return (
    <WidgetCard
      badge={tracker.badgeLabel}
      badgeTone={tracker.badgeTone}
      collapsed={false}
      description={tracker.summaryDescription}
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['homework-assessment'].title}
          widgetId="homework-assessment"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['homework-assessment'].title}
      widgetId="homework-assessment"
    >
      <HomeworkAssessmentTrackerWidgetContent
        controller={tracker}
        mode="popout"
        popoutMode={popoutMode}
        setPopoutMode={setPopoutMode}
      />
    </WidgetCard>
  );
}

function QrGeneratorWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const qrGenerator = useQrWidgetState();

  return (
    <WidgetCard
      badge={qrGenerator.preview.qrCode ? 'Ready' : null}
      collapsed={false}
      description="Paste a link and the QR code appears right here."
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['qr-generator'].title}
          widgetId="qr-generator"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['qr-generator'].title}
      widgetId="qr-generator"
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

function NotesWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
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
      sizeTier={sizeTier}
      title={WIDGET_DETAILS.notes.title}
      widgetId="notes"
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

function useColorModePreferencesState() {
  return usePersistentState<ColorModePreferences>(
    'teacher-tools.color-mode-preferences',
    DEFAULT_COLOR_MODE_PREFERENCES,
    {
      normalize: normalizeColorModePreferences
    }
  );
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

function useHomeworkAssessmentTrackerState() {
  return usePersistentState<HomeworkAssessmentTrackerSnapshot>(
    'teacher-tools.homework-assessment-tracker',
    DEFAULT_HOMEWORK_ASSESSMENT_TRACKER,
    {
      normalize: normalizeHomeworkAssessmentTrackerSnapshot
    }
  );
}

function useHomeworkAssessmentPopoutModeState() {
  return usePersistentState<HomeworkAssessmentPopoutMode>(
    'teacher-tools.homework-assessment-popout-mode',
    'editor',
    {
      normalize: normalizeHomeworkAssessmentPopoutMode
    }
  );
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
  const todayTeachingTimeline = todayTimeline.filter((entry) => entry.status === 'teaching');
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

  const addDaySlot = (dayKey: BellScheduleDayKey, kind: BellScheduleSlotKind) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? addBellScheduleDaySlot(current, current.activeProfileId, dayKey, kind)
        : current
    );
  };

  const removeDaySlot = (dayKey: BellScheduleDayKey) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? removeBellScheduleDaySlot(current, current.activeProfileId, dayKey)
        : current
    );
  };

  const updateDaySlotTime = (
    dayKey: BellScheduleDayKey,
    slotId: BellScheduleSlotId,
    edge: 'endMinutes' | 'startMinutes',
    value: string
  ) => {
    const minutes = parseBellTimeInputValue(value);

    if (minutes === null) {
      return;
    }

    setBellSchedule((current) =>
      current.activeProfileId
        ? updateBellScheduleDaySlotTimes(current, current.activeProfileId, dayKey, slotId, {
            [edge]: minutes
          })
        : current
    );
  };

  return {
    activeProfile,
    activeProfileDisplayName,
    addDaySlot,
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
    removeDaySlot,
    updateDaySlotTime,
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

function useAppUpdateState() {
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

function getAppUpdateButtonLabel(appUpdate: AppUpdateState) {
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

function getAppUpdateStatusLabel(appUpdate: AppUpdateState) {
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

function getAppUpdateStatusTone(appUpdate: AppUpdateState) {
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

function getAppUpdateTooltip(appUpdate: AppUpdateState) {
  const versionSummary = appUpdate.availableVersion
    ? ` Current v${appUpdate.currentVersion}. Update v${appUpdate.availableVersion}.`
    : ` Current v${appUpdate.currentVersion}.`;

  return `${appUpdate.message}${versionSummary}`;
}

function getAppUpdateActionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'The update action failed. Restart TeacherTools and try again.';
}

function useTimerWidgetState() {
  const [timer, setTimer] = usePersistentState<TimerSnapshot>('teacher-tools.timer', DEFAULT_TIMER, {
    normalize: normalizeTimerSnapshot
  });
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
      setTimer((current) =>
        current.endsAt === null
          ? current
          : {
              ...current,
              endsAt: null,
              pausedRemainingMs: 0,
              lastCompletedAt: Date.now()
            }
      );
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
      lastCompletionAcknowledgedAt: timer.lastCompletionAcknowledgedAt,
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
  const pickerSpinAnimationFrameRef = useRef<number | null>(null);
  const pickerSpinnerTrackRef = useRef<HTMLDivElement | null>(null);
  const pickerRenderedPositionRef = useRef(0);
  const [picker, setPicker] = usePickerState();
  const [isPickerSpinning, setIsPickerSpinning] = useState(false);
  const [spinnerPosition, setSpinnerPosition] = useState(0);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const selectedStudents = selectedList?.students ?? [];

  useEffect(() => {
    if (isPickerSpinning || !selectedStudents.length) {
      return;
    }

    if (picker.currentPick) {
      const nextIndex = selectedStudents.indexOf(picker.currentPick);
      if (nextIndex >= 0) {
        setSpinnerPosition(nextIndex);
        return;
      }
    }

    setSpinnerPosition(0);
  }, [isPickerSpinning, picker.currentPick, selectedStudents]);

  useEffect(() => {
    return () => {
      if (pickerSpinAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(pickerSpinAnimationFrameRef.current);
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
      ? getNormalizedPickerIndex(spinnerPosition, selectedStudents.length)
      : 0;
    const totalSteps = getPickerSpinStepCount(
      selectedStudents.length,
      normalizedSpinnerIndex,
      finalIndex
    );
    const spinDurationMs = getPickerSpinDuration(totalSteps);
    const startPosition = normalizedSpinnerIndex;
    const endPosition = normalizedSpinnerIndex + totalSteps;
    const selectedListId = selectedList.id;

    if (pickerSpinAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(pickerSpinAnimationFrameRef.current);
    }

    const syncSpinnerPosition = (nextPosition: number, shouldRender: boolean) => {
      pickerSpinnerTrackRef.current?.style.setProperty(
        '--picker-spinner-translate',
        `${getPickerSpinnerTranslatePercent(nextPosition - Math.floor(nextPosition))}%`
      );

      if (shouldRender) {
        pickerRenderedPositionRef.current = nextPosition;
        setSpinnerPosition(nextPosition);
      }
    };

    setIsPickerSpinning(true);
    syncSpinnerPosition(startPosition, true);

    const spinStartedAt = window.performance.now();

    const animatePickerSpin = (timestamp: number) => {
      const progress = Math.min((timestamp - spinStartedAt) / spinDurationMs, 1);
      const easedProgress = easeOutPickerSpin(progress);
      const nextPosition = startPosition + (endPosition - startPosition) * easedProgress;
      const nextBaseIndex = Math.floor(nextPosition);
      const nextActiveStep = Math.round(nextPosition - nextBaseIndex);
      const renderedBaseIndex = Math.floor(pickerRenderedPositionRef.current);
      const renderedActiveStep = Math.round(
        pickerRenderedPositionRef.current - renderedBaseIndex
      );

      syncSpinnerPosition(
        nextPosition,
        nextBaseIndex !== renderedBaseIndex || nextActiveStep !== renderedActiveStep
      );

      if (progress < 1) {
        pickerSpinAnimationFrameRef.current = window.requestAnimationFrame(animatePickerSpin);
        return;
      }

      pickerSpinAnimationFrameRef.current = null;

      syncSpinnerPosition(finalIndex, true);
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
    };

    pickerSpinAnimationFrameRef.current = window.requestAnimationFrame(animatePickerSpin);
  };

  return {
    isPickerSpinning,
    pickStudent,
    picker,
    pickerSpinnerView: buildPickerSpinnerView({
      currentPick: picker.currentPick,
      isSpinning: isPickerSpinning,
      names: selectedStudents,
      spinnerPosition
    }),
    recentPicks: picker.recentPicks.slice(0, 4),
    resetCurrentListCycle,
    rosterCount: selectedStudents.length,
    selectedList,
    selectedStudents,
    spinnerTrackRef: pickerSpinnerTrackRef,
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
          : null,
    makeGroups,
    selectedList,
    selectedStudents,
    updateGroupSize
  };
}

function useQrWidgetState() {
  const [linkDraft, setLinkDraft] = usePersistentState<string>('teacher-tools.qr-link-draft', '');

  return {
    clearLink: () => setLinkDraft(''),
    linkDraft,
    preview: getQrWidgetPreviewState(linkDraft),
    setLinkDraft
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

function useHomeworkAssessmentTrackerController(
  selectedListId: string | null,
  classLists: ClassList[]
) {
  const [tracker, setTracker] = useHomeworkAssessmentTrackerState();
  const todayKey = getTodayDateKey();
  const defaultClassListId = getTrackerDefaultClassListId(selectedListId, classLists);
  const assessments = [...tracker.assessments].sort((left, right) =>
    compareTrackerEntries(left, right, todayKey)
  );
  const homework = [...tracker.homework].sort((left, right) =>
    compareTrackerEntries(left, right, todayKey)
  );
  const upcomingAssessments = assessments
    .filter((entry) => !isTrackerItemComplete(entry.status) && getDaysUntilDateKey(todayKey, entry.dueDate) >= 0)
    .slice(0, 3);
  const homeworkDueToday = homework.filter(
    (entry) => !isTrackerItemComplete(entry.status) && entry.dueDate === todayKey
  );
  const reminderItems = [...assessments, ...homework].filter(
    (entry) =>
      !isTrackerItemComplete(entry.status) &&
      isTrackerReminderDueToday(entry.dueDate, entry.reminderDaysBefore, todayKey)
  );
  const overdueCount = [...assessments, ...homework].filter(
    (entry) =>
      !isTrackerItemComplete(entry.status) && isTrackerItemOverdue(entry.dueDate, todayKey)
  ).length;
  const dueTodayCount =
    assessments.filter((entry) => !isTrackerItemComplete(entry.status) && entry.dueDate === todayKey)
      .length + homeworkDueToday.length;
  const reminderCount = reminderItems.length;
  const totalTrackedCount = assessments.length + homework.length;
  const badgeLabel =
    overdueCount > 0
      ? `${overdueCount} overdue`
      : dueTodayCount > 0
        ? `${dueTodayCount} today`
        : reminderCount > 0
          ? `${reminderCount} reminder${reminderCount === 1 ? '' : 's'}`
          : totalTrackedCount > 0
            ? `${totalTrackedCount} items`
            : null;
  const summaryDescription =
    totalTrackedCount === 0
      ? 'Track due dates, status, and reminders across classes.'
      : `${upcomingAssessments.length} assessment${upcomingAssessments.length === 1 ? '' : 's'} coming up, ${
          homeworkDueToday.length
        } homework due today.`;

  const addAssessment = (entry: Omit<AssessmentTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>) => {
    const normalizedEntry = createAssessmentTrackerEntry(entry, classLists);
    if (!normalizedEntry) {
      return;
    }

    setTracker((current) => ({
      ...current,
      assessments: [normalizedEntry, ...current.assessments]
    }));
  };

  const updateAssessment = (
    assessmentId: string,
    entry: Omit<AssessmentTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>
  ) => {
    setTracker((current) => ({
      ...current,
      assessments: current.assessments.map((assessment) =>
        assessment.id === assessmentId
          ? createAssessmentTrackerEntry(entry, classLists, assessmentId, assessment.updatedAt) ??
            assessment
          : assessment
      )
    }));
  };

  const updateAssessmentStatus = (assessmentId: string, status: AssessmentTrackerStatus) => {
    setTracker((current) => ({
      ...current,
      assessments: current.assessments.map((assessment) =>
        assessment.id === assessmentId
          ? {
              ...assessment,
              status,
              updatedAt: Date.now()
            }
          : assessment
      )
    }));
  };

  const removeAssessment = (assessmentId: string) => {
    setTracker((current) => ({
      ...current,
      assessments: current.assessments.filter((assessment) => assessment.id !== assessmentId)
    }));
  };

  const addHomework = (entry: Omit<HomeworkTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>) => {
    const normalizedEntry = createHomeworkTrackerEntry(entry, classLists);
    if (!normalizedEntry) {
      return;
    }

    setTracker((current) => ({
      ...current,
      homework: [normalizedEntry, ...current.homework]
    }));
  };

  const updateHomework = (
    homeworkId: string,
    entry: Omit<HomeworkTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>
  ) => {
    setTracker((current) => ({
      ...current,
      homework: current.homework.map((homeworkEntry) =>
        homeworkEntry.id === homeworkId
          ? createHomeworkTrackerEntry(entry, classLists, homeworkId, homeworkEntry.updatedAt) ??
            homeworkEntry
          : homeworkEntry
      )
    }));
  };

  const updateHomeworkStatus = (homeworkId: string, status: HomeworkTrackerStatus) => {
    setTracker((current) => ({
      ...current,
      homework: current.homework.map((homeworkEntry) =>
        homeworkEntry.id === homeworkId
          ? {
              ...homeworkEntry,
              status,
              updatedAt: Date.now()
            }
          : homeworkEntry
      )
    }));
  };

  const removeHomework = (homeworkId: string) => {
    setTracker((current) => ({
      ...current,
      homework: current.homework.filter((homeworkEntry) => homeworkEntry.id !== homeworkId),
      homeworkCompletionsByHomeworkId: Object.fromEntries(
        Object.entries(current.homeworkCompletionsByHomeworkId).filter(([id]) => id !== homeworkId)
      )
    }));
  };

  const toggleHomeworkCompletion = (
    homeworkId: string,
    studentName: string,
    completed: boolean
  ) => {
    const normalizedStudentName = studentName.trim();
    if (!normalizedStudentName) {
      return;
    }

    setTracker((current) => {
      const currentNames = current.homeworkCompletionsByHomeworkId[homeworkId] ?? [];
      const currentNameSet = new Set(currentNames);

      if (completed) {
        currentNameSet.add(normalizedStudentName);
      } else {
        currentNameSet.delete(normalizedStudentName);
      }

      const nextCompletions = {
        ...current.homeworkCompletionsByHomeworkId,
        [homeworkId]: Array.from(currentNameSet)
      };

      if (nextCompletions[homeworkId].length === 0) {
        delete nextCompletions[homeworkId];
      }

      return {
        ...current,
        homeworkCompletionsByHomeworkId: nextCompletions
      };
    });
  };

  return {
    addAssessment,
    addHomework,
    assessments,
    badgeLabel,
    badgeTone:
      overdueCount > 0 || dueTodayCount > 0 ? ('alert' as const) : ('default' as const),
    classLists,
    defaultClassListId,
    dueTodayCount,
    homework,
    homeworkDueToday,
    overdueCount,
    reminderCount,
    reminderItems,
    removeAssessment,
    removeHomework,
    summaryDescription,
    todayKey,
    toggleHomeworkCompletion,
    tracker,
    upcomingAssessments,
    updateAssessment,
    updateAssessmentStatus,
    updateHomework,
    updateHomeworkStatus
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

function normalizeHomeworkAssessmentPopoutMode(
  raw: unknown,
  initialValue: HomeworkAssessmentPopoutMode
) {
  return raw === 'editor' || raw === 'completion' ? raw : initialValue;
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

function formatBellTimeInputValue(minutes: number) {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60)
    .toString()
    .padStart(2, '0')}`;
}

function parseBellTimeInputValue(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
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

function getBellScheduleDefaultSlotDefinitions() {
  return BELL_SCHEDULE_SLOT_DEFINITIONS.map((slot) => ({ ...slot }));
}

function getBellScheduleDaySlotDefinitions(day: BellScheduleDay) {
  return day.slotDefinitions.length > 0
    ? day.slotDefinitions
    : getBellScheduleDefaultSlotDefinitions();
}

function createBellScheduleDay(source?: BellScheduleDay): BellScheduleDay {
  const assignmentsBySlotId: Partial<Record<BellScheduleSlotId, BellScheduleSlotAssignment>> = {};
  const slotDefinitions = source
    ? getBellScheduleDaySlotDefinitions(source).map((slot) => ({ ...slot }))
    : getBellScheduleDefaultSlotDefinitions();

  slotDefinitions.forEach((slot) => {
    if (slot.kind !== 'teaching') {
      return;
    }

    assignmentsBySlotId[slot.id] = normalizeBellScheduleSlotAssignment(
      source?.assignmentsBySlotId[slot.id],
      getDefaultBellScheduleSlotAssignment()
    );
  });

  return {
    assignmentsBySlotId,
    slotDefinitions
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
  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const slotDefinition = getBellScheduleDaySlotDefinitions(profile.days[dayKey]).find(
        (slot) => slot.id === slotId
      );

      if (!slotDefinition || slotDefinition.kind !== 'teaching') {
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

function getNextBellScheduleTeachingPeriodNumber(slotDefinitions: BellScheduleSlotDefinition[]) {
  const numbers = slotDefinitions
    .filter((slot) => slot.kind === 'teaching')
    .map((slot) => /^Period\s+(\d+)$/i.exec(slot.label.trim())?.[1])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function createBellScheduleSlotDefinition(
  slotDefinitions: BellScheduleSlotDefinition[],
  kind: BellScheduleSlotKind
): BellScheduleSlotDefinition {
  const previousSlot = slotDefinitions[slotDefinitions.length - 1] ?? null;
  const startMinutes = previousSlot ? previousSlot.endMinutes : 8 * 60 + 45;
  const durationMinutes = kind === 'teaching' ? 60 : 20;
  const endMinutes = Math.min(startMinutes + durationMinutes, 24 * 60 - 1);

  if (kind === 'teaching') {
    const periodNumber = getNextBellScheduleTeachingPeriodNumber(slotDefinitions);

    return {
      endMinutes,
      id: `period-${periodNumber}-${createStickyNoteId()}`,
      kind,
      label: `Period ${periodNumber}`,
      shortLabel: `P${periodNumber}`,
      startMinutes
    };
  }

  const breakCount = slotDefinitions.filter((slot) => slot.kind === 'break').length + 1;
  const label = breakCount === 1 ? 'Break' : `Break ${breakCount}`;

  return {
    endMinutes,
    id: `break-${breakCount}-${createStickyNoteId()}`,
    kind,
    label,
    shortLabel: breakCount === 1 ? 'Break' : `B${breakCount}`,
    startMinutes
  };
}

function addBellScheduleDaySlot(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  dayKey: BellScheduleDayKey,
  kind: BellScheduleSlotKind
) {
  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const day = profile.days[dayKey];
      const slotDefinitions = getBellScheduleDaySlotDefinitions(day);
      const nextSlot = createBellScheduleSlotDefinition(slotDefinitions, kind);
      const assignmentsBySlotId = {
        ...day.assignmentsBySlotId
      };

      if (nextSlot.kind === 'teaching') {
        assignmentsBySlotId[nextSlot.id] = getDefaultBellScheduleSlotAssignment();
      }

      return {
        ...profile,
        days: {
          ...profile.days,
          [dayKey]: {
            assignmentsBySlotId,
            slotDefinitions: [...slotDefinitions, nextSlot]
          }
        }
      };
    })
  };
}

function removeBellScheduleDaySlot(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  dayKey: BellScheduleDayKey
) {
  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const day = profile.days[dayKey];
      const slotDefinitions = getBellScheduleDaySlotDefinitions(day);

      if (slotDefinitions.length === 0) {
        return profile;
      }

      const nextSlotDefinitions = slotDefinitions.slice(0, -1);
      const removedSlot = slotDefinitions[slotDefinitions.length - 1];
      const assignmentsBySlotId = { ...day.assignmentsBySlotId };

      delete assignmentsBySlotId[removedSlot.id];

      return {
        ...profile,
        days: {
          ...profile.days,
          [dayKey]: {
            assignmentsBySlotId,
            slotDefinitions: nextSlotDefinitions
          }
        }
      };
    })
  };
}

function updateBellScheduleDaySlotTimes(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  dayKey: BellScheduleDayKey,
  slotId: BellScheduleSlotId,
  times: Partial<Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>>
) {
  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const day = profile.days[dayKey];

      return {
        ...profile,
        days: {
          ...profile.days,
          [dayKey]: {
            ...day,
            slotDefinitions: getBellScheduleDaySlotDefinitions(day).map((slot) =>
              slot.id === slotId
                ? {
                    ...slot,
                    ...times
                  }
                : slot
            )
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
  const slotDefinitions = getBellScheduleDaySlotDefinitions(profile.days[dayKey]);

  return slotDefinitions.map((definition) => {
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

const SCHOOL_TERMS = [
  { end: { day: 2, monthIndex: 3 }, start: { day: 2, monthIndex: 1 }, term: 1 },
  { end: { day: 3, monthIndex: 6 }, start: { day: 20, monthIndex: 3 }, term: 2 },
  { end: { day: 25, monthIndex: 8 }, start: { day: 20, monthIndex: 6 }, term: 3 },
  { end: { day: 17, monthIndex: 11 }, start: { day: 12, monthIndex: 9 }, term: 4 }
] as const;

function getDateUtcDayValue(year: number, monthIndex: number, day: number) {
  return Date.UTC(year, monthIndex, day) / (24 * 60 * 60 * 1000);
}

function getSchoolTermWeek(date: Date) {
  const year = date.getFullYear();
  const todayDayValue = getDateUtcDayValue(year, date.getMonth(), date.getDate());

  for (const schoolTerm of SCHOOL_TERMS) {
    const startDayValue = getDateUtcDayValue(
      year,
      schoolTerm.start.monthIndex,
      schoolTerm.start.day
    );
    const endDayValue = getDateUtcDayValue(year, schoolTerm.end.monthIndex, schoolTerm.end.day);

    if (todayDayValue >= startDayValue && todayDayValue <= endDayValue) {
      return {
        term: schoolTerm.term,
        week: Math.floor((todayDayValue - startDayValue) / 7) + 1
      };
    }
  }

  return null;
}

function formatSchoolDateLabel(date: Date) {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  const schoolTermWeek = getSchoolTermWeek(date);

  if (!schoolTermWeek) {
    return `${weekday}, School holidays`;
  }

  return `${weekday}, Week ${schoolTermWeek.week}, Term ${schoolTermWeek.term}`;
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

function createAssessmentTrackerDraft(defaultClassListId: string): AssessmentTrackerDraft {
  return {
    classListId: defaultClassListId,
    description: '',
    dueDate: shiftDateKey(getTodayDateKey(), 7),
    reminderDaysBefore: 7,
    status: 'planned',
    title: ''
  };
}

function createHomeworkTrackerDraft(defaultClassListId: string): HomeworkTrackerDraft {
  return {
    classListId: defaultClassListId,
    description: '',
    dueDate: getTodayDateKey(),
    reminderDaysBefore: 0,
    status: 'set',
    title: ''
  };
}

function getTrackerDefaultClassListId(selectedListId: string | null, classLists: ClassList[]) {
  if (selectedListId && classLists.some((list) => list.id === selectedListId)) {
    return selectedListId;
  }

  return classLists[0]?.id ?? '';
}

function resolveTrackerDraftClassListId(
  classListId: string,
  fallbackClassListId: string,
  classLists: ClassList[]
) {
  if (classListId && classLists.some((list) => list.id === classListId)) {
    return classListId;
  }

  if (fallbackClassListId && classLists.some((list) => list.id === fallbackClassListId)) {
    return fallbackClassListId;
  }

  return classLists[0]?.id ?? '';
}

function shiftDateKey(dateKey: string, deltaDays: number) {
  const parsed = parseDateKey(dateKey) ?? parseDateKey(getTodayDateKey());
  if (!parsed) {
    return getTodayDateKey();
  }

  const nextDate = new Date(parsed.year, parsed.monthIndex, parsed.day + deltaDays);
  return formatDateKey(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
}

function getDaysUntilDateKey(fromDateKey: string, toDateKey: string) {
  const fromParsed = parseDateKey(fromDateKey);
  const toParsed = parseDateKey(toDateKey);

  if (!fromParsed || !toParsed) {
    return Number.POSITIVE_INFINITY;
  }

  const fromDate = new Date(fromParsed.year, fromParsed.monthIndex, fromParsed.day);
  const toDate = new Date(toParsed.year, toParsed.monthIndex, toParsed.day);
  return Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
}

function isTrackerItemComplete(status: string) {
  return status === 'complete';
}

function isTrackerItemOverdue(dueDate: string, todayKey: string) {
  return getDaysUntilDateKey(todayKey, dueDate) < 0;
}

function isTrackerReminderDueToday(
  dueDate: string,
  reminderDaysBefore: number,
  todayKey: string
) {
  if (reminderDaysBefore <= 0) {
    return false;
  }

  return getDaysUntilDateKey(todayKey, dueDate) === reminderDaysBefore;
}

function getTrackerItemClassLabel(
  item: Pick<HomeworkAssessmentEntryBase, 'classLabel' | 'classListId'>,
  classLists: ClassList[]
) {
  const activeList =
    item.classListId !== null ? classLists.find((list) => list.id === item.classListId) ?? null : null;

  return activeList?.name ?? (item.classLabel.trim() || 'Class not set');
}

function formatTrackerDueContextLabel(dueDate: string, todayKey: string) {
  const dayDelta = getDaysUntilDateKey(todayKey, dueDate);

  if (!Number.isFinite(dayDelta)) {
    return formatLongDate(dueDate);
  }

  if (dayDelta < 0) {
    const overdueDays = Math.abs(dayDelta);
    return `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`;
  }

  if (dayDelta === 0) {
    return 'Due today';
  }

  if (dayDelta === 1) {
    return 'Due tomorrow';
  }

  return `Due in ${dayDelta} days`;
}

function formatTrackerReminderBadgeLabel(
  dueDate: string,
  reminderDaysBefore: number,
  todayKey: string
) {
  if (reminderDaysBefore <= 0) {
    return null;
  }

  const dayDelta = getDaysUntilDateKey(todayKey, dueDate);
  if (!Number.isFinite(dayDelta) || dayDelta < 0) {
    return null;
  }

  if (dayDelta === reminderDaysBefore) {
    return 'Reminder today';
  }

  if (dayDelta < reminderDaysBefore) {
    return 'Reminder active';
  }

  return null;
}

function getAssessmentTrackerStatusLabel(status: AssessmentTrackerStatus) {
  switch (status) {
    case 'planned':
      return 'Planned';
    case 'set':
      return 'Set';
    case 'marking':
      return 'Marking';
    case 'complete':
      return 'Complete';
    default:
      return status;
  }
}

function getHomeworkTrackerStatusLabel(status: HomeworkTrackerStatus) {
  switch (status) {
    case 'set':
      return 'Set';
    case 'collecting':
      return 'Collecting';
    case 'reviewed':
      return 'Reviewed';
    case 'complete':
      return 'Complete';
    default:
      return status;
  }
}

function getTrackerStatusTone(
  kind: 'assessment' | 'homework',
  status: AssessmentTrackerStatus | HomeworkTrackerStatus
) {
  if (status === 'complete') {
    return 'complete';
  }

  if (kind === 'assessment') {
    if (status === 'marking') {
      return 'warning';
    }

    if (status === 'set') {
      return 'active';
    }

    return 'default';
  }

  if (status === 'collecting') {
    return 'warning';
  }

  if (status === 'set') {
    return 'active';
  }

  return 'default';
}

function compareTrackerEntries(
  left: Pick<HomeworkAssessmentEntryBase, 'dueDate' | 'updatedAt'> & { status: string },
  right: Pick<HomeworkAssessmentEntryBase, 'dueDate' | 'updatedAt'> & { status: string },
  todayKey: string
) {
  const leftComplete = isTrackerItemComplete(left.status);
  const rightComplete = isTrackerItemComplete(right.status);

  if (leftComplete !== rightComplete) {
    return Number(leftComplete) - Number(rightComplete);
  }

  const leftDayDelta = getDaysUntilDateKey(todayKey, left.dueDate);
  const rightDayDelta = getDaysUntilDateKey(todayKey, right.dueDate);

  if (leftDayDelta !== rightDayDelta) {
    return leftDayDelta - rightDayDelta;
  }

  return right.updatedAt - left.updatedAt;
}

function createAssessmentTrackerEntry(
  entry: Omit<AssessmentTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>,
  classLists: ClassList[],
  entryId = createStickyNoteId(),
  _previousUpdatedAt?: number
) {
  const dueDate = normalizeDateKey(entry.dueDate);
  if (!dueDate || !entry.title.trim()) {
    return null;
  }

  return {
    classLabel: getTrackerItemClassLabel(
      {
        classLabel: '',
        classListId: entry.classListId
      },
      classLists
    ),
    classListId: entry.classListId,
    description: entry.description.trim(),
    dueDate,
    id: entryId,
    reminderDaysBefore: Math.max(0, Math.round(entry.reminderDaysBefore)),
    status: entry.status,
    title: entry.title.trim(),
    updatedAt: Date.now()
  } satisfies AssessmentTrackerEntry;
}

function createHomeworkTrackerEntry(
  entry: Omit<HomeworkTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>,
  classLists: ClassList[],
  entryId = createStickyNoteId(),
  _previousUpdatedAt?: number
) {
  const dueDate = normalizeDateKey(entry.dueDate);
  if (!dueDate || !entry.title.trim()) {
    return null;
  }

  return {
    classLabel: getTrackerItemClassLabel(
      {
        classLabel: '',
        classListId: entry.classListId
      },
      classLists
    ),
    classListId: entry.classListId,
    description: entry.description.trim(),
    dueDate,
    id: entryId,
    reminderDaysBefore: Math.max(0, Math.round(entry.reminderDaysBefore)),
    status: entry.status,
    title: entry.title.trim(),
    updatedAt: Date.now()
  } satisfies HomeworkTrackerEntry;
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

function normalizeHomeworkAssessmentTrackerSnapshot(
  raw: unknown,
  initialValue: HomeworkAssessmentTrackerSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    assessments?: unknown[];
    homework?: unknown[];
    homeworkCompletionsByHomeworkId?: Record<string, unknown>;
  };
  const homework = Array.isArray(nextRaw.homework)
    ? nextRaw.homework
        .map((entry) => normalizeHomeworkTrackerEntry(entry))
        .filter((entry): entry is HomeworkTrackerEntry => entry !== null)
    : initialValue.homework;
  const homeworkIds = new Set(homework.map((entry) => entry.id));

  return {
    assessments: Array.isArray(nextRaw.assessments)
      ? nextRaw.assessments
          .map((entry) => normalizeAssessmentTrackerEntry(entry))
          .filter((entry): entry is AssessmentTrackerEntry => entry !== null)
      : initialValue.assessments,
    homework,
    homeworkCompletionsByHomeworkId: normalizeHomeworkCompletionMap(
      nextRaw.homeworkCompletionsByHomeworkId,
      homeworkIds
    )
  };
}

function normalizeHomeworkCompletionMap(
  raw: unknown,
  homeworkIds: Set<string>
): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const completionsByHomeworkId: Record<string, string[]> = {};

  for (const [homeworkId, studentNamesRaw] of Object.entries(raw)) {
    if (!homeworkIds.has(homeworkId) || !Array.isArray(studentNamesRaw)) {
      continue;
    }

    const studentNames = Array.from(
      new Set(
        studentNamesRaw
          .filter((studentName): studentName is string => typeof studentName === 'string')
          .map((studentName) => studentName.trim())
          .filter(Boolean)
      )
    );

    if (studentNames.length > 0) {
      completionsByHomeworkId[homeworkId] = studentNames;
    }
  }

  return completionsByHomeworkId;
}

function normalizeAssessmentTrackerEntry(raw: unknown): AssessmentTrackerEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as Partial<AssessmentTrackerEntry>;
  const dueDate = typeof nextRaw.dueDate === 'string' ? normalizeDateKey(nextRaw.dueDate) : null;
  const title = typeof nextRaw.title === 'string' ? nextRaw.title.trim() : '';

  if (!dueDate || !title || typeof nextRaw.id !== 'string' || !nextRaw.id.trim()) {
    return null;
  }

  return {
    classLabel: typeof nextRaw.classLabel === 'string' ? nextRaw.classLabel : '',
    classListId: typeof nextRaw.classListId === 'string' ? nextRaw.classListId : null,
    description: typeof nextRaw.description === 'string' ? nextRaw.description : '',
    dueDate,
    id: nextRaw.id,
    reminderDaysBefore:
      typeof nextRaw.reminderDaysBefore === 'number' && Number.isFinite(nextRaw.reminderDaysBefore)
        ? Math.max(0, Math.round(nextRaw.reminderDaysBefore))
        : 0,
    status: isAssessmentTrackerStatus(nextRaw.status) ? nextRaw.status : 'planned',
    title,
    updatedAt:
      typeof nextRaw.updatedAt === 'number' && Number.isFinite(nextRaw.updatedAt)
        ? nextRaw.updatedAt
        : Date.now()
  };
}

function normalizeHomeworkTrackerEntry(raw: unknown): HomeworkTrackerEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as Partial<HomeworkTrackerEntry>;
  const dueDate = typeof nextRaw.dueDate === 'string' ? normalizeDateKey(nextRaw.dueDate) : null;
  const title = typeof nextRaw.title === 'string' ? nextRaw.title.trim() : '';

  if (!dueDate || !title || typeof nextRaw.id !== 'string' || !nextRaw.id.trim()) {
    return null;
  }

  return {
    classLabel: typeof nextRaw.classLabel === 'string' ? nextRaw.classLabel : '',
    classListId: typeof nextRaw.classListId === 'string' ? nextRaw.classListId : null,
    description: typeof nextRaw.description === 'string' ? nextRaw.description : '',
    dueDate,
    id: nextRaw.id,
    reminderDaysBefore:
      typeof nextRaw.reminderDaysBefore === 'number' && Number.isFinite(nextRaw.reminderDaysBefore)
        ? Math.max(0, Math.round(nextRaw.reminderDaysBefore))
        : 0,
    status: isHomeworkTrackerStatus(nextRaw.status) ? nextRaw.status : 'set',
    title,
    updatedAt:
      typeof nextRaw.updatedAt === 'number' && Number.isFinite(nextRaw.updatedAt)
        ? nextRaw.updatedAt
        : Date.now()
  };
}

function isAssessmentTrackerStatus(value: unknown): value is AssessmentTrackerStatus {
  return value === 'planned' || value === 'set' || value === 'marking' || value === 'complete';
}

function isHomeworkTrackerStatus(value: unknown): value is HomeworkTrackerStatus {
  return (
    value === 'set' ||
    value === 'collecting' ||
    value === 'reviewed' ||
    value === 'complete'
  );
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
    return 'button-tone--utility';
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
  const slotDefinitions = Array.isArray(nextRaw.slotDefinitions)
    ? nextRaw.slotDefinitions
        .map((slot) => normalizeBellScheduleSlotDefinition(slot))
        .filter((slot): slot is BellScheduleSlotDefinition => slot !== null)
    : getBellScheduleDefaultSlotDefinitions();
  const nextSlotDefinitions =
    slotDefinitions.length > 0 ? slotDefinitions : getBellScheduleDefaultSlotDefinitions();

  nextSlotDefinitions.forEach((slot) => {
    if (slot.kind !== 'teaching') {
      return;
    }

    assignmentsBySlotId[slot.id] = normalizeBellScheduleSlotAssignment(
      assignmentsRaw[slot.id] ?? nextRaw[slot.id],
      getDefaultBellScheduleSlotAssignment()
    );
  });

  return {
    assignmentsBySlotId,
    slotDefinitions: nextSlotDefinitions
  };
}

function normalizeBellScheduleSlotDefinition(raw: unknown): BellScheduleSlotDefinition | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    endMinutes?: unknown;
    id?: unknown;
    kind?: unknown;
    label?: unknown;
    shortLabel?: unknown;
    startMinutes?: unknown;
  };
  const startMinutes =
    typeof nextRaw.startMinutes === 'number'
      ? Math.round(clampNumber(nextRaw.startMinutes, 0, 24 * 60 - 1))
      : null;
  const endMinutes =
    typeof nextRaw.endMinutes === 'number'
      ? Math.round(clampNumber(nextRaw.endMinutes, 0, 24 * 60 - 1))
      : null;

  if (
    typeof nextRaw.id !== 'string' ||
    !nextRaw.id.trim() ||
    (nextRaw.kind !== 'break' && nextRaw.kind !== 'teaching') ||
    typeof nextRaw.label !== 'string' ||
    !nextRaw.label.trim() ||
    startMinutes === null ||
    endMinutes === null
  ) {
    return null;
  }

  return {
    endMinutes,
    id: nextRaw.id,
    kind: nextRaw.kind,
    label: nextRaw.label,
    shortLabel:
      typeof nextRaw.shortLabel === 'string' && nextRaw.shortLabel.trim()
        ? nextRaw.shortLabel
        : nextRaw.label,
    startMinutes
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

function normalizeColorModePreferences(raw: unknown, initialValue: ColorModePreferences) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    backgroundColorId?: unknown;
    widgetColorsByWidgetId?: Record<string, unknown>;
  };
  const rawWidgetColors =
    nextRaw.widgetColorsByWidgetId && typeof nextRaw.widgetColorsByWidgetId === 'object'
      ? nextRaw.widgetColorsByWidgetId
      : null;
  const widgetColorsByWidgetId = {} as Record<WidgetId, ColorModeSwatchId>;

  for (const widgetId of WIDGET_IDS) {
    const rawSwatchId = rawWidgetColors?.[widgetId];
    widgetColorsByWidgetId[widgetId] =
      typeof rawSwatchId === 'string' && isColorModeSwatchId(rawSwatchId)
        ? rawSwatchId
        : initialValue.widgetColorsByWidgetId[widgetId];
  }

  return {
    backgroundColorId:
      typeof nextRaw.backgroundColorId === 'string' && isColorModeSwatchId(nextRaw.backgroundColorId)
        ? nextRaw.backgroundColorId
        : initialValue.backgroundColorId,
    widgetColorsByWidgetId
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

function computeDashboardMetrics(containerWidth: number, containerHeight: number): DashboardMetrics {
  const safeWidth = Math.max(containerWidth, DASHBOARD_SINGLE_MIN_WIDTH);
  const maxColumnCount = Math.max(
    1,
    Math.floor((safeWidth + DASHBOARD_COLUMN_GAP) / (DASHBOARD_SINGLE_MIN_WIDTH + DASHBOARD_COLUMN_GAP))
  );
  const targetColumnCount = Math.max(
    1,
    Math.ceil((safeWidth + DASHBOARD_COLUMN_GAP) / (DASHBOARD_SINGLE_MAX_WIDTH + DASHBOARD_COLUMN_GAP))
  );
  const columnCount = clampNumber(targetColumnCount, 1, maxColumnCount);

  return {
    columnCount,
    gap: DASHBOARD_COLUMN_GAP,
    height: Math.max(0, Math.floor(containerHeight))
  };
}

function buildDashboardColumns({
  collapsedWidgetIds,
  columnCount,
  widgetSizeTiers,
  widgetIds
}: {
  collapsedWidgetIds: WidgetId[];
  columnCount: number;
  widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>>;
  widgetIds: WidgetId[];
}) {
  if (widgetIds.length === 0) {
    return [];
  }

  const normalizedColumnCount = Math.max(1, columnCount);
  const widgetOrderIndex = new Map(widgetIds.map((widgetId, index) => [widgetId, index]));
  const widgets = widgetIds
    .map((widgetId, originalIndex) => {
      return {
        height: getWidgetDashboardHeight(
          widgetId,
          widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX,
          collapsedWidgetIds.includes(widgetId)
        ),
        id: widgetId,
        originalIndex
      };
    })
    .sort((left, right) => {
      if (right.height !== left.height) {
        return right.height - left.height;
      }

      return left.originalIndex - right.originalIndex;
    });
  const columns: Array<
    DashboardColumn & {
      estimatedHeight: number;
    }
  > = Array.from({ length: normalizedColumnCount }, () => ({
    widgetIds: [],
    estimatedHeight: 0
  }));

  const getProjectedHeight = (column: DashboardColumn, widgetId: WidgetId) =>
    getDashboardColumnEstimatedHeight(
      { widgetIds: [...column.widgetIds, widgetId] },
      widgetSizeTiers,
      collapsedWidgetIds
    );

  const pickBestColumn = (widget: (typeof widgets)[number]) => {
    return columns.reduce(
      (best, column) => {
        const projectedHeight = getProjectedHeight(column, widget.id);
        if (!best) {
          return { column, projectedHeight };
        }

        if (projectedHeight < best.projectedHeight - 0.5) {
          return { column, projectedHeight };
        }

        if (Math.abs(projectedHeight - best.projectedHeight) <= 0.5) {
          if (column.estimatedHeight < best.column.estimatedHeight) {
            return { column, projectedHeight };
          }
        }

        return best;
      },
      null as { column: (typeof columns)[number]; projectedHeight: number } | null
    );
  };

  for (const widget of widgets) {
    const bestColumnFit = pickBestColumn(widget);
    const targetColumn = bestColumnFit?.column ?? columns[0];
    targetColumn.widgetIds.push(widget.id);
    targetColumn.estimatedHeight =
      bestColumnFit?.projectedHeight ??
      getDashboardColumnEstimatedHeight(
        targetColumn,
        widgetSizeTiers,
        collapsedWidgetIds
      );
  }

  return optimizeDashboardColumns({
    collapsedWidgetIds,
    columns: columns.map(({ estimatedHeight: _estimatedHeight, ...column }) => column),
    widgetOrderIndex,
    widgetSizeTiers
  });
}

function optimizeDashboardColumns({
  collapsedWidgetIds,
  columns,
  widgetOrderIndex,
  widgetSizeTiers
}: {
  collapsedWidgetIds: WidgetId[];
  columns: DashboardColumn[];
  widgetOrderIndex: Map<WidgetId, number>;
  widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>>;
}) {
  const arrangeColumnsForFit = (draftColumns: DashboardColumn[]) =>
    draftColumns.map((column) => {
      return {
        ...column,
        widgetIds: [...column.widgetIds].sort(
          (left, right) => (widgetOrderIndex.get(left) ?? 0) - (widgetOrderIndex.get(right) ?? 0)
        )
      };
    });

  const getMetrics = (draftColumns: DashboardColumn[]) => {
    const heights = draftColumns.map((column) =>
      getDashboardColumnEstimatedHeight(
        column,
        widgetSizeTiers,
        collapsedWidgetIds
      )
    );
    const maxHeight = Math.max(0, ...heights);
    const minHeight = Math.min(...heights);
    const spread = heights.length > 1 ? maxHeight - minHeight : maxHeight;
    const sumOfSquares = heights.reduce((total, height) => total + height * height, 0);
    const totalHeight = heights.reduce((total, height) => total + height, 0);

    return {
      maxHeight,
      spread,
      sumOfSquares,
      totalHeight
    };
  };

  const isBetterLayout = (
    nextMetrics: ReturnType<typeof getMetrics>,
    currentMetrics: ReturnType<typeof getMetrics>
  ) => {
    if (nextMetrics.maxHeight !== currentMetrics.maxHeight) {
      return nextMetrics.maxHeight < currentMetrics.maxHeight;
    }

    if (nextMetrics.spread !== currentMetrics.spread) {
      return nextMetrics.spread < currentMetrics.spread;
    }

    if (nextMetrics.sumOfSquares !== currentMetrics.sumOfSquares) {
      return nextMetrics.sumOfSquares < currentMetrics.sumOfSquares;
    }

    return nextMetrics.totalHeight < currentMetrics.totalHeight;
  };
  const isBetterBalancedLayout = (
    nextMetrics: ReturnType<typeof getMetrics>,
    currentMetrics: ReturnType<typeof getMetrics>
  ) => {
    if (nextMetrics.spread !== currentMetrics.spread) {
      return nextMetrics.spread < currentMetrics.spread;
    }

    if (nextMetrics.maxHeight !== currentMetrics.maxHeight) {
      return nextMetrics.maxHeight < currentMetrics.maxHeight;
    }

    if (nextMetrics.sumOfSquares !== currentMetrics.sumOfSquares) {
      return nextMetrics.sumOfSquares < currentMetrics.sumOfSquares;
    }

    return nextMetrics.totalHeight < currentMetrics.totalHeight;
  };
  const getBestExactTwoColumnSplit = (draftColumns: DashboardColumn[]) => {
    if (draftColumns.length !== 2) {
      return null;
    }

    const widgetIds = draftColumns
      .flatMap((column) => column.widgetIds)
      .sort((left, right) => (widgetOrderIndex.get(left) ?? 0) - (widgetOrderIndex.get(right) ?? 0));

    if (widgetIds.length <= 1) {
      return arrangeColumnsForFit(draftColumns);
    }

    let bestSplit = arrangeColumnsForFit(draftColumns);
    let bestSplitMetrics = getMetrics(bestSplit);
    const totalMasks = 1 << widgetIds.length;

    for (let mask = 0; mask < totalMasks; mask += 1) {
      if (mask & 1) {
        continue;
      }

      const nextColumns: DashboardColumn[] = [
        { widgetIds: [] },
        { widgetIds: [] }
      ];

      for (let index = 0; index < widgetIds.length; index += 1) {
        const columnIndex = mask & (1 << index) ? 1 : 0;
        nextColumns[columnIndex].widgetIds.push(widgetIds[index]);
      }

      if (nextColumns[0].widgetIds.length === 0 || nextColumns[1].widgetIds.length === 0) {
        continue;
      }

      const normalizedColumns = arrangeColumnsForFit(nextColumns);
      const nextMetrics = getMetrics(normalizedColumns);

      if (!isBetterBalancedLayout(nextMetrics, bestSplitMetrics)) {
        continue;
      }

      bestSplit = normalizedColumns;
      bestSplitMetrics = nextMetrics;
    }

    return bestSplit;
  };
  let bestColumns = arrangeColumnsForFit(columns);
  let bestMetrics = getMetrics(bestColumns);
  let improved = true;

  while (improved) {
    improved = false;
    let candidateColumns = bestColumns;
    let candidateMetrics = bestMetrics;

    for (let fromIndex = 0; fromIndex < bestColumns.length; fromIndex += 1) {
      for (const widgetId of bestColumns[fromIndex].widgetIds) {
        for (let toIndex = 0; toIndex < bestColumns.length; toIndex += 1) {
          if (fromIndex === toIndex) {
            continue;
          }

          const nextColumns = bestColumns.map((column) => ({
            ...column,
            widgetIds: [...column.widgetIds]
          }));
          nextColumns[fromIndex].widgetIds = nextColumns[fromIndex].widgetIds.filter(
            (entry) => entry !== widgetId
          );
          nextColumns[toIndex].widgetIds.push(widgetId);

          const normalizedColumns = arrangeColumnsForFit(nextColumns);
          const nextMetrics = getMetrics(normalizedColumns);

          if (isBetterLayout(nextMetrics, candidateMetrics)) {
            candidateColumns = normalizedColumns;
            candidateMetrics = nextMetrics;
            improved = true;
          }
        }
      }
    }

    for (let leftIndex = 0; leftIndex < bestColumns.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bestColumns.length; rightIndex += 1) {
        for (const leftWidgetId of bestColumns[leftIndex].widgetIds) {
          for (const rightWidgetId of bestColumns[rightIndex].widgetIds) {
            const nextColumns = bestColumns.map((column) => ({
              ...column,
              widgetIds: [...column.widgetIds]
            }));
            nextColumns[leftIndex].widgetIds = nextColumns[leftIndex].widgetIds.map((widgetId) =>
              widgetId === leftWidgetId ? rightWidgetId : widgetId
            );
            nextColumns[rightIndex].widgetIds = nextColumns[rightIndex].widgetIds.map((widgetId) =>
              widgetId === rightWidgetId ? leftWidgetId : widgetId
            );

            const normalizedColumns = arrangeColumnsForFit(nextColumns);
            const nextMetrics = getMetrics(normalizedColumns);

            if (isBetterLayout(nextMetrics, candidateMetrics)) {
              candidateColumns = normalizedColumns;
              candidateMetrics = nextMetrics;
              improved = true;
            }
          }
        }
      }
    }

    if (improved) {
      bestColumns = candidateColumns;
      bestMetrics = candidateMetrics;
    }
  }

  if (bestColumns.length === 2) {
    const exactBalancedColumns = getBestExactTwoColumnSplit(bestColumns);

    if (exactBalancedColumns) {
      bestColumns = exactBalancedColumns;
      bestMetrics = getMetrics(bestColumns);
    }
  } else if (bestColumns.length > 1) {
    let rebalanced = true;

    while (rebalanced) {
      rebalanced = false;
      let candidateColumns = bestColumns;
      let candidateMetrics = bestMetrics;
      const indexedColumns = bestColumns
        .map((column, index) => ({
          column,
          height: getDashboardColumnEstimatedHeight(
            column,
            widgetSizeTiers,
            collapsedWidgetIds
          ),
          index
        }))
        .sort((left, right) => right.height - left.height);

      for (const fromColumn of indexedColumns) {
        for (const toColumn of [...indexedColumns].reverse()) {
          if (fromColumn.index === toColumn.index || fromColumn.height <= toColumn.height) {
            continue;
          }

          for (const widgetId of bestColumns[fromColumn.index].widgetIds) {
            const nextColumns = bestColumns.map((column) => ({
              ...column,
              widgetIds: [...column.widgetIds]
            }));
            nextColumns[fromColumn.index].widgetIds = nextColumns[fromColumn.index].widgetIds.filter(
              (entry) => entry !== widgetId
            );
            nextColumns[toColumn.index].widgetIds.push(widgetId);

            const normalizedColumns = arrangeColumnsForFit(nextColumns);
            const nextMetrics = getMetrics(normalizedColumns);

            if (nextMetrics.maxHeight > bestMetrics.maxHeight) {
              continue;
            }

            if (!isBetterBalancedLayout(nextMetrics, candidateMetrics)) {
              continue;
            }

            candidateColumns = normalizedColumns;
            candidateMetrics = nextMetrics;
            rebalanced = true;
          }
        }
      }

      if (rebalanced) {
        bestColumns = candidateColumns;
        bestMetrics = candidateMetrics;
      }
    }
  }

  return bestColumns;
}

function buildResponsiveDashboardLayout({
  availableHeight,
  collapsedWidgetIds,
  columnCount,
  widgetIds
}: {
  availableHeight: number;
  collapsedWidgetIds: WidgetId[];
  columnCount: number;
  widgetIds: WidgetId[];
}): DashboardLayoutFit {
  const widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>> = {};

  for (const widgetId of widgetIds) {
    widgetSizeTiers[widgetId] = WIDGET_SIZE_MAX;
  }

  const buildColumns = () =>
    buildDashboardColumns({
      collapsedWidgetIds,
      columnCount,
      widgetIds,
      widgetSizeTiers
    });
  const fitHeight = Math.max(0, availableHeight - DASHBOARD_FIT_BOTTOM_PADDING);
  const evaluateLayout = () => {
    const nextColumns = buildColumns();
    const heights = nextColumns.map((column) =>
      getDashboardColumnEstimatedHeight(column, widgetSizeTiers, collapsedWidgetIds)
    );
    const maxHeight = Math.max(0, ...heights);
    const minHeight = Math.min(...heights);
    const overflow =
      fitHeight > 0
        ? Math.max(0, ...heights.map((height) => height - fitHeight))
        : maxHeight;

    return {
      columns: nextColumns,
      maxHeight,
      overflow,
      spread: heights.length > 1 ? maxHeight - minHeight : maxHeight,
      totalHeight: heights.reduce((total, height) => total + height, 0)
    };
  };
  const isBetterEvaluation = (
    nextEvaluation: ReturnType<typeof evaluateLayout>,
    currentEvaluation: ReturnType<typeof evaluateLayout>
  ) => {
    if (nextEvaluation.overflow !== currentEvaluation.overflow) {
      return nextEvaluation.overflow < currentEvaluation.overflow;
    }

    if (nextEvaluation.maxHeight !== currentEvaluation.maxHeight) {
      return nextEvaluation.maxHeight < currentEvaluation.maxHeight;
    }

    if (nextEvaluation.spread !== currentEvaluation.spread) {
      return nextEvaluation.spread < currentEvaluation.spread;
    }

    return nextEvaluation.totalHeight < currentEvaluation.totalHeight;
  };

  let evaluation = evaluateLayout();
  let columns = evaluation.columns;
  let guard = 0;

  while (evaluation.overflow > 0) {
    if (guard > WIDGET_IDS.length * WIDGET_SIZE_MAX * 2) {
      break;
    }

    guard += 1;

    let bestAdjustment:
      | {
          evaluation: ReturnType<typeof evaluateLayout>;
          type: 'size';
          widgetId: WidgetId;
        }
      | null = null;

    for (const widgetId of widgetIds) {
      if (
        collapsedWidgetIds.includes(widgetId) ||
        (widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX) <= WIDGET_SIZE_MIN
      ) {
        continue;
      }

      const previousTier = widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX;
      widgetSizeTiers[widgetId] = clampWidgetSizeTier(previousTier - 1);
      const nextEvaluation = evaluateLayout();
      widgetSizeTiers[widgetId] = previousTier;

      if (!isBetterEvaluation(nextEvaluation, bestAdjustment?.evaluation ?? evaluation)) {
        continue;
      }

      bestAdjustment = {
        evaluation: nextEvaluation,
        type: 'size',
        widgetId
      };
    }

    if (!bestAdjustment) {
      break;
    }

    widgetSizeTiers[bestAdjustment.widgetId] = clampWidgetSizeTier(
      (widgetSizeTiers[bestAdjustment.widgetId] ?? WIDGET_SIZE_MAX) - 1
    );

    evaluation = bestAdjustment.evaluation;
    columns = evaluation.columns;
  }

  return {
    columns,
    isScrollable: evaluation.overflow > 0,
    widgetSizeTiers
  };
}

function getDashboardColumnEstimatedHeight(
  column: DashboardColumn,
  widgetSizeTiers: Partial<Record<WidgetId, WidgetSizeTier>>,
  collapsedWidgetIds: WidgetId[]
) {
  if (column.widgetIds.length === 0) {
    return 0;
  }

  return column.widgetIds.reduce((total, widgetId, index) => {
    const tier = widgetSizeTiers[widgetId] ?? WIDGET_SIZE_MAX;
    return (
      total +
      getWidgetDashboardHeight(widgetId, tier, collapsedWidgetIds.includes(widgetId)) +
      (index > 0 ? DASHBOARD_COLUMN_GAP : 0)
    );
  }, 0);
}

function getWidgetDashboardHeight(widgetId: WidgetId, sizeTier: WidgetSizeTier, collapsed: boolean) {
  return collapsed ? WIDGET_COLLAPSED_DASHBOARD_HEIGHT : WIDGET_DASHBOARD_HEIGHTS[widgetId][sizeTier];
}

function clampWidgetSizeTier(value: number): WidgetSizeTier {
  return clampNumber(Math.round(value), WIDGET_SIZE_MIN, WIDGET_SIZE_MAX) as WidgetSizeTier;
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

function buildPickerSpinnerView({
  currentPick,
  isSpinning,
  names,
  spinnerPosition
}: {
  currentPick: string | null;
  isSpinning: boolean;
  names: string[];
  spinnerPosition: number;
}): PickerSpinnerView {
  const restingItems = (centerName: string) =>
    Array.from({ length: PICKER_SPINNER_WINDOW_SIZE }, (_value, index) => ({
      isActive: index === PICKER_SPINNER_CENTER_INDEX,
      isAdjacent: false,
      key: `resting-${index}`,
      name: index === PICKER_SPINNER_CENTER_INDEX ? centerName : ''
    }));

  if (!names.length) {
    return {
      items: restingItems('No list selected'),
      translatePercent: getPickerSpinnerTranslatePercent(0)
    };
  }

  if (!isSpinning) {
    return {
      items: restingItems(currentPick ?? 'Press Pick'),
      translatePercent: getPickerSpinnerTranslatePercent(0)
    };
  }

  const baseIndex = Math.floor(spinnerPosition);
  const offset = spinnerPosition - baseIndex;
  const activeIndex = PICKER_SPINNER_CENTER_INDEX + Math.round(offset);

  return {
    items: Array.from({ length: PICKER_SPINNER_WINDOW_SIZE }, (_value, index) => {
      const itemOffset = index - PICKER_SPINNER_CENTER_INDEX;
      const normalizedIndex = getNormalizedPickerIndex(baseIndex + itemOffset, names.length);
      const activeDistance = Math.abs(index - activeIndex);

      return {
        isActive: activeDistance === 0,
        isAdjacent: activeDistance === 1,
        key: `spinning-${index}`,
        name: names[normalizedIndex]
      };
    }),
    translatePercent: getPickerSpinnerTranslatePercent(offset)
  };
}

function getNormalizedPickerIndex(index: number, itemCount: number) {
  const normalizedItemCount = Math.max(0, itemCount);

  if (normalizedItemCount === 0) {
    return 0;
  }

  const roundedIndex = Math.round(index);

  return ((roundedIndex % normalizedItemCount) + normalizedItemCount) % normalizedItemCount;
}

function getPickerSpinnerTranslatePercent(offset: number) {
  const leadingHiddenRows = (PICKER_SPINNER_WINDOW_SIZE - PICKER_SPINNER_VISIBLE_SIZE) / 2;

  return ((leadingHiddenRows + offset) * -100) / PICKER_SPINNER_WINDOW_SIZE;
}

function getPickerSpinDuration(totalSteps: number) {
  return Math.min(
    PICKER_SPIN_MAX_DURATION_MS,
    Math.max(PICKER_SPIN_MIN_DURATION_MS, totalSteps * PICKER_SPIN_STEP_DURATION_MS)
  );
}

function easeOutPickerSpin(progress: number) {
  return 1 - Math.pow(1 - progress, 4);
}

function getPickerSpinStepCount(studentCount: number, currentIndex: number, finalIndex: number) {
  const normalizedStudentCount = Math.max(0, studentCount);

  if (normalizedStudentCount === 0) {
    return 0;
  }

  const landingOffset =
    (finalIndex - currentIndex + normalizedStudentCount) % normalizedStudentCount;
  let totalSteps = landingOffset;

  while (totalSteps < PICKER_SPIN_MIN_STEPS) {
    totalSteps += normalizedStudentCount;
  }

  return totalSteps;
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

function getQrWidgetPreviewState(linkDraft: string): QrWidgetPreviewState {
  const trimmedLink = linkDraft.trim();
  if (!trimmedLink) {
    return {
      error: null,
      hostLabel: null,
      normalizedUrl: null,
      qrCode: null
    };
  }

  const normalizedUrl = normalizeQrWidgetUrl(trimmedLink);
  if (!normalizedUrl) {
    return {
      error: 'Enter a valid web link such as https://school.example.com.',
      hostLabel: null,
      normalizedUrl: null,
      qrCode: null
    };
  }

  try {
    return {
      error: null,
      hostLabel: getQrWidgetHostLabel(normalizedUrl),
      normalizedUrl,
      qrCode: QrCode.encodeText(normalizedUrl)
    };
  } catch {
    return {
      error: 'That link is too long to encode into a QR code.',
      hostLabel: null,
      normalizedUrl,
      qrCode: null
    };
  }
}

function normalizeQrWidgetUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    if (!url.hostname) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function getQrWidgetHostLabel(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    return hostname || null;
  } catch {
    return null;
  }
}

function isWidgetId(value: string): value is WidgetId {
  return WIDGET_IDS.includes(value as WidgetId);
}

function isColorModeSwatchId(value: string): value is ColorModeSwatchId {
  return COLOR_MODE_SWATCHES.some((swatch) => swatch.id === value);
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
