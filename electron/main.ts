import * as electron from 'electron/main';
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, screen } = electron;
const nativeImage = (electron as typeof electron & {
  nativeImage: typeof import('electron').nativeImage;
}).nativeImage;
const shell = (electron as typeof electron & {
  shell: typeof import('electron').shell;
}).shell;
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const OVERLAY_SIZE = 86;
const OVERLAY_MARGIN = 22;
const POPOVER_MIN_WIDTH = 260;
const POPOVER_MIN_HEIGHT = 300;
const BUILDER_WIDTH = 360;
const BUILDER_HEIGHT = 468;
const WIDGET_PICKER_WIDTH = 292;
const WIDGET_PICKER_HEIGHT = 316;
const BUILDER_MIN_WIDTH = 280;
const BUILDER_MIN_HEIGHT = 340;
const WIDGET_PICKER_MIN_WIDTH = 240;
const WIDGET_PICKER_MIN_HEIGHT = 240;
const WIDGET_POPOUT_DEFAULTS: Record<
  WidgetPopoutId,
  { height: number; minHeight: number; minWidth: number; width: number }
> = {
  timer: { width: 352, height: 304, minWidth: 280, minHeight: 224 },
  picker: { width: 392, height: 332, minWidth: 300, minHeight: 240 },
  'group-maker': { width: 600, height: 456, minWidth: 320, minHeight: 280 },
  'seating-chart': { width: 980, height: 760, minWidth: 760, minHeight: 560 },
  'bell-schedule': { width: 1220, height: 840, minWidth: 340, minHeight: 300 },
  'homework-assessment': { width: 820, height: 860, minWidth: 520, minHeight: 520 },
  'qr-generator': { width: 420, height: 460, minWidth: 320, minHeight: 320 },
  notes: { width: 420, height: 420, minWidth: 300, minHeight: 244 },
  planner: { width: 600, height: 720, minWidth: 360, minHeight: 420 }
};

type WidgetPopoutId =
  | 'timer'
  | 'picker'
  | 'group-maker'
  | 'seating-chart'
  | 'bell-schedule'
  | 'homework-assessment'
  | 'qr-generator'
  | 'notes'
  | 'planner';
type WindowRole = 'overlay' | 'popover' | 'builder' | 'widget-picker' | 'widget-popout';

type AnchorPayload = {
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

type WindowContext = {
  role: WindowRole;
  anchor: AnchorPayload | null;
  widgetId?: WidgetPopoutId | null;
  autoSizeToContent?: boolean;
};

type PersistentStateSnapshot = {
  found: boolean;
  value: unknown;
};

type PersistentStateChange = {
  key: string;
  value: unknown;
};

type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'unsupported'
  | 'error';

type AppUpdateState = {
  availableVersion: string | null;
  currentVersion: string;
  message: string;
  progressPercent: number | null;
  status: AppUpdateStatus;
};

type PersistentStateFile = {
  version: 1;
  profileId: string;
  updatedAt: number;
  valuesByKey: Record<string, unknown>;
};

type UserStorageScope = {
  id: string;
  storageFilePath: string;
  username: string;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let overlayWindow: Electron.BrowserWindow | null = null;
let popoverWindow: Electron.BrowserWindow | null = null;
let builderWindow: Electron.BrowserWindow | null = null;
let widgetPickerWindow: Electron.BrowserWindow | null = null;
const widgetPopoutWindows = new Map<WidgetPopoutId, Electron.BrowserWindow>();
let tray: Electron.Tray | null = null;
let popoverOpenedAt = 0;
let builderOpenedAt = 0;
let widgetPickerOpenedAt = 0;
let preferredPopoverSize: Pick<Bounds, 'width' | 'height'> | null = null;
let preferredBuilderSize: Pick<Bounds, 'width' | 'height'> | null = null;
let preferredWidgetPickerSize: Pick<Bounds, 'width' | 'height'> | null = null;
const windowContexts = new Map<number, WindowContext>();
let persistentStateCache: PersistentStateFile | null = null;
let appUpdater: AppUpdater | null = null;
let appUpdateCheckPromise: Promise<unknown> | null = null;
let pendingOverlayBounds: Bounds | null = null;
let overlayBoundsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPopoverSize: Pick<Bounds, 'width' | 'height'> | null = null;
let popoverSizeSaveTimer: ReturnType<typeof setTimeout> | null = null;
let widgetPopoutBoundsCache: Partial<Record<WidgetPopoutId, Partial<Bounds>>> | null = null;
let widgetPopoutBoundsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let appUpdateState: AppUpdateState = {
  availableVersion: null,
  currentVersion: app.getVersion(),
  message: 'Updates work in installed release builds.',
  progressPercent: null,
  status: 'unsupported'
};

const APP_UPDATE_CACHE_DIR_NAME = 'teachertools-overlay-updater';
const APP_UPDATE_LOG_FILENAME = 'app-update.log';
const PERSISTENT_STATE_VERSION = 1;
const PERSISTENT_STATE_FILENAME = 'tool-state.json';
const WINDOW_STATE_SAVE_DELAY_MS = 350;

function isWidgetPopoutId(value: unknown): value is WidgetPopoutId {
  return (
    value === 'timer' ||
    value === 'picker' ||
    value === 'group-maker' ||
    value === 'seating-chart' ||
    value === 'bell-schedule' ||
    value === 'homework-assessment' ||
    value === 'qr-generator' ||
    value === 'notes' ||
    value === 'planner'
  );
}

function createTrayIcon() {
  const svg = `
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(32 32) rotate(90) scale(28)">
          <stop stop-color="#F8FFF6" stop-opacity="0.98" />
          <stop offset="0.42" stop-color="#71F2C4" stop-opacity="0.92" />
          <stop offset="0.8" stop-color="#0B8F85" stop-opacity="0.4" />
          <stop offset="1" stop-color="#0B8F85" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#glow)" />
      <circle cx="32" cy="32" r="11" fill="#F9FFF6" />
    </svg>
  `;

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 20, height: 20 });
}

