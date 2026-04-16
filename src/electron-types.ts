export type WidgetPopoutId =
  | 'timer'
  | 'picker'
  | 'group-maker'
  | 'seating-chart'
  | 'bell-schedule'
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

export type PersistentStateSnapshot = {
  found: boolean;
  value: unknown;
};

export type PersistentStateChange = {
  key: string;
  value: unknown;
};

export type ElectronBridge = {
  getWindowContext: () => Promise<DesktopWindowContext>;
  getOverlayBounds: () => Promise<WindowBounds>;
  getCurrentWindowBounds: () => Promise<WindowBounds>;
  getOpenWidgetPopouts: () => Promise<WidgetPopoutId[]>;
  getPersistentState: (key: string) => PersistentStateSnapshot;
  setPersistentState: (key: string, value: unknown) => Promise<boolean>;
  onPersistentStateChanged: (listener: (change: PersistentStateChange) => void) => () => void;
  setOverlayPosition: (position: { x: number; y: number }) => void;
  setCurrentWindowBounds: (bounds: WindowBounds) => void;
  togglePopover: () => void;
  closePopover: () => void;
  toggleClassListBuilder: () => void;
  closeClassListBuilder: () => void;
  toggleWidgetPicker: () => void;
  closeWidgetPicker: () => void;
  toggleWidgetPopout: (widgetId: WidgetPopoutId) => void;
  onWidgetPopoutsChanged: (listener: (widgetIds: WidgetPopoutId[]) => void) => () => void;
  selectLessonDocuments: () => Promise<LessonDocumentSelection[]>;
  openLessonDocument: (filePath: string) => Promise<string>;
  quitApp: () => void;
};
