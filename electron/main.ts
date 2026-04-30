import * as electron from 'electron/main';
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater';
import { spawn, type ChildProcess } from 'node:child_process';
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
const shouldUseTray = process.platform === 'win32';
const shouldUseDock = process.platform === 'darwin';
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
  planner: { width: 1180, height: 820, minWidth: 760, minHeight: 560 }
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

type LessonPlansPdfEntry = {
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

type LessonPlansPdfExportOptions = {
  filterSummary: string;
  groupBy: 'date' | 'class' | 'term' | 'week';
  includeAttachedFiles: boolean;
  includeClassName: boolean;
  includePlanText: boolean;
  pageBreak: 'none' | 'class' | 'term' | 'week' | 'lesson';
  sortOrder: 'ascending' | 'descending';
  title: string;
};

type LessonPlansPdfExportPayload = {
  className: string;
  entries: LessonPlansPdfEntry[];
  exportedAtLabel: string;
  options: LessonPlansPdfExportOptions;
};

type LessonPlansPdfExportResult = {
  canceled: boolean;
  errorMessage?: string;
  filePath?: string;
  ok: boolean;
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

type AppSettings = {
  launchAtLogin: boolean;
  timerSpeechVoice: TimerSpeechVoice;
};

type TimerSpeechVoice = 'female' | 'male';

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
let activeTimerSpeechProcess: ChildProcess | null = null;
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
const TIMER_SPEECH_VOICE_SETTINGS_KEY = 'teacher-tools.timer-speech-voice';
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
    storedBounds &&
    (widgetId === 'bell-schedule' || widgetId === 'planner') &&
    (typeof storedBounds.width !== 'number' || storedBounds.width <= 760) &&
    (typeof storedBounds.height !== 'number' || storedBounds.height <= 560)
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

function trimStringValue(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function trimOptionalStringValue(value: unknown, maxLength: number) {
  const trimmed = trimStringValue(value, maxLength);
  return trimmed || null;
}

function normalizeOptionalPositiveInteger(value: unknown, maxValue: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.round(value);
  return normalized > 0 && normalized <= maxValue ? normalized : null;
}

function normalizeLessonPlansPdfGroupBy(value: unknown): LessonPlansPdfExportOptions['groupBy'] {
  return value === 'class' || value === 'term' || value === 'week' ? value : 'date';
}

function normalizeLessonPlansPdfPageBreak(value: unknown): LessonPlansPdfExportOptions['pageBreak'] {
  return value === 'class' || value === 'term' || value === 'week' || value === 'lesson'
    ? value
    : 'none';
}

function normalizeLessonPlansPdfSortOrder(value: unknown): LessonPlansPdfExportOptions['sortOrder'] {
  return value === 'descending' ? 'descending' : 'ascending';
}

function normalizeLessonPlansPdfOptions(raw: unknown): LessonPlansPdfExportOptions {
  const optionsRaw = isRecord(raw) ? raw : {};

  return {
    filterSummary: trimStringValue(optionsRaw.filterSummary, 300),
    groupBy: normalizeLessonPlansPdfGroupBy(optionsRaw.groupBy),
    includeAttachedFiles: optionsRaw.includeAttachedFiles !== false,
    includeClassName: optionsRaw.includeClassName === true,
    includePlanText: optionsRaw.includePlanText !== false,
    pageBreak: normalizeLessonPlansPdfPageBreak(optionsRaw.pageBreak),
    sortOrder: normalizeLessonPlansPdfSortOrder(optionsRaw.sortOrder),
    title: trimStringValue(optionsRaw.title, 140) || 'Lesson Plans'
  };
}

function normalizeLessonPlansPdfEntry(raw: unknown): LessonPlansPdfEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const className = trimStringValue(raw.className, 120);
  const dateKey = trimStringValue(raw.dateKey, 32);
  const dateLabel = trimStringValue(raw.dateLabel, 80) || dateKey;
  const year =
    typeof raw.year === 'number' && Number.isFinite(raw.year)
      ? Math.max(1900, Math.min(3000, Math.round(raw.year)))
      : Number(dateKey.slice(0, 4)) || new Date().getFullYear();

  if (!className || !dateKey || !dateLabel) {
    return null;
  }

  const documentNames = Array.isArray(raw.documentNames)
    ? Array.from(
        new Set(
          raw.documentNames
            .map((documentName) => trimStringValue(documentName, 260))
            .filter(Boolean)
        )
      ).slice(0, 200)
    : [];

  return {
    classListId: trimOptionalStringValue(raw.classListId, 120),
    className,
    dateKey,
    dateLabel,
    documentNames,
    plan: trimStringValue(raw.plan, 200_000),
    schoolTerm: normalizeOptionalPositiveInteger(raw.schoolTerm, 4),
    schoolWeek: normalizeOptionalPositiveInteger(raw.schoolWeek, 15),
    termLabel: trimStringValue(raw.termLabel, 80) || 'School holidays',
    weekLabel: trimStringValue(raw.weekLabel, 100) || 'School holidays',
    year
  };
}

function normalizeLessonPlansPdfPayload(raw: unknown): LessonPlansPdfExportPayload | null {
  if (!isRecord(raw)) {
    return null;
  }

  const className = trimStringValue(raw.className, 120);
  const entries = Array.isArray(raw.entries)
    ? raw.entries
        .map((entry) => normalizeLessonPlansPdfEntry(entry))
        .filter((entry): entry is LessonPlansPdfEntry => entry !== null)
        .slice(0, 1000)
    : [];

  if (!className || entries.length === 0) {
    return null;
  }

  return {
    className,
    entries,
    exportedAtLabel: trimStringValue(raw.exportedAtLabel, 120),
    options: normalizeLessonPlansPdfOptions(raw.options)
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function getLessonPlansPdfGroupLabel(
  entry: LessonPlansPdfEntry,
  groupBy: LessonPlansPdfExportOptions['groupBy']
) {
  if (groupBy === 'class') {
    return entry.className;
  }

  if (groupBy === 'term') {
    return entry.termLabel;
  }

  if (groupBy === 'week') {
    return entry.weekLabel;
  }

  return '';
}

function groupLessonPlansPdfEntries(payload: LessonPlansPdfExportPayload) {
  if (payload.options.groupBy === 'date') {
    return [
      {
        key: 'all',
        label: '',
        entries: payload.entries
      }
    ];
  }

  const groups: Array<{ entries: LessonPlansPdfEntry[]; key: string; label: string }> = [];
  const groupByKey = new Map<string, (typeof groups)[number]>();

  for (const entry of payload.entries) {
    const label = getLessonPlansPdfGroupLabel(entry, payload.options.groupBy) || 'Other';
    const key = `${payload.options.groupBy}:${label}`;
    const currentGroup = groupByKey.get(key);

    if (currentGroup) {
      currentGroup.entries.push(entry);
      continue;
    }

    const nextGroup = {
      entries: [entry],
      key,
      label
    };
    groups.push(nextGroup);
    groupByKey.set(key, nextGroup);
  }

  return groups;
}

function shouldBreakBeforeGroup(
  groupIndex: number,
  groupBy: LessonPlansPdfExportOptions['groupBy'],
  pageBreak: LessonPlansPdfExportOptions['pageBreak']
) {
  return groupIndex > 0 && pageBreak !== 'none' && pageBreak === groupBy;
}

function getLessonPlansPdfEntryHtml(
  entry: LessonPlansPdfEntry,
  options: LessonPlansPdfExportOptions,
  index: number
) {
  const escapedDate = escapeHtml(entry.dateLabel);
  const escapedDateKey = escapeHtml(entry.dateKey);
  const escapedClassName = escapeHtml(entry.className);
  const escapedWeekLabel = escapeHtml(entry.weekLabel);
  const metaItems = [
    escapedDateKey,
    options.includeClassName ? escapedClassName : '',
    entry.schoolTerm ? escapeHtml(entry.termLabel) : '',
    entry.schoolWeek ? escapedWeekLabel : ''
  ].filter(Boolean);
  const planHtml =
    options.includePlanText
      ? `<div class="lesson-block">
          <h3>Lesson plan</h3>
          ${
            entry.plan
              ? `<div class="plan-text">${escapeHtml(entry.plan)}</div>`
              : '<p class="muted">No written plan saved.</p>'
          }
        </div>`
      : '';
  const documentsHtml =
    options.includeAttachedFiles
      ? `<div class="lesson-block">
          <h3>Attached files</h3>
          ${
            entry.documentNames.length > 0
              ? `<ul>${entry.documentNames
                  .map((documentName) => `<li>${escapeHtml(documentName)}</li>`)
                  .join('')}</ul>`
              : '<p class="muted">No files attached for this day.</p>'
          }
        </div>`
      : '';
  const breakClass = options.pageBreak === 'lesson' && index > 0 ? ' lesson--page-break' : '';

  return `
    <section class="lesson${breakClass}">
      <div class="lesson-heading">
        <span class="lesson-index">${index + 1}</span>
        <div>
          <h2>${escapedDate}</h2>
          <p>${metaItems.join(' · ')}</p>
        </div>
      </div>
      ${planHtml}
      ${documentsHtml}
    </section>
  `;
}

function buildLessonPlansPdfHtml(payload: LessonPlansPdfExportPayload) {
  const escapedClassName = escapeHtml(payload.className);
  const escapedTitle = escapeHtml(payload.options.title);
  const escapedGeneratedAt = escapeHtml(payload.exportedAtLabel || new Date().toLocaleString());
  const escapedFilterSummary = escapeHtml(payload.options.filterSummary);
  const lessonLabel = `${payload.entries.length} lesson${payload.entries.length === 1 ? '' : 's'}`;
  let entryIndex = 0;
  const entriesHtml = groupLessonPlansPdfEntries(payload)
    .map((group, groupIndex) => {
      const groupHeading = group.label
        ? `<h2 class="group-heading">${escapeHtml(group.label)}</h2>`
        : '';
      const groupClass = shouldBreakBeforeGroup(
        groupIndex,
        payload.options.groupBy,
        payload.options.pageBreak
      )
        ? 'lesson-group lesson-group--page-break'
        : 'lesson-group';
      const groupEntriesHtml = group.entries
        .map((entry) => {
          const entryHtml = getLessonPlansPdfEntryHtml(entry, payload.options, entryIndex);
          entryIndex += 1;
          return entryHtml;
        })
        .join('');

      return `<div class="${groupClass}">${groupHeading}${groupEntriesHtml}</div>`;
    })
    .join('');

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapedTitle} - ${escapedClassName}</title>
        <style>
          @page {
            size: A4;
            margin: 18mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            background: #ffffff;
            color: #172033;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 12px;
            line-height: 1.5;
          }

          header {
            padding-bottom: 18px;
            border-bottom: 2px solid #d9e3ef;
            margin-bottom: 20px;
          }

          h1,
          h2,
          h3,
          p {
            margin: 0;
          }

          h1 {
            color: #0f172a;
            font-size: 28px;
            line-height: 1.1;
          }

          .subtitle {
            margin-top: 7px;
            color: #475569;
            font-size: 13px;
          }

          .filter-summary {
            margin-top: 8px;
            color: #64748b;
            font-size: 11px;
          }

          .meta {
            margin-top: 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }

          .meta span {
            display: inline-flex;
            padding: 4px 8px;
            border-radius: 5px;
            background: #eef4fb;
            color: #334155;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }

          .lesson {
            break-inside: avoid;
            page-break-inside: avoid;
            padding: 14px 0 18px;
            border-bottom: 1px solid #e2e8f0;
          }

          .lesson:last-child {
            border-bottom: 0;
          }

          .lesson--page-break,
          .lesson-group--page-break {
            break-before: page;
            page-break-before: always;
          }

          .group-heading {
            margin: 18px 0 4px;
            color: #0f172a;
            font-size: 15px;
            line-height: 1.2;
            border-bottom: 1px solid #d9e3ef;
            padding-bottom: 5px;
          }

          .lesson-heading {
            display: grid;
            grid-template-columns: 30px 1fr;
            gap: 10px;
            align-items: start;
            margin-bottom: 12px;
          }

          .lesson-index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: #0f766e;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
          }

          h2 {
            color: #0f172a;
            font-size: 18px;
            line-height: 1.2;
          }

          .lesson-heading p {
            margin-top: 2px;
            color: #64748b;
            font-size: 11px;
          }

          .lesson-block + .lesson-block {
            margin-top: 11px;
          }

          h3 {
            margin-bottom: 5px;
            color: #334155;
            font-size: 10px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .plan-text {
            white-space: pre-wrap;
          }

          ul {
            margin: 0;
            padding-left: 18px;
          }

          li + li {
            margin-top: 2px;
          }

          .muted {
            color: #64748b;
          }
        </style>
      </head>
      <body>
        <header>
          <h1>${escapedTitle}</h1>
          <p class="subtitle">${escapedClassName}</p>
          ${escapedFilterSummary ? `<p class="filter-summary">${escapedFilterSummary}</p>` : ''}
          <div class="meta">
            <span>${lessonLabel}</span>
            <span>Generated ${escapedGeneratedAt}</span>
          </div>
        </header>
        ${entriesHtml}
      </body>
    </html>`;
}

const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 54;
const PDF_BOTTOM_MARGIN = 54;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;

type LessonPlansPdfTextStyle = {
  font: 'regular' | 'bold';
  indent?: number;
  lineHeight?: number;
  size: number;
};

class LessonPlansPdfBuilder {
  private pages: string[][] = [];
  private currentPage: string[] = [];
  private y = PDF_PAGE_HEIGHT - PDF_MARGIN;

  constructor() {
    this.startPage();
  }

  addSeparator() {
    this.ensureSpace(14);
    const y = this.y - 3;
    this.currentPage.push(
      `q 0.86 0.91 0.96 RG 0.8 w ${formatPdfNumber(PDF_MARGIN)} ${formatPdfNumber(y)} m ${formatPdfNumber(
        PDF_PAGE_WIDTH - PDF_MARGIN
      )} ${formatPdfNumber(y)} l S Q`
    );
    this.y -= 12;
  }

  addText(text: string, style: LessonPlansPdfTextStyle) {
    const lineHeight = style.lineHeight ?? Math.round(style.size * 1.35);
    const indent = style.indent ?? 0;
    const x = PDF_MARGIN + indent;
    const lines = wrapPdfText(text, PDF_CONTENT_WIDTH - indent, style.size, style.font);

    if (lines.length === 0) {
      this.ensureSpace(lineHeight);
      this.y -= lineHeight;
      return;
    }

    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.currentPage.push(
        `BT /${style.font === 'bold' ? 'F2' : 'F1'} ${formatPdfNumber(style.size)} Tf ${formatPdfNumber(
          x
        )} ${formatPdfNumber(this.y)} Td (${escapePdfString(line)}) Tj ET`
      );
      this.y -= lineHeight;
    }
  }

  addGap(size: number) {
    this.ensureSpace(size);
    this.y -= size;
  }

  ensureSpace(height: number) {
    if (this.y - height >= PDF_BOTTOM_MARGIN) {
      return;
    }

    this.startPage();
  }

  startPage() {
    if (this.currentPage.length > 0) {
      this.pages.push(this.currentPage);
    }

    this.currentPage = [];
    this.y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  }

  toBuffer() {
    if (this.currentPage.length > 0) {
      this.pages.push(this.currentPage);
      this.currentPage = [];
    }

    return buildPdfBufferFromPageStreams(this.pages.map((page) => page.join('\n')));
  }
}

function formatPdfNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function normalizePdfText(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\u2026/g, '...')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      if (character === '\n') {
        return character;
      }

      if (code < 32) {
        return ' ';
      }

      return code <= 255 ? character : '?';
    })
    .join('');
}

function escapePdfString(value: string) {
  return normalizePdfText(value).replace(/[\\()]/g, (character) => `\\${character}`);
}

function estimatePdfTextWidth(value: string, size: number, font: 'regular' | 'bold') {
  const weight = font === 'bold' ? 0.56 : 0.52;
  return normalizePdfText(value).length * size * weight;
}

function splitLongPdfWord(word: string, maxWidth: number, size: number, font: 'regular' | 'bold') {
  const characters = Array.from(word);
  const chunks: string[] = [];
  let current = '';

  for (const character of characters) {
    const candidate = `${current}${character}`;
    if (current && estimatePdfTextWidth(candidate, size, font) > maxWidth) {
      chunks.push(current);
      current = character;
      continue;
    }

    current = candidate;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function wrapPdfParagraph(paragraph: string, maxWidth: number, size: number, font: 'regular' | 'bold') {
  const words = normalizePdfText(paragraph).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const wordParts =
      estimatePdfTextWidth(word, size, font) > maxWidth
        ? splitLongPdfWord(word, maxWidth, size, font)
        : [word];

    for (const wordPart of wordParts) {
      const candidate = currentLine ? `${currentLine} ${wordPart}` : wordPart;
      if (currentLine && estimatePdfTextWidth(candidate, size, font) > maxWidth) {
        lines.push(currentLine);
        currentLine = wordPart;
        continue;
      }

      currentLine = candidate;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapPdfText(text: string, maxWidth: number, size: number, font: 'regular' | 'bold') {
  return normalizePdfText(text)
    .split('\n')
    .flatMap((paragraph) => {
      if (!paragraph.trim()) {
        return [''];
      }

      return wrapPdfParagraph(paragraph, maxWidth, size, font);
    });
}

function buildPdfBufferFromPageStreams(pageStreams: string[]) {
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  let nextObjectId = 1;

  const catalogObjectId = nextObjectId++;
  const pagesObjectId = nextObjectId++;
  const regularFontObjectId = nextObjectId++;
  const boldFontObjectId = nextObjectId++;

  for (const _pageStream of pageStreams) {
    pageObjectIds.push(nextObjectId++);
    contentObjectIds.push(nextObjectId++);
  }

  objects[catalogObjectId] = `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`;
  objects[pagesObjectId] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((objectId) => `${objectId} 0 R`)
    .join(' ')}] /Count ${pageObjectIds.length} >>`;
  objects[regularFontObjectId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[boldFontObjectId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  pageStreams.forEach((stream, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = contentObjectIds[index];
    const streamLength = Buffer.byteLength(stream, 'binary');

    objects[pageObjectId] =
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${formatPdfNumber(PDF_PAGE_WIDTH)} ${formatPdfNumber(
        PDF_PAGE_HEIGHT
      )}] /Resources << /Font << /F1 ${regularFontObjectId} 0 R /F2 ${boldFontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];

  for (let objectId = 1; objectId < nextObjectId; objectId += 1) {
    offsets[objectId] = Buffer.byteLength(pdf, 'binary');
    pdf += `${objectId} 0 obj\n${objects[objectId]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${nextObjectId}\n0000000000 65535 f \n`;

  for (let objectId = 1; objectId < nextObjectId; objectId += 1) {
    pdf += `${`${offsets[objectId]}`.padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${nextObjectId} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'binary');
}

function addLessonPlansPdfLabel(builder: LessonPlansPdfBuilder, label: string) {
  builder.addText(label, {
    font: 'bold',
    lineHeight: 12,
    size: 8
  });
}

function addLessonPlansPdfEntry(
  builder: LessonPlansPdfBuilder,
  entry: LessonPlansPdfEntry,
  options: LessonPlansPdfExportOptions,
  index: number
) {
  builder.ensureSpace(104);
  builder.addText(`${index + 1}. ${entry.dateLabel}`, {
    font: 'bold',
    lineHeight: 19,
    size: 14
  });

  const metaItems = [
    entry.dateKey,
    options.includeClassName ? entry.className : '',
    entry.schoolTerm ? entry.termLabel : '',
    entry.schoolWeek ? entry.weekLabel : ''
  ].filter(Boolean);

  if (metaItems.length > 0) {
    builder.addText(metaItems.join(' | '), {
      font: 'regular',
      lineHeight: 13,
      size: 9
    });
  }

  if (options.includePlanText) {
    builder.addGap(3);
    addLessonPlansPdfLabel(builder, 'LESSON PLAN');
    builder.addText(entry.plan || 'No written plan saved.', {
      font: 'regular',
      lineHeight: 13,
      size: 10
    });
  }

  if (options.includeAttachedFiles) {
    builder.addGap(5);
    addLessonPlansPdfLabel(builder, 'ATTACHED FILES');

    if (entry.documentNames.length > 0) {
      entry.documentNames.forEach((documentName) =>
        builder.addText(`- ${documentName}`, {
          font: 'regular',
          indent: 12,
          lineHeight: 12,
          size: 9
        })
      );
    } else {
      builder.addText('No files attached for this day.', {
        font: 'regular',
        lineHeight: 12,
        size: 9
      });
    }
  }

  builder.addSeparator();
}

async function renderLessonPlansPdf(payload: LessonPlansPdfExportPayload) {
  const builder = new LessonPlansPdfBuilder();
  const groups = groupLessonPlansPdfEntries(payload);
  let entryIndex = 0;

  builder.addText(payload.options.title, {
    font: 'bold',
    lineHeight: 30,
    size: 23
  });
  builder.addText(payload.className, {
    font: 'regular',
    lineHeight: 17,
    size: 12
  });

  if (payload.options.filterSummary) {
    builder.addText(payload.options.filterSummary, {
      font: 'regular',
      lineHeight: 14,
      size: 9
    });
  }

  builder.addGap(4);
  builder.addText(
    `${payload.entries.length} lesson${payload.entries.length === 1 ? '' : 's'} | Generated ${
      payload.exportedAtLabel || new Date().toLocaleString()
    }`,
    {
      font: 'bold',
      lineHeight: 15,
      size: 9
    }
  );
  builder.addSeparator();

  groups.forEach((group, groupIndex) => {
    if (shouldBreakBeforeGroup(groupIndex, payload.options.groupBy, payload.options.pageBreak)) {
      builder.startPage();
    }

    if (group.label) {
      builder.addText(group.label, {
        font: 'bold',
        lineHeight: 20,
        size: 15
      });
      builder.addGap(2);
    }

    group.entries.forEach((entry) => {
      if (payload.options.pageBreak === 'lesson' && entryIndex > 0) {
        builder.startPage();
      }

      addLessonPlansPdfEntry(builder, entry, payload.options, entryIndex);
      entryIndex += 1;
    });
  });

  return builder.toBuffer();
}

function getLessonPlansPdfExportErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'The lesson plan PDF could not be generated.';
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

function normalizeTimerSpeechVoice(value: unknown): TimerSpeechVoice {
  return value === 'female' ? 'female' : 'male';
}

function getTimerSpeechVoice() {
  return normalizeTimerSpeechVoice(
    ensurePersistentStateCache().valuesByKey[TIMER_SPEECH_VOICE_SETTINGS_KEY]
  );
}

function setTimerSpeechVoice(voice: unknown) {
  setPersistentStateValue(TIMER_SPEECH_VOICE_SETTINGS_KEY, normalizeTimerSpeechVoice(voice));
  broadcastAppSettings();
  return getAppSettings();
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

function setOverlayInteractive(interactive: boolean) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  if (interactive) {
    overlayWindow.setIgnoreMouseEvents(false);
    return;
  }

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
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

function isRunningFromDefaultElectronApp() {
  return process.defaultApp === true || app.getName() === 'Electron';
}

function shouldBlockLaunchAtLogin() {
  return process.platform === 'darwin' && !app.isPackaged && isRunningFromDefaultElectronApp();
}

function getLaunchAtLoginSettings() {
  if (shouldBlockLaunchAtLogin()) {
    return {
      ...app.getLoginItemSettings(),
      openAtLogin: false
    };
  }

  return app.getLoginItemSettings();
}

function clearBlockedLaunchAtLogin() {
  if (shouldBlockLaunchAtLogin() && app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: false });
  }
}

function getAppSettings(): AppSettings {
  return {
    launchAtLogin: getLaunchAtLoginSettings().openAtLogin,
    timerSpeechVoice: getTimerSpeechVoice()
  };
}

function speakTimerText(text: unknown) {
  if (typeof text !== 'string' || !text.trim()) {
    return false;
  }

  if (process.platform !== 'darwin') {
    return false;
  }

  const spokenText = text.trim().slice(0, 160);

  try {
    if (activeTimerSpeechProcess) {
      activeTimerSpeechProcess.kill();
      activeTimerSpeechProcess = null;
    }

    const voiceName = getTimerSpeechVoice() === 'female' ? 'Samantha' : 'Alex';
    const speechProcess = spawn('say', ['-v', voiceName, '-r', '175', spokenText], {
      stdio: 'ignore'
    });
    activeTimerSpeechProcess = speechProcess;
    speechProcess.once('close', () => {
      activeTimerSpeechProcess = null;
    });
    speechProcess.once('error', () => {
      activeTimerSpeechProcess = null;
    });
    return true;
  } catch {
    activeTimerSpeechProcess = null;
    return false;
  }
}

function broadcastAppSettings() {
  const settings = getAppSettings();
  const targetWindows = [
    overlayWindow,
    popoverWindow,
    builderWindow,
    widgetPickerWindow,
    ...widgetPopoutWindows.values()
  ];

  targetWindows.forEach((targetWindow) => {
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('app-settings:changed', settings);
    }
  });
}

function setLaunchAtLogin(enabled: boolean) {
  if (enabled && shouldBlockLaunchAtLogin()) {
    app.setLoginItemSettings({ openAtLogin: false });
  } else {
    app.setLoginItemSettings({
      openAtLogin: enabled
    });
  }

  broadcastAppSettings();
  refreshTrayMenu();
  return getAppSettings();
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
  setOverlayInteractive(false);
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
        checked: getAppSettings().launchAtLogin,
        label: 'Open at Login',
        type: 'checkbox',
        click: (menuItem) => setLaunchAtLogin(menuItem.checked)
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
  if (!shouldUseTray) {
    return;
  }

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
  if (shouldUseDock) {
    app.setActivationPolicy('regular');
    app.dock.show();
  }

  clearBlockedLaunchAtLogin();
  preferredPopoverSize = loadStoredPopoverSize();
  ensurePersistentStateCache();
  createOverlayWindow();
  if (shouldUseTray) {
    createTray();
  }
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

ipcMain.handle('app-settings:get', () => {
  return getAppSettings();
});

ipcMain.handle('app-settings:set-launch-at-login', (_event, enabled: unknown) => {
  return setLaunchAtLogin(enabled === true);
});

ipcMain.handle('app-settings:set-timer-speech-voice', (_event, voice: unknown) => {
  return setTimerSpeechVoice(voice);
});

ipcMain.handle('timer:speak', (_event, text: unknown) => {
  return speakTimerText(text);
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

ipcMain.on('overlay:set-interactive', (_event, interactive: unknown) => {
  setOverlayInteractive(interactive === true);
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

ipcMain.handle('lesson-plans:export-pdf', async (event, payloadRaw: unknown): Promise<LessonPlansPdfExportResult> => {
  const payload = normalizeLessonPlansPdfPayload(payloadRaw);

  if (!payload) {
    return {
      canceled: false,
      errorMessage: 'No previous lesson plans were available to export.',
      ok: false
    };
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const focusedWindow =
    senderWindow ??
    BrowserWindow.getFocusedWindow() ??
    popoverWindow ??
    builderWindow ??
    widgetPickerWindow ??
    overlayWindow ??
    null;
  const todaySegment = new Date().toISOString().slice(0, 10);
  const defaultFileName = `lesson-plans-${sanitizeFileSegment(payload.className)}-${todaySegment}.pdf`;
  const dialogOptions: Electron.SaveDialogOptions = {
    buttonLabel: 'Export PDF',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    title: `Export ${payload.className} lesson plans`
  };
  if (focusedWindow && !focusedWindow.isDestroyed()) {
    if (focusedWindow.isMinimized()) {
      focusedWindow.restore();
    }

    focusedWindow.show();
    focusedWindow.focus();
  }

  const result = focusedWindow
    ? await dialog.showSaveDialog(focusedWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return {
      canceled: true,
      ok: false
    };
  }

  const targetPath = result.filePath.toLowerCase().endsWith('.pdf')
    ? result.filePath
    : `${result.filePath}.pdf`;

  try {
    const pdfBuffer = await renderLessonPlansPdf(payload);
    fs.writeFileSync(targetPath, pdfBuffer);

    return {
      canceled: false,
      filePath: targetPath,
      ok: true
    };
  } catch (error) {
    return {
      canceled: false,
      errorMessage: getLessonPlansPdfExportErrorMessage(error),
      ok: false
    };
  }
});

ipcMain.on('app:quit', () => {
  app.quit();
});