function getRendererUrl(route: string) {
  if (isDev) {
    return `${process.env.VITE_DEV_SERVER_URL}#${route}`;
  }

  return `file://${path.join(__dirname, '../dist/index.html')}#${route}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function boundsAreEqual(left: Bounds, right: Bounds) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function getDefaultOverlayBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - OVERLAY_SIZE - OVERLAY_MARGIN,
    y: workArea.y + OVERLAY_MARGIN,
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE
  };
}

function getOverlayStateFilePath() {
  return path.join(app.getPath('userData'), 'overlay-state.json');
}

function getPopoverStateFilePath() {
  return path.join(app.getPath('userData'), 'popover-state.json');
}

function getWidgetPopoutStateFilePath() {
  return path.join(app.getPath('userData'), 'widget-popout-state.json');
}

function loadStoredOverlayBounds() {
  try {
    const raw = fs.readFileSync(getOverlayStateFilePath(), 'utf8');
    return JSON.parse(raw) as Partial<Bounds>;
  } catch {
    return null;
  }
}

function writeOverlayBounds(bounds: Bounds) {
  try {
    fs.mkdirSync(path.dirname(getOverlayStateFilePath()), { recursive: true });
    fs.writeFileSync(getOverlayStateFilePath(), JSON.stringify(bounds, null, 2), 'utf8');
  } catch {
    // Best effort persistence only.
  }
}

function saveOverlayBounds(bounds: Bounds, options: { immediate?: boolean } = {}) {
  pendingOverlayBounds = bounds;

  if (overlayBoundsSaveTimer) {
    clearTimeout(overlayBoundsSaveTimer);
    overlayBoundsSaveTimer = null;
  }

  if (options.immediate) {
    flushOverlayBoundsSave();
    return;
  }

  overlayBoundsSaveTimer = setTimeout(flushOverlayBoundsSave, WINDOW_STATE_SAVE_DELAY_MS);
}

function flushOverlayBoundsSave() {
  if (overlayBoundsSaveTimer) {
    clearTimeout(overlayBoundsSaveTimer);
    overlayBoundsSaveTimer = null;
  }

  if (!pendingOverlayBounds) {
    return;
  }

  const bounds = pendingOverlayBounds;
  pendingOverlayBounds = null;
  writeOverlayBounds(bounds);
}

function loadStoredPopoverSize() {
  try {
    const raw = fs.readFileSync(getPopoverStateFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Pick<Bounds, 'width' | 'height'>>;

    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
      return null;
    }

    return {
      width: parsed.width,
      height: parsed.height
    };
  } catch {
    return null;
  }
}

function writePopoverSize(bounds: Pick<Bounds, 'width' | 'height'>) {
  try {
    fs.mkdirSync(path.dirname(getPopoverStateFilePath()), { recursive: true });
    fs.writeFileSync(
      getPopoverStateFilePath(),
      JSON.stringify(
        {
          width: bounds.width,
          height: bounds.height
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // Best effort persistence only.
  }
}

function savePopoverSize(
  bounds: Pick<Bounds, 'width' | 'height'>,
  options: { immediate?: boolean } = {}
) {
  pendingPopoverSize = bounds;

  if (popoverSizeSaveTimer) {
    clearTimeout(popoverSizeSaveTimer);
    popoverSizeSaveTimer = null;
  }

  if (options.immediate) {
    flushPopoverSizeSave();
    return;
  }

  popoverSizeSaveTimer = setTimeout(flushPopoverSizeSave, WINDOW_STATE_SAVE_DELAY_MS);
}

function flushPopoverSizeSave() {
  if (popoverSizeSaveTimer) {
    clearTimeout(popoverSizeSaveTimer);
    popoverSizeSaveTimer = null;
  }

  if (!pendingPopoverSize) {
    return;
  }

  const bounds = pendingPopoverSize;
  pendingPopoverSize = null;
  writePopoverSize(bounds);
}

function loadStoredWidgetPopoutBounds() {
  if (widgetPopoutBoundsCache) {
    return widgetPopoutBoundsCache;
  }

  try {
    const raw = fs.readFileSync(getWidgetPopoutStateFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, Partial<Bounds>>;
    const boundsByWidgetId: Partial<Record<WidgetPopoutId, Partial<Bounds>>> = {};

    for (const [widgetId, bounds] of Object.entries(parsed)) {
      if (!isWidgetPopoutId(widgetId) || !bounds || typeof bounds !== 'object') {
        continue;
      }

      boundsByWidgetId[widgetId] = bounds;
    }

    widgetPopoutBoundsCache = boundsByWidgetId;
    return boundsByWidgetId;
  } catch {
    widgetPopoutBoundsCache = {};
    return widgetPopoutBoundsCache;
  }
}

function writeStoredWidgetPopoutBounds(boundsByWidgetId: Partial<Record<WidgetPopoutId, Bounds>>) {
  try {
    fs.mkdirSync(path.dirname(getWidgetPopoutStateFilePath()), { recursive: true });
    fs.writeFileSync(
      getWidgetPopoutStateFilePath(),
      JSON.stringify(boundsByWidgetId, null, 2),
      'utf8'
    );
  } catch {
    // Best effort persistence only.
  }
}

function saveStoredWidgetPopoutBounds(
  boundsByWidgetId: Partial<Record<WidgetPopoutId, Bounds>>,
  options: { immediate?: boolean } = {}
) {
  widgetPopoutBoundsCache = boundsByWidgetId;

  if (widgetPopoutBoundsSaveTimer) {
    clearTimeout(widgetPopoutBoundsSaveTimer);
    widgetPopoutBoundsSaveTimer = null;
  }

  if (options.immediate) {
    flushWidgetPopoutBoundsSave();
    return;
  }

  widgetPopoutBoundsSaveTimer = setTimeout(
    flushWidgetPopoutBoundsSave,
    WINDOW_STATE_SAVE_DELAY_MS
  );
}

function flushWidgetPopoutBoundsSave() {
  if (widgetPopoutBoundsSaveTimer) {
    clearTimeout(widgetPopoutBoundsSaveTimer);
    widgetPopoutBoundsSaveTimer = null;
  }

  if (!widgetPopoutBoundsCache) {
    return;
  }

  writeStoredWidgetPopoutBounds(widgetPopoutBoundsCache as Partial<Record<WidgetPopoutId, Bounds>>);
}

function getStoredWidgetPopoutBounds(widgetId: WidgetPopoutId) {
  return loadStoredWidgetPopoutBounds()[widgetId] ?? null;
}

function getPreferredWidgetPopoutBounds(
  widgetId: WidgetPopoutId,
  storedBounds: Partial<Bounds> | null
) {
  if (
    widgetId === 'bell-schedule' &&
    storedBounds &&
    (typeof storedBounds.width !== 'number' || storedBounds.width <= 420) &&
    (typeof storedBounds.height !== 'number' || storedBounds.height <= 380)
  ) {
    const defaults = WIDGET_POPOUT_DEFAULTS[widgetId];
    return {
      ...storedBounds,
      width: defaults.width,
      height: defaults.height
    };
  }

  return storedBounds;
}

function setStoredWidgetPopoutBounds(
  widgetId: WidgetPopoutId,
  bounds: Bounds,
  options: { immediate?: boolean } = {}
) {
  const currentBounds = loadStoredWidgetPopoutBounds();
  currentBounds[widgetId] = bounds;
  saveStoredWidgetPopoutBounds(currentBounds as Partial<Record<WidgetPopoutId, Bounds>>, options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeFileSegment(value: string) {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return sanitized.replace(/^-+|-+$/g, '') || 'user';
}

function getCurrentUsername() {
  try {
    const username = os.userInfo().username.trim();
    if (username) {
      return username;
    }
  } catch {
    // Fall back to environment-derived usernames below.
  }

  return process.env.USERNAME?.trim() || process.env.USER?.trim() || 'user';
}

function getUserStorageScope(): UserStorageScope {
  const username = getCurrentUsername();
  const homePath = app.getPath('home');
  const fingerprint = createHash('sha256')
    .update(`${process.platform}|${username}|${homePath}`)
    .digest('hex')
    .slice(0, 12);
  const id = `${sanitizeFileSegment(username)}-${fingerprint}`;

  return {
    id,
    storageFilePath: path.join(app.getPath('userData'), 'profiles', id, PERSISTENT_STATE_FILENAME),
    username
  };
}

function createEmptyPersistentStateFile(): PersistentStateFile {
  return {
    version: PERSISTENT_STATE_VERSION,
    profileId: getUserStorageScope().id,
    updatedAt: Date.now(),
    valuesByKey: {}
  };
}

function normalizePersistentStateFile(raw: unknown): PersistentStateFile {
  if (!isRecord(raw)) {
    return createEmptyPersistentStateFile();
  }

  const valuesByKey = isRecord(raw.valuesByKey) ? { ...raw.valuesByKey } : {};
  const profileId =
    typeof raw.profileId === 'string' && raw.profileId.trim()
      ? raw.profileId
      : getUserStorageScope().id;
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now();

  return {
    version: PERSISTENT_STATE_VERSION,
    profileId,
    updatedAt,
    valuesByKey
  };
}

function readPersistentStateFile(filePath: string) {
  const candidates = [filePath, `${filePath}.bak`];

  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      return normalizePersistentStateFile(JSON.parse(raw));
    } catch {
      // Try the next candidate.
    }
  }

  return createEmptyPersistentStateFile();
}

function ensurePersistentStateCache() {
  if (persistentStateCache) {
    return persistentStateCache;
  }

  const scope = getUserStorageScope();
  persistentStateCache = readPersistentStateFile(scope.storageFilePath);
  persistentStateCache.profileId = scope.id;
  return persistentStateCache;
}

function writePersistentStateFile(filePath: string, stateFile: PersistentStateFile) {
  const serialized = JSON.stringify(stateFile, null, 2);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${filePath}.bak`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }
  } catch {
    // Keep going even if the backup refresh fails.
  }

  fs.writeFileSync(tempPath, serialized, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function persistPersistentState() {
  writePersistentStateFile(getUserStorageScope().storageFilePath, ensurePersistentStateCache());
}

function isPersistentStateKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPersistentStateValue(stateFile: PersistentStateFile, key: string) {
  return Object.prototype.hasOwnProperty.call(stateFile.valuesByKey, key);
}

function serializePersistentStateValue(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function getPersistentStateSnapshot(key: string): PersistentStateSnapshot {
  const stateFile = ensurePersistentStateCache();
  const found = hasPersistentStateValue(stateFile, key);

  return {
    found,
    value: found ? stateFile.valuesByKey[key] : null
  };
}

function getAllApplicationWindows() {
  return [
    overlayWindow,
    popoverWindow,
    builderWindow,
    widgetPickerWindow,
    ...widgetPopoutWindows.values()
  ].filter((win): win is Electron.BrowserWindow => Boolean(win && !win.isDestroyed()));
}

function getAppUpdateBaseCachePath() {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches');
  }

  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
}

function getAppUpdateCachePath() {
  return path.join(getAppUpdateBaseCachePath(), APP_UPDATE_CACHE_DIR_NAME);
}

function getPendingAppUpdateInfoPath() {
  return path.join(getAppUpdateCachePath(), 'pending', 'update-info.json');
}

function getPendingDownloadedAppUpdateFileName() {
  try {
    const rawInfo = JSON.parse(fs.readFileSync(getPendingAppUpdateInfoPath(), 'utf8')) as {
      fileName?: unknown;
    };
    const fileName = typeof rawInfo.fileName === 'string' ? rawInfo.fileName : '';
    const updatePath = path.join(getAppUpdateCachePath(), 'pending', fileName);

    return fileName && fs.existsSync(updatePath) ? fileName : null;
  } catch {
    return null;
  }
}

function stringifyAppUpdateLogValue(value: unknown) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendAppUpdateLog(level: 'debug' | 'error' | 'info' | 'warn', value: unknown) {
  let logPath: string;

  try {
    logPath = path.join(app.getPath('userData'), APP_UPDATE_LOG_FILENAME);
  } catch {
    return;
  }

  const line = `[${new Date().toISOString()}] [${level}] ${stringifyAppUpdateLogValue(value)}\n`;
  fs.appendFile(logPath, line, () => undefined);
}

const appUpdateLogger = {
  debug: (message: unknown) => appendAppUpdateLog('debug', message),
  error: (message: unknown) => appendAppUpdateLog('error', message),
  info: (message: unknown) => appendAppUpdateLog('info', message),
  warn: (message: unknown) => appendAppUpdateLog('warn', message)
};

function broadcastAppUpdateState() {
  getAllApplicationWindows().forEach((targetWindow) => {
    targetWindow.webContents.send('app-update:state', appUpdateState);
  });
}

function setAppUpdateState(nextState: AppUpdateState) {
  const previousState = appUpdateState;
  appUpdateState = {
    ...nextState,
    currentVersion: app.getVersion()
  };

  if (
    previousState.status !== appUpdateState.status ||
    previousState.message !== appUpdateState.message
  ) {
    appendAppUpdateLog(
      'info',
      `state=${appUpdateState.status} version=${appUpdateState.currentVersion} available=${
        appUpdateState.availableVersion ?? 'none'
      } message="${appUpdateState.message}"`
    );
  }

  broadcastAppUpdateState();
}

function updateAppUpdateState(patch: Partial<AppUpdateState>) {
  setAppUpdateState({
    ...appUpdateState,
    ...patch,
    currentVersion: app.getVersion()
  });
}

function getInitialAppUpdateState(): AppUpdateState {
  if (!app.isPackaged) {
    return {
      availableVersion: null,
      currentVersion: app.getVersion(),
      message: 'Updates work in installed release builds.',
      progressPercent: null,
      status: 'unsupported'
    };
  }

  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return {
      availableVersion: null,
      currentVersion: app.getVersion(),
      message: 'Updates are configured for the macOS and Windows builds.',
      progressPercent: null,
      status: 'unsupported'
    };
  }

  return {
    availableVersion: null,
    currentVersion: app.getVersion(),
    message: 'Ready to check GitHub Releases for an update.',
    progressPercent: null,
    status: 'idle'
  };
}

function getAppUpdateErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'The update check failed. Please try again.';
}

function handleAppUpdateError(error: unknown) {
  appUpdateLogger.error(error);
  updateAppUpdateState({
    message: getAppUpdateErrorMessage(error),
    progressPercent: null,
    status: 'error'
  });
}

function resumePendingDownloadedAppUpdate() {
  const fileName = getPendingDownloadedAppUpdateFileName();

  if (!fileName || !appUpdater || appUpdateState.status === 'unsupported') {
    return;
  }

  appUpdateLogger.info(`Found pending downloaded app update ${fileName}; preparing install state.`);
  void checkForAppUpdates({
    force: true,
    message: 'Preparing the downloaded update for install.'
  });
}

function initializeAppUpdater() {
  setAppUpdateState(getInitialAppUpdateState());

  if (appUpdateState.status === 'unsupported') {
    return;
  }

  const { autoUpdater } = electronUpdater;
  appUpdater = autoUpdater;
  appUpdater.logger = appUpdateLogger;
  appUpdater.autoDownload = false;
  appUpdater.autoInstallOnAppQuit = false;
  appUpdateLogger.info(`Initialized updater for TeacherTools ${app.getVersion()}.`);

  appUpdater.on('checking-for-update', () => {
    updateAppUpdateState({
      availableVersion: null,
      message: 'Checking GitHub Releases for a newer version.',
      progressPercent: null,
      status: 'checking'
    });
  });

  appUpdater.on('update-available', (info: UpdateInfo) => {
    appUpdateLogger.info(`Update ${info.version} found; starting download.`);
    updateAppUpdateState({
      availableVersion: info.version ?? null,
      message: `Update ${info.version} found. Downloading now.`,
      progressPercent: 0,
      status: 'available'
    });

    void appUpdater?.downloadUpdate().catch((error) => {
      handleAppUpdateError(error);
    });
  });

  appUpdater.on('update-not-available', () => {
    appUpdateLogger.info('No app update is available.');
    updateAppUpdateState({
      availableVersion: null,
      message: 'This install is already on the latest version.',
      progressPercent: null,
      status: 'up-to-date'
    });
  });

  appUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateAppUpdateState({
      message: `Downloading update${appUpdateState.availableVersion ? ` ${appUpdateState.availableVersion}` : ''}.`,
      progressPercent: progress.percent,
      status: 'downloading'
    });
  });

  appUpdater.on('update-downloaded', (info: UpdateInfo) => {
    appUpdateLogger.info(`Update ${info.version} is downloaded and ready to install.`);
    updateAppUpdateState({
      availableVersion: info.version ?? appUpdateState.availableVersion,
      message: `Update ${info.version} is ready. Restart TeacherTools to install it.`,
      progressPercent: 100,
      status: 'downloaded'
    });
  });

  appUpdater.on('error', (error) => {
    handleAppUpdateError(error);
  });

  resumePendingDownloadedAppUpdate();
}

