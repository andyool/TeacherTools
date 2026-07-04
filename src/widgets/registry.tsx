import type { WidgetPopoutId } from '../electron-types';

export type WidgetId = WidgetPopoutId;

export const WIDGET_IDS: WidgetId[] = [
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

export const WIDGET_POPOUT_MIN_SIZES: Record<WidgetId, { minHeight: number; minWidth: number }> = {
  timer: { minWidth: 280, minHeight: 224 },
  picker: { minWidth: 300, minHeight: 290 },
  'group-maker': { minWidth: 320, minHeight: 280 },
  'seating-chart': { minWidth: 760, minHeight: 560 },
  'bell-schedule': { minWidth: 340, minHeight: 300 },
  'homework-assessment': { minWidth: 520, minHeight: 520 },
  'qr-generator': { minWidth: 320, minHeight: 320 },
  notes: { minWidth: 300, minHeight: 244 },
  planner: { minWidth: 760, minHeight: 560 }
};

export const WIDGET_POPOUT_DEFAULT_SIZES: Record<WidgetId, { height: number; width: number }> = {
  timer: { width: 352, height: 344 },
  picker: { width: 392, height: 372 },
  'group-maker': { width: 600, height: 456 },
  'seating-chart': { width: 980, height: 760 },
  'bell-schedule': { width: 1220, height: 840 },
  'homework-assessment': { width: 820, height: 860 },
  'qr-generator': { width: 420, height: 460 },
  notes: { width: 420, height: 420 },
  planner: { width: 1180, height: 820 }
};

export const WIDGET_DETAILS: Record<
  WidgetId,
  {
    description: string;
    title: string;
  }
> = {
  timer: {
    title: 'Timer',
    description: 'Countdown presets, stopwatch mode, and named class timers.'
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
    title: 'Timetable',
    description: 'Track the current period, time remaining, and your saved weekly profiles.'
  },
  planner: {
    title: 'Lesson Planner',
    description: 'Plan each class by date and keep lesson documents attached.'
  },
  'homework-assessment': {
    title: 'Homework & Assessments',
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

export function isWidgetId(value: string): value is WidgetId {
  return WIDGET_IDS.includes(value as WidgetId);
}
