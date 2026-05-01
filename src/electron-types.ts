export type WidgetPopoutId =
  | 'timer'
  | 'picker'
  | 'group-maker'
  | 'seating-chart'
  | 'bell-schedule'
  | 'homework-assessment'
  | 'qr-generator'
  | 'notes'
  | 'planner';

export type WindowRole =
  | 'overlay'
  | 'popover'
  | 'builder'
  | 'widget-picker'
  | 'widget-popout';

export type AnchorContext = {
  x: number;
  y: number;
  width: number;
  height: number;
  display: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type DesktopWindowContext = {
  role: WindowRole;
  anchor: AnchorContext | null;
  platform: string;
  widgetId?: WidgetPopoutId | null;
  autoSizeToContent?: boolean;
};

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LessonDocumentSelection = {
  name: string;
  path: string;
};

export type LessonPlansPdfEntry = {
  classListId: string | null;
  className: string;
  dateKey: string;
  dateLabel: string;
  documentNames: string[];
  plan: string;
  schoolTerm: number | null;
  schoolWeek: number | null;
  termLabel: string;
  weekLabel: string;
  year: number;
};

export type LessonPlansPdfExportOptions = {
  filterSummary: string;
  groupBy: 'date' | 'class' | 'term' | 'week';
  includeAttachedFiles: boolean;
  includeClassName: boolean;
  includePlanText: boolean;
  pageBreak: 'none' | 'class' | 'term' | 'week' | 'lesson';
  sortOrder: 'ascending' | 'descending';
  title: string;
};

export type LessonPlansPdfExportPayload = {
  className: string;
  entries: LessonPlansPdfEntry[];
  exportedAtLabel: string;
  options: LessonPlansPdfExportOptions;
};

export type LessonPlansPdfExportResult = {
  canceled: boolean;
  errorMessage?: string;
  filePath?: string;
  ok: boolean;
};

export type PersistentStateSnapshot = {
  found: boolean;
  value: unknown;
};

export type PersistentStateChange = {
  key: string;
  value: unknown;
};

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'unsupported'
  | 'error';

export type AppUpdateState = {
  availableVersion: string | null;
  currentVersion: string;
  message: string;
  progressPercent: number | null;
  status: AppUpdateStatus;
};

export type AppSettings = {
  launchAtLogin: boolean;
  timerChimeEnabled: boolean;
  timerSpeechVoice: TimerSpeechVoice;
  timerVoiceEnabled: boolean;
};

export type TimerSpeechVoice = 'female' | 'male';

export type ElectronBridge = {
  getWindowContext: () => Promise<DesktopWindowContext>;
  getOverlayBounds: () => Promise<WindowBounds>;
  getCurrentWindowBounds: () => Promise<WindowBounds>;
  getOpenWidgetPopouts: () => Promise<WidgetPopoutId[]>;
  getAppUpdateState: () => Promise<AppUpdateState>;
  getAppSettings: () => Promise<AppSettings>;
  checkForAppUpdates: () => Promise<AppUpdateState>;
  installAppUpdate: () => Promise<boolean>;
  speakTimerAlert: (text: string) => Promise<boolean>;
  onAppUpdateStateChanged: (listener: (state: AppUpdateState) => void) => () => void;
  setLaunchAtLogin: (enabled: boolean) => Promise<AppSettings>;
  setTimerChimeEnabled: (enabled: boolean) => Promise<AppSettings>;
  setTimerSpeechVoice: (voice: TimerSpeechVoice) => Promise<AppSettings>;
  setTimerVoiceEnabled: (enabled: boolean) => Promise<AppSettings>;
  onAppSettingsChanged: (listener: (settings: AppSettings) => void) => () => void;
  getPersistentState: (key: string) => PersistentStateSnapshot;
  setPersistentState: (key: string, value: unknown) => Promise<boolean>;
  onPersistentStateChanged: (listener: (change: PersistentStateChange) => void) => () => void;
  setOverlayPosition: (position: { x: number; y: number }) => void;
  setOverlayInteractive: (interactive: boolean) => void;
  setCurrentWindowBounds: (bounds: WindowBounds) => void;
  togglePopover: () => void;
  returnToTeacherTools: () => void;
  closePopover: () => void;
  toggleClassListBuilder: () => void;
  closeClassListBuilder: () => void;
  toggleWidgetPicker: () => void;
  closeWidgetPicker: () => void;
  toggleWidgetPopout: (widgetId: WidgetPopoutId) => void;
  onWidgetPopoutsChanged: (listener: (widgetIds: WidgetPopoutId[]) => void) => () => void;
  selectLessonDocuments: () => Promise<LessonDocumentSelection[]>;
  openLessonDocument: (filePath: string) => Promise<string>;
  exportLessonPlansPdf: (
    payload: LessonPlansPdfExportPayload
  ) => Promise<LessonPlansPdfExportResult>;
  quitApp: () => void;
};