type AppUpdateCheckOptions = {
  force?: boolean;
  message?: string;
};

async function checkForAppUpdates(options: AppUpdateCheckOptions = {}) {
  if (!appUpdater) {
    return appUpdateState;
  }

  if (!options.force && (
    appUpdateState.status === 'checking' ||
    appUpdateState.status === 'available' ||
    appUpdateState.status === 'downloading'
  )) {
    return appUpdateState;
  }

  if (appUpdateCheckPromise) {
    return appUpdateState;
  }

  try {
    if (options.message) {
      updateAppUpdateState({
        message: options.message,
        progressPercent: null,
        status: 'checking'
      });
    }

    appUpdateCheckPromise = appUpdater.checkForUpdates();
    await appUpdateCheckPromise;
  } catch (error) {
    handleAppUpdateError(error);
  } finally {
    appUpdateCheckPromise = null;
  }

  return appUpdateState;
}

function installDownloadedAppUpdate() {
  if (!appUpdater || appUpdateState.status !== 'downloaded') {
    appUpdateLogger.warn('Install requested before an update was ready.');
    return false;
  }

  appUpdateLogger.info('Installing downloaded app update.');
  updateAppUpdateState({
    message: 'Closing TeacherTools to install the downloaded update.',
    progressPercent: 100,
    status: 'downloaded'
  });

  setImmediate(() => {
    appUpdater?.quitAndInstall();
  });

  return true;
}

function broadcastPersistentStateChange(change: PersistentStateChange) {
  getAllApplicationWindows().forEach((targetWindow) => {
    targetWindow.webContents.send('storage:changed', change);
  });
}

function setPersistentStateValue(key: string, value: unknown) {
  const stateFile = ensurePersistentStateCache();
  const nextSerialized = serializePersistentStateValue(value);
  if (nextSerialized === undefined) {
    return false;
  }

  const hasExistingValue = hasPersistentStateValue(stateFile, key);
  const currentSerialized = hasExistingValue
    ? serializePersistentStateValue(stateFile.valuesByKey[key])
    : undefined;

  if (hasExistingValue && currentSerialized === nextSerialized) {
    return true;
  }

  try {
    stateFile.valuesByKey[key] = value;
    stateFile.updatedAt = Date.now();
    persistPersistentState();
    broadcastPersistentStateChange({ key, value });
    return true;
  } catch {
    return false;
  }
}

function normalizeOverlayBounds(bounds: Partial<Bounds> | null) {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
    return getDefaultOverlayBounds();
  }

  const display = screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE
  });
  const { workArea } = display;

  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - OVERLAY_SIZE),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - OVERLAY_SIZE),
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE
  };
}

function buildAnchorPayload(): AnchorPayload {
  const overlayBounds = overlayWindow?.getBounds() ?? getDefaultOverlayBounds();
  const display = screen.getDisplayMatching(overlayBounds);
  const { workArea } = display;

  return {
    x: overlayBounds.x - workArea.x,
    y: overlayBounds.y - workArea.y,
    width: overlayBounds.width,
    height: overlayBounds.height,
    display: {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height
    }
  };
}

function getPopoverBounds(preferredSize?: Partial<Pick<Bounds, 'width' | 'height'>>) {
  const overlayBounds = overlayWindow?.getBounds() ?? getDefaultOverlayBounds();
  const display = screen.getDisplayMatching(overlayBounds);
  const { workArea } = display;
  const maxWidth = Math.max(POPOVER_MIN_WIDTH, workArea.width - 28);
  const maxHeight = Math.max(POPOVER_MIN_HEIGHT, workArea.height - 28);
  const width = clamp(
    preferredSize?.width ?? Math.floor(workArea.width * 0.34),
    POPOVER_MIN_WIDTH,
    maxWidth
  );
  const height = clamp(
    preferredSize?.height ?? Math.floor(workArea.height * 0.62),
    POPOVER_MIN_HEIGHT,
    maxHeight
  );
  const anchorX = overlayBounds.x + Math.round(overlayBounds.width / 2);
  const anchorY = overlayBounds.y + Math.round(overlayBounds.height / 2);

  return {
    x: clamp(anchorX, workArea.x + 14, workArea.x + workArea.width - width - 14),
    y: clamp(anchorY, workArea.y + 14, workArea.y + workArea.height - height - 14),
    width,
    height
  };
}

function normalizePopoverBounds(bounds: Bounds) {
  return normalizeManagedWindowBounds(bounds, POPOVER_MIN_WIDTH, POPOVER_MIN_HEIGHT);
}

function normalizeBuilderBounds(bounds: Bounds) {
  const display = screen.getDisplayMatching(bounds);
  const { workArea } = display;
  const maxWidth = Math.max(BUILDER_MIN_WIDTH, workArea.width - 28);
  const width = clamp(bounds.width, BUILDER_MIN_WIDTH, maxWidth);
  const y = clamp(
    bounds.y,
    workArea.y + 14,
    workArea.y + workArea.height - BUILDER_MIN_HEIGHT - 14
  );
  const maxHeight = Math.max(BUILDER_MIN_HEIGHT, workArea.y + workArea.height - y - 14);
  const height = clamp(bounds.height, BUILDER_MIN_HEIGHT, maxHeight);

  return {
    x: clamp(bounds.x, workArea.x + 14, workArea.x + workArea.width - width - 14),
    y,
    width,
    height
  };
}

function normalizeManagedWindowBounds(bounds: Bounds, minWidth: number, minHeight: number) {
  const display = screen.getDisplayMatching(bounds);
  const { workArea } = display;
  const maxWidth = Math.max(minWidth, workArea.width - 28);
  const maxHeight = Math.max(minHeight, workArea.height - 28);
  const width = clamp(bounds.width, minWidth, maxWidth);
  const height = clamp(bounds.height, minHeight, maxHeight);

  return {
    x: clamp(bounds.x, workArea.x + 14, workArea.x + workArea.width - width - 14),
    y: clamp(bounds.y, workArea.y + 14, workArea.y + workArea.height - height - 14),
    width,
    height
  };
}

function getBuilderBounds(preferredSize?: Partial<Pick<Bounds, 'width' | 'height'>>) {
  const referenceBounds = popoverWindow?.getBounds() ?? getPopoverBounds(preferredPopoverSize ?? undefined);
  const display = screen.getDisplayMatching(referenceBounds);
  const { workArea } = display;
  const width = clamp(
    preferredSize?.width ?? BUILDER_WIDTH,
    BUILDER_MIN_WIDTH,
    Math.max(BUILDER_MIN_WIDTH, workArea.width - 28)
  );
  const height = clamp(
    preferredSize?.height ?? BUILDER_HEIGHT,
    BUILDER_MIN_HEIGHT,
    Math.max(BUILDER_MIN_HEIGHT, workArea.height - 28)
  );
  const spaceRight = workArea.x + workArea.width - (referenceBounds.x + referenceBounds.width);
  const spaceLeft = referenceBounds.x - workArea.x;
  const openRight = spaceRight >= width + 12 || spaceRight >= spaceLeft;

  return {
    x: openRight
      ? clamp(
          referenceBounds.x + referenceBounds.width + 10,
          workArea.x + 14,
          workArea.x + workArea.width - width - 14
        )
      : clamp(
          referenceBounds.x - width - 10,
          workArea.x + 14,
          workArea.x + workArea.width - width - 14
        ),
    y: clamp(
      referenceBounds.y,
      workArea.y + 14,
      workArea.y + workArea.height - height - 14
    ),
    width,
    height
  };
}

function getWidgetPickerBounds(preferredSize?: Partial<Pick<Bounds, 'width' | 'height'>>) {
  const referenceBounds = popoverWindow?.getBounds() ?? getPopoverBounds(preferredPopoverSize ?? undefined);
  const display = screen.getDisplayMatching(referenceBounds);
  const { workArea } = display;
  const width = clamp(
    preferredSize?.width ?? WIDGET_PICKER_WIDTH,
    WIDGET_PICKER_MIN_WIDTH,
    Math.max(WIDGET_PICKER_MIN_WIDTH, workArea.width - 28)
  );
  const height = clamp(
    preferredSize?.height ?? WIDGET_PICKER_HEIGHT,
    WIDGET_PICKER_MIN_HEIGHT,
    Math.max(WIDGET_PICKER_MIN_HEIGHT, workArea.height - 28)
  );
  const spaceRight = workArea.x + workArea.width - (referenceBounds.x + referenceBounds.width);
  const spaceLeft = referenceBounds.x - workArea.x;
  const openRight = spaceRight >= width + 12 || spaceRight >= spaceLeft;

  return {
    x: openRight
      ? clamp(
          referenceBounds.x + referenceBounds.width + 10,
          workArea.x + 14,
          workArea.x + workArea.width - width - 14
        )
      : clamp(
          referenceBounds.x - width - 10,
          workArea.x + 14,
          workArea.x + workArea.width - width - 14
        ),
    y: clamp(
      referenceBounds.y + 12,
      workArea.y + 14,
      workArea.y + workArea.height - height - 14
    ),
    width,
    height
  };
}

function getWidgetPopoutBounds(widgetId: WidgetPopoutId, preferredBounds?: Partial<Bounds> | null) {
  const defaults = WIDGET_POPOUT_DEFAULTS[widgetId];
  const referenceBounds = popoverWindow?.getBounds() ?? overlayWindow?.getBounds() ?? getDefaultOverlayBounds();
  const display = screen.getDisplayMatching(referenceBounds);
  const { workArea } = display;
  const width = clamp(
    preferredBounds?.width ?? defaults.width,
    defaults.minWidth,
    Math.max(defaults.minWidth, workArea.width - 28)
  );
  const height = clamp(
    preferredBounds?.height ?? defaults.height,
    defaults.minHeight,
    Math.max(defaults.minHeight, workArea.height - 28)
  );
  const widgetIds = Object.keys(WIDGET_POPOUT_DEFAULTS).filter(isWidgetPopoutId);
  const widgetOffsetIndex = Math.max(widgetIds.indexOf(widgetId), 0);
  const fallbackX = referenceBounds.x + 18 + widgetOffsetIndex * 18;
  const fallbackY = referenceBounds.y + 18 + widgetOffsetIndex * 18;

  return normalizeManagedWindowBounds(
    {
      x: preferredBounds?.x ?? fallbackX,
      y: preferredBounds?.y ?? fallbackY,
      width,
      height
    },
    defaults.minWidth,
    defaults.minHeight
  );
}

function setWindowPresence(win: Electron.BrowserWindow) {
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenuBarVisibility(false);
}

function focusWindowSoon(win: Electron.BrowserWindow | null) {
  setTimeout(() => {
    win?.focus();
  }, 40);
}

function syncAuxiliaryWindowPositions() {
  if (builderWindow) {
    builderWindow.setBounds(getBuilderBounds(preferredBuilderSize ?? undefined), false);
  }

  if (widgetPickerWindow) {
    widgetPickerWindow.setBounds(getWidgetPickerBounds(preferredWidgetPickerSize ?? undefined), false);
  }
}

function broadcastWidgetPopoutState() {
  const openIds = Array.from(widgetPopoutWindows.keys());
  const targetWindows = [
    overlayWindow,
    popoverWindow,
    builderWindow,
    widgetPickerWindow,
    ...widgetPopoutWindows.values()
  ];

  targetWindows.forEach((targetWindow) => {
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('widget-popout:state', openIds);
    }
  });
}

function createOverlayWindow() {
  const bounds = normalizeOverlayBounds(loadStoredOverlayBounds());

  overlayWindow = new BrowserWindow({
    ...bounds,
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: true,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const overlayWindowContentsId = overlayWindow.webContents.id;

  setWindowPresence(overlayWindow);
  windowContexts.set(overlayWindowContentsId, {
    role: 'overlay',
    anchor: null
  });

  overlayWindow.loadURL(getRendererUrl('overlay'));

  overlayWindow.on('move', () => {
    if (overlayWindow) {
      saveOverlayBounds(overlayWindow.getBounds());
    }

    if (popoverWindow) {
      closePopover();
    }
  });

  overlayWindow.on('closed', () => {
    windowContexts.delete(overlayWindowContentsId);
    overlayWindow = null;
  });
}

function createPopoverWindow() {
  if (!overlayWindow || popoverWindow) {
    return;
  }

  const bounds = getPopoverBounds(preferredPopoverSize ?? loadStoredPopoverSize() ?? undefined);

  popoverWindow = new BrowserWindow({
    ...bounds,
    minWidth: POPOVER_MIN_WIDTH,
    minHeight: POPOVER_MIN_HEIGHT,
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: true,
    show: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  preferredPopoverSize = {
    width: bounds.width,
    height: bounds.height
  };

  const popoverWindowContentsId = popoverWindow.webContents.id;

  setWindowPresence(popoverWindow);
  windowContexts.set(popoverWindowContentsId, {
    role: 'popover',
    anchor: buildAnchorPayload()
  });

  popoverWindow.loadURL(getRendererUrl('popover'));

  popoverWindow.once('ready-to-show', () => {
    popoverOpenedAt = Date.now();
    popoverWindow?.show();
    focusWindowSoon(popoverWindow);
  });

  popoverWindow.on('blur', () => {
    setTimeout(() => {
      if (!popoverWindow || Date.now() - popoverOpenedAt < 250) {
        return;
      }

      const builderFocused = builderWindow?.isFocused() ?? false;
      const widgetPickerFocused = widgetPickerWindow?.isFocused() ?? false;

      if (builderFocused || widgetPickerFocused) {
        return;
      }

      if (!popoverWindow.isFocused()) {
        closePopover();
      }
    }, 30);
  });

  popoverWindow.on('closed', () => {
    windowContexts.delete(popoverWindowContentsId);
    popoverWindow = null;
  });
}

function createBuilderWindow() {
  if (builderWindow) {
    builderWindow.focus();
    return;
  }

  const bounds = getBuilderBounds(preferredBuilderSize ?? undefined);

  builderWindow = new BrowserWindow({
    ...bounds,
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: true,
    show: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  preferredBuilderSize = {
    width: bounds.width,
    height: bounds.height
  };

  const builderWindowContentsId = builderWindow.webContents.id;

  setWindowPresence(builderWindow);
  windowContexts.set(builderWindowContentsId, {
    role: 'builder',
    anchor: buildAnchorPayload()
  });

  builderWindow.loadURL(getRendererUrl('builder'));

  builderWindow.once('ready-to-show', () => {
    builderOpenedAt = Date.now();
    builderWindow?.show();
    focusWindowSoon(builderWindow);
  });

  builderWindow.on('blur', () => {
    setTimeout(() => {
      if (!builderWindow || Date.now() - builderOpenedAt < 250) {
        return;
      }

      const popoverFocused = popoverWindow?.isFocused() ?? false;
      const widgetPickerFocused = widgetPickerWindow?.isFocused() ?? false;

      if (!popoverFocused && !widgetPickerFocused) {
        closePopover();
      }
    }, 30);
  });

  builderWindow.on('closed', () => {
    windowContexts.delete(builderWindowContentsId);
    builderWindow = null;
  });
}

function createWidgetPickerWindow() {
  if (widgetPickerWindow) {
    widgetPickerWindow.focus();
    return;
  }

  const bounds = getWidgetPickerBounds(preferredWidgetPickerSize ?? undefined);

  widgetPickerWindow = new BrowserWindow({
    ...bounds,
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: true,
    show: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  preferredWidgetPickerSize = {
    width: bounds.width,
    height: bounds.height
  };

  const widgetPickerWindowContentsId = widgetPickerWindow.webContents.id;

  setWindowPresence(widgetPickerWindow);
  windowContexts.set(widgetPickerWindowContentsId, {
    role: 'widget-picker',
    anchor: buildAnchorPayload()
  });

  widgetPickerWindow.loadURL(getRendererUrl('widget-picker'));

  widgetPickerWindow.once('ready-to-show', () => {
    widgetPickerOpenedAt = Date.now();
    widgetPickerWindow?.show();
    focusWindowSoon(widgetPickerWindow);
  });

  widgetPickerWindow.on('blur', () => {
    setTimeout(() => {
      if (!widgetPickerWindow || Date.now() - widgetPickerOpenedAt < 250) {
        return;
      }

      const popoverFocused = popoverWindow?.isFocused() ?? false;
      const builderFocused = builderWindow?.isFocused() ?? false;

      if (widgetPickerWindow && !widgetPickerWindow.isFocused()) {
        closeWidgetPickerWindow();
      }

      if (!popoverFocused && !builderFocused) {
        closePopover();
      }
    }, 30);
  });

  widgetPickerWindow.on('closed', () => {
    windowContexts.delete(widgetPickerWindowContentsId);
    widgetPickerWindow = null;
  });
}

function createWidgetPopoutWindow(widgetId: WidgetPopoutId) {
  const existingWindow = widgetPopoutWindows.get(widgetId);
  if (existingWindow) {
    existingWindow.focus();
    return;
  }

  const defaults = WIDGET_POPOUT_DEFAULTS[widgetId];
  const storedBounds = getStoredWidgetPopoutBounds(widgetId);
  const preferredBounds = getPreferredWidgetPopoutBounds(widgetId, storedBounds);
  const bounds = getWidgetPopoutBounds(widgetId, preferredBounds);
  const widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: true,
    show: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const widgetWindowContentsId = widgetWindow.webContents.id;

  widgetPopoutWindows.set(widgetId, widgetWindow);
  setWindowPresence(widgetWindow);
  windowContexts.set(widgetWindowContentsId, {
    role: 'widget-popout',
    anchor: buildAnchorPayload(),
    widgetId,
    autoSizeToContent: !storedBounds || preferredBounds !== storedBounds
  });

  widgetWindow.loadURL(getRendererUrl(`widget-popout/${widgetId}`));

  widgetWindow.once('ready-to-show', () => {
    widgetWindow.show();
    focusWindowSoon(widgetWindow);
    broadcastWidgetPopoutState();
  });

  widgetWindow.on('move', () => {
    setStoredWidgetPopoutBounds(widgetId, widgetWindow.getBounds());
  });

  widgetWindow.on('resize', () => {
    setStoredWidgetPopoutBounds(widgetId, widgetWindow.getBounds());
  });

  widgetWindow.on('closed', () => {
    windowContexts.delete(widgetWindowContentsId);
    widgetPopoutWindows.delete(widgetId);
    broadcastWidgetPopoutState();
  });
}

function closeBuilderWindow() {
  if (!builderWindow) {
    return;
  }

  const currentWindow = builderWindow;
  builderWindow = null;
  windowContexts.delete(currentWindow.webContents.id);
  currentWindow.destroy();
}

function closeWidgetPickerWindow() {
  if (!widgetPickerWindow) {
    return;
  }

  const currentWindow = widgetPickerWindow;
  widgetPickerWindow = null;
  windowContexts.delete(currentWindow.webContents.id);
  currentWindow.destroy();
}

function closeWidgetPopoutWindow(widgetId: WidgetPopoutId) {
  const currentWindow = widgetPopoutWindows.get(widgetId);
  if (!currentWindow) {
    return;
  }

  widgetPopoutWindows.delete(widgetId);
  windowContexts.delete(currentWindow.webContents.id);
  if (!currentWindow.isDestroyed()) {
    currentWindow.destroy();
  }
  broadcastWidgetPopoutState();
}

function closePopover() {
  if (widgetPickerWindow) {
    closeWidgetPickerWindow();
  }

  if (!popoverWindow) {
    return;
  }

  const currentWindow = popoverWindow;
  popoverWindow = null;
  windowContexts.delete(currentWindow.webContents.id);
  currentWindow.destroy();
  refreshTrayMenu();
}

function openPopover() {
  if (popoverWindow) {
    popoverOpenedAt = Date.now();
    popoverWindow.show();
    focusWindowSoon(popoverWindow);
    refreshTrayMenu();
    return;
  }

  createPopoverWindow();
  refreshTrayMenu();
}

function togglePopover() {
  if (popoverWindow) {
    closePopover();
    return;
  }

  openPopover();
}

function toggleBuilderWindow() {
  if (builderWindow) {
    closeBuilderWindow();
    openPopover();
    return;
  }

  createBuilderWindow();
}

function toggleWidgetPickerWindow() {
  if (widgetPickerWindow) {
    closeWidgetPickerWindow();
    return;
  }

  createWidgetPickerWindow();
}

function toggleWidgetPopoutWindow(widgetId: WidgetPopoutId) {
  if (widgetPopoutWindows.has(widgetId)) {
    closeWidgetPopoutWindow(widgetId);
    return;
  }

  createWidgetPopoutWindow(widgetId);
}

function returnToTeacherTools(sourceWebContentsId: number) {
  const sourceContext = windowContexts.get(sourceWebContentsId);

  if (sourceContext?.role === 'builder') {
    closeBuilderWindow();
  } else if (sourceContext?.role === 'widget-picker') {
    closeWidgetPickerWindow();
  } else if (sourceContext?.role === 'widget-popout' && sourceContext.widgetId) {
    closeWidgetPopoutWindow(sourceContext.widgetId);
  }

  openPopover();
}

function centerOverlayWindow() {
  const nextBounds = getDefaultOverlayBounds();
  overlayWindow?.setBounds(nextBounds);
  saveOverlayBounds(nextBounds);
}

function setOverlayPosition(position: { x: number; y: number }) {
  if (!overlayWindow) {
    return;
  }

  const nextBounds = normalizeOverlayBounds(position);
  if (!boundsAreEqual(overlayWindow.getBounds(), nextBounds)) {
    overlayWindow.setBounds(nextBounds);
  }
  saveOverlayBounds(nextBounds);
}

function setPopoverBounds(bounds: Bounds) {
  if (!popoverWindow) {
    return;
  }

  const nextBounds = normalizePopoverBounds(bounds);
  if (!boundsAreEqual(popoverWindow.getBounds(), nextBounds)) {
    popoverWindow.setBounds(nextBounds, false);
  }
  preferredPopoverSize = {
    width: nextBounds.width,
    height: nextBounds.height
  };
  savePopoverSize(preferredPopoverSize);
  syncAuxiliaryWindowPositions();
}

function setBuilderBounds(bounds: Bounds) {
  if (!builderWindow) {
    return;
  }

  const nextBounds = normalizeBuilderBounds(bounds);
  if (!boundsAreEqual(builderWindow.getBounds(), nextBounds)) {
    builderWindow.setBounds(nextBounds, false);
  }
  preferredBuilderSize = {
    width: nextBounds.width,
    height: nextBounds.height
  };
}

function setWidgetPickerBounds(bounds: Bounds) {
  if (!widgetPickerWindow) {
    return;
  }

  const nextBounds = normalizeManagedWindowBounds(
    bounds,
    WIDGET_PICKER_MIN_WIDTH,
    WIDGET_PICKER_MIN_HEIGHT
  );
  if (!boundsAreEqual(widgetPickerWindow.getBounds(), nextBounds)) {
    widgetPickerWindow.setBounds(nextBounds, false);
  }
  preferredWidgetPickerSize = {
    width: nextBounds.width,
    height: nextBounds.height
  };
}

function setWidgetPopoutBounds(widgetId: WidgetPopoutId, bounds: Bounds) {
  const widgetWindow = widgetPopoutWindows.get(widgetId);
  if (!widgetWindow) {
    return;
  }

  const defaults = WIDGET_POPOUT_DEFAULTS[widgetId];
  const nextBounds = normalizeManagedWindowBounds(bounds, defaults.minWidth, defaults.minHeight);
  if (!boundsAreEqual(widgetWindow.getBounds(), nextBounds)) {
    widgetWindow.setBounds(nextBounds, false);
  }
  setStoredWidgetPopoutBounds(widgetId, nextBounds);
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: popoverWindow ? 'Hide TeacherTools' : 'Open TeacherTools',
        click: () => togglePopover()
      },
      {
        label: 'Recenter Dot',
        click: () => centerOverlayWindow()
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ])
  );
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('TeacherTools Overlay');
  refreshTrayMenu();

  tray.on('click', () => {
    togglePopover();
    refreshTrayMenu();
  });

  tray.on('right-click', () => {
    refreshTrayMenu();
    tray?.popUpContextMenu();
  });
}

app.whenReady().then(() => {
  preferredPopoverSize = loadStoredPopoverSize();
  ensurePersistentStateCache();
  createOverlayWindow();
  createTray();
  initializeAppUpdater();

  app.on('activate', () => {
    if (!overlayWindow) {
      createOverlayWindow();
    }
  });
});

app.on('before-quit', () => {
  flushOverlayBoundsSave();
  flushPopoverSizeSave();
  flushWidgetPopoutBoundsSave();

  if (!persistentStateCache) {
    return;
  }

  try {
    persistPersistentState();
  } catch {
    // The latest in-memory state was already written on each change.
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    return;
  }
});

ipcMain.handle('window:get-context', (event) => {
  return {
    ...(windowContexts.get(event.sender.id) ?? {
      role: 'overlay',
      anchor: null,
      autoSizeToContent: false
    }),
    platform: process.platform
  };
});

ipcMain.handle('window:get-overlay-bounds', () => {
  return overlayWindow?.getBounds() ?? getDefaultOverlayBounds();
});

ipcMain.handle('window:get-current-bounds', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.getBounds() ?? getDefaultOverlayBounds();
});

ipcMain.handle('widget-popout:get-open-ids', () => {
  return Array.from(widgetPopoutWindows.keys());
});

ipcMain.handle('app-update:get-state', () => {
  return appUpdateState;
});

ipcMain.handle('app-update:check', async () => {
  return checkForAppUpdates();
});

ipcMain.handle('app-update:install', () => {
  return installDownloadedAppUpdate();
});

ipcMain.on('storage:get', (event, key: unknown) => {
  event.returnValue = isPersistentStateKey(key)
    ? getPersistentStateSnapshot(key)
    : {
        found: false,
        value: null
      };
});

ipcMain.handle('storage:set', (event, key: unknown, value: unknown) => {
  if (!isPersistentStateKey(key)) {
    return false;
  }

  return setPersistentStateValue(key, value);
});

ipcMain.on('popover:toggle', () => {
  togglePopover();
  refreshTrayMenu();
});

ipcMain.on('teacher-tools:return', (event) => {
  returnToTeacherTools(event.sender.id);
});

ipcMain.on('popover:close', () => {
  closePopover();
  refreshTrayMenu();
});

ipcMain.on('builder:toggle', () => {
  toggleBuilderWindow();
});

ipcMain.on('builder:close', () => {
  closeBuilderWindow();
});

ipcMain.on('widget-picker:toggle', () => {
  toggleWidgetPickerWindow();
});

ipcMain.on('widget-picker:close', () => {
  closeWidgetPickerWindow();
});

ipcMain.on('widget-popout:toggle', (_event, widgetId: unknown) => {
  if (!isWidgetPopoutId(widgetId)) {
    return;
  }

  toggleWidgetPopoutWindow(widgetId);
});

ipcMain.on('window:set-overlay-position', (_event, position: { x: number; y: number }) => {
  setOverlayPosition(position);
});

ipcMain.on('window:set-current-bounds', (event, bounds: Bounds) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);

  if (sourceWindow && sourceWindow === popoverWindow) {
    setPopoverBounds(bounds);
    return;
  }

  if (sourceWindow && sourceWindow === builderWindow) {
    setBuilderBounds(bounds);
    return;
  }

  if (sourceWindow && sourceWindow === widgetPickerWindow) {
    setWidgetPickerBounds(bounds);
    return;
  }

  for (const [widgetId, widgetWindow] of widgetPopoutWindows.entries()) {
    if (sourceWindow && sourceWindow === widgetWindow) {
      setWidgetPopoutBounds(widgetId, bounds);
      return;
    }
  }
});

ipcMain.handle('lesson-documents:select', async () => {
  const focusedWindow =
    BrowserWindow.getFocusedWindow() ??
    popoverWindow ??
    builderWindow ??
    widgetPickerWindow ??
    overlayWindow ??
    null;
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    title: 'Attach lesson documents'
  };
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map((filePath) => ({
    name: path.basename(filePath),
    path: filePath
  }));
});

ipcMain.handle('lesson-documents:open', async (_event, filePath: unknown) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return 'Missing file path.';
  }

  return shell.openPath(filePath);
});

ipcMain.on('app:quit', () => {
  app.quit();
});
