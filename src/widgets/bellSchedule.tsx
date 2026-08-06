import { useState } from 'react';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { returnToTeacherTools } from '../app/windowContext';
import { formatDateKey, formatLongDate, getDaysUntilDateKey, getMinutesSinceMidnight, getTimestampForMinutes, getTodayDateKey, normalizeDateKey, shiftDateKey } from '../shared/dates';
import { useClockNow, usePersistentState } from '../shared/persistence';
import { requestConfirm, showUndoToast } from '../shared/uiKit';
import { clampNumber, createStickyNoteId, formatDuration } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import { usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';

export type BellScheduleDayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export type BellScheduleSlotId = string;

export type BellScheduleSlotKind = 'break' | 'teaching';

export type BellScheduleSlotAssignment = {
  classListId: string | null;
  enabled: boolean;
};

export type BellScheduleDay = {
  assignmentsBySlotId: Partial<Record<BellScheduleSlotId, BellScheduleSlotAssignment>>;
  slotDefinitions: BellScheduleSlotDefinition[];
};

export type BellScheduleProfile = {
  days: Record<BellScheduleDayKey, BellScheduleDay>;
  id: string;
  name: string;
};

export type BellSchedulePopoutMode = 'editor' | 'summary';

export type BellScheduleWeekLetter = 'A' | 'B';

export type BellScheduleRotation = {
  anchorMondayKey: string | null;
  enabled: boolean;
  profileAId: string | null;
  profileBId: string | null;
};

export type BellScheduleEndOfPeriodAlert = {
  enabled: boolean;
  minutesBefore: number;
};

export type BellScheduleSnapshot = {
  activeProfileId: string | null;
  dayOverrides: Record<string, string>;
  endOfPeriodAlert: BellScheduleEndOfPeriodAlert;
  holidayDateKeys: string[];
  profiles: BellScheduleProfile[];
  rotation: BellScheduleRotation;
};

export type BellScheduleSlotDefinition = {
  endMinutes: number;
  id: BellScheduleSlotId;
  kind: BellScheduleSlotKind;
  label: string;
  shortLabel: string;
  startMinutes: number;
};

export type BellTimelineEntry = {
  assignment: BellScheduleSlotAssignment;
  classList: ClassList | null;
  dayKey: BellScheduleDayKey;
  definition: BellScheduleSlotDefinition;
  status: 'break' | 'free' | 'teaching';
};

export const BELL_SCHEDULE_DAY_KEYS: BellScheduleDayKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday'
];

export const BELL_SCHEDULE_DAY_LABELS: Record<BellScheduleDayKey, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday'
};

export const BELL_SCHEDULE_SLOT_DEFINITIONS: BellScheduleSlotDefinition[] = [
  { id: 'period-1', label: 'Period 1', shortLabel: 'P1', kind: 'teaching', startMinutes: 8 * 60 + 48, endMinutes: 9 * 60 + 48 },
  { id: 'period-2', label: 'Period 2', shortLabel: 'P2', kind: 'teaching', startMinutes: 9 * 60 + 48, endMinutes: 10 * 60 + 48 },
  { id: 'recess', label: 'Recess', shortLabel: 'Rec', kind: 'break', startMinutes: 10 * 60 + 48, endMinutes: 11 * 60 + 13 },
  { id: 'homeroom', label: 'Homeroom', shortLabel: 'HR', kind: 'teaching', startMinutes: 11 * 60 + 13, endMinutes: 11 * 60 + 25 },
  { id: 'period-3', label: 'Period 3', shortLabel: 'P3', kind: 'teaching', startMinutes: 11 * 60 + 25, endMinutes: 12 * 60 + 25 },
  { id: 'period-4', label: 'Period 4', shortLabel: 'P4', kind: 'teaching', startMinutes: 12 * 60 + 25, endMinutes: 13 * 60 + 25 },
  { id: 'lunch', label: 'Lunch', shortLabel: 'Lunch', kind: 'break', startMinutes: 13 * 60 + 25, endMinutes: 13 * 60 + 50 },
  { id: 'period-5', label: 'Period 5', shortLabel: 'P5', kind: 'teaching', startMinutes: 13 * 60 + 50, endMinutes: 14 * 60 + 50 }
];

export const DEFAULT_BELL_SCHEDULE_PROFILE = createBellScheduleProfile({
  id: 'bell-schedule-default-profile',
  name: 'Standard Week'
});

export const DEFAULT_BELL_SCHEDULE_ROTATION: BellScheduleRotation = {
  anchorMondayKey: null,
  enabled: false,
  profileAId: null,
  profileBId: null
};

export const DEFAULT_BELL_SCHEDULE_END_OF_PERIOD_ALERT: BellScheduleEndOfPeriodAlert = {
  enabled: false,
  minutesBefore: 5
};

export const BELL_SCHEDULE_ALERT_MINUTES_MIN = 1;

export const BELL_SCHEDULE_ALERT_MINUTES_MAX = 30;

export const DEFAULT_BELL_SCHEDULE: BellScheduleSnapshot = {
  activeProfileId: DEFAULT_BELL_SCHEDULE_PROFILE.id,
  dayOverrides: {},
  endOfPeriodAlert: DEFAULT_BELL_SCHEDULE_END_OF_PERIOD_ALERT,
  holidayDateKeys: [],
  profiles: [DEFAULT_BELL_SCHEDULE_PROFILE],
  rotation: DEFAULT_BELL_SCHEDULE_ROTATION
};

const BELL_SCHEDULE_NO_SCHOOL_OPTION = 'no-school';

export function BellScheduleWidgetContent({
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
  const visibleUpcomingEntries = controller.upcomingEntries.slice(0, 3);
  const previewEntries =
    visibleUpcomingEntries.length > 0 ? visibleUpcomingEntries : controller.mondayPreviewEntries;
  const previewHeading = controller.currentEntry
    ? 'Up next'
    : controller.todayDayKey
      ? 'Later today'
      : 'Monday';
  const focusEntry = controller.currentEntry ?? controller.nextEntry;
  const heroTitle = controller.currentEntry
    ? controller.currentEntry.definition.label
    : controller.nextEntry
      ? controller.nextEntry.definition.label
      : controller.isTodayNoSchool
        ? 'No school'
        : controller.todayDayKey
          ? 'No live period'
          : 'No school period today';
  const heroEyebrow = controller.currentEntry
    ? `Now · ${todayHeading} · ${controller.liveScheduleLabel}`
    : controller.nextEntry
      ? `Up next · ${todayHeading}${controller.liveWeekLetter ? ` · Week ${controller.liveWeekLetter}` : ''}`
      : `${todayHeading} · ${controller.liveScheduleLabel}`;
  const heroDetail = controller.currentEntry
    ? formatBellScheduleEntryDetail(controller.currentEntry)
    : controller.nextEntry
      ? `${formatBellScheduleEntryDetail(controller.nextEntry)} · starts in ${formatDuration(
          controller.timeUntilNextEntryMs
        )}`
      : controller.isTodayNoSchool
        ? 'No school today.'
        : controller.todayDayKey
          ? 'Done for today.'
          : 'Weekend — back on Monday.';
  const liveRemainingLabel = controller.currentEntry
    ? `${formatDuration(controller.currentRemainingMs)} remaining`
    : null;
  const liveRemainingTone = controller.currentEntry
    ? controller.currentRemainingMs <= 2 * 60 * 1000
      ? 'danger'
      : controller.currentRemainingMs <= 10 * 60 * 1000
        ? 'warning'
        : 'ready'
    : null;
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
            className={`secondary-link button-tone--utility ${showEditor ? '' : 'window-spawn-button'}`}
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
            <div className="bell-schedule__summary-title-row">
              <h3 className="bell-schedule__summary-title">{heroTitle}</h3>
              {focusEntry ? (
                <span className="bell-schedule__summary-time">
                  {formatBellTimeRange(focusEntry.definition)}
                </span>
              ) : null}
            </div>
            <div className="bell-schedule__summary-detail-row">
              <p className="bell-schedule__summary-detail">{heroDetail}</p>
              {liveRemainingLabel ? (
                <span
                  className={`bell-schedule__summary-countdown ${
                    liveRemainingTone ? `bell-schedule__summary-countdown--${liveRemainingTone}` : ''
                  }`}
                >
                  {liveRemainingLabel}
                </span>
              ) : null}
            </div>
          </div>
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

      {previewEntries.length > 0 ? (
        <section className="bell-schedule__upcoming">
          <div className="bell-schedule__upcoming-header">
            <span className="field-label">{previewHeading}</span>
          </div>

          <div className="bell-schedule__upcoming-list">
            {previewEntries.map((entry) => (
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

export function BellScheduleEditorPanel({
  controller
}: {
  controller: ReturnType<typeof useBellScheduleController>;
}) {
  const [addMenuDayKey, setAddMenuDayKey] = useState<BellScheduleDayKey | null>(null);
  const [copyMenuDayKey, setCopyMenuDayKey] = useState<BellScheduleDayKey | null>(null);
  const [timeEditorDayKey, setTimeEditorDayKey] = useState<BellScheduleDayKey | null>(null);
  const [overrideDateDraft, setOverrideDateDraft] = useState(getTodayDateKey());
  const [overrideProfileDraft, setOverrideProfileDraft] = useState('');
  const rotation = controller.bellSchedule.rotation;
  const endOfPeriodAlert = controller.bellSchedule.endOfPeriodAlert;
  const overrideEntries = Object.entries(controller.bellSchedule.dayOverrides).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  const profileById = new Map(
    controller.bellSchedule.profiles.map((profile) => [profile.id, profile] as const)
  );
  const otherWeekLetter: BellScheduleWeekLetter = controller.liveWeekLetter === 'A' ? 'B' : 'A';
  const overrideProfileId =
    overrideProfileDraft || controller.activeProfile?.id || controller.bellSchedule.profiles[0]?.id || '';
  const overrideListItems = [
    ...overrideEntries.map(([dateKey, profileId]) => ({ dateKey, profileId })),
    ...controller.bellSchedule.holidayDateKeys.map((dateKey) => ({ dateKey, profileId: null }))
  ].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  const isEditingOtherProfile =
    controller.activeProfile !== null &&
    controller.liveProfile !== null &&
    controller.activeProfile.id !== controller.liveProfile.id;

  return (
    <section className="bell-schedule-editor">
      {isEditingOtherProfile ? (
        <span className="bell-schedule-editor__live-warning">
          Editing {controller.activeProfileDisplayName} — today runs{' '}
          {controller.liveProfileDisplayName}
        </span>
      ) : null}

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
            className="primary-link"
            onClick={controller.createProfile}
            type="button"
          >
            New profile
          </button>
          <button
            className="danger-link"
            disabled={controller.bellSchedule.profiles.length === 1}
            onClick={controller.deleteActiveProfile}
            type="button"
          >
            Delete profile
          </button>
        </div>
      </div>

      <div className="bell-schedule-editor__settings">
        <section className="bell-schedule-editor__setting">
          <label className="bell-schedule-editor__toggle">
            <input
              checked={rotation.enabled}
              onChange={(event) => controller.setRotationEnabled(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>Week A / Week B rotation</span>
          </label>
          <p className="helper-text">
            Alternate two profiles automatically by calendar week — no more switching by hand.
          </p>
          {rotation.enabled ? (
            <>
              <div className="bell-schedule-editor__setting-grid">
                {(['A', 'B'] as const).map((weekLetter) => (
                  <label className="field-stack" key={weekLetter}>
                    <span className="field-label">Week {weekLetter} profile</span>
                    <select
                      className="text-field"
                      onChange={(event) =>
                        controller.setRotationProfile(weekLetter, event.target.value)
                      }
                      value={
                        (weekLetter === 'A' ? rotation.profileAId : rotation.profileBId) ?? ''
                      }
                    >
                      <option value="">Choose profile</option>
                      {controller.bellSchedule.profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {getBellScheduleProfileDisplayName(profile)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="custom-row">
                <span className="helper-text">
                  {controller.liveWeekLetter
                    ? `This week is Week ${controller.liveWeekLetter}.`
                    : 'Choose profiles for both weeks to start rotating.'}
                </span>
                <button
                  className="secondary-link button-tone--utility"
                  onClick={() => controller.markThisWeek(otherWeekLetter)}
                  type="button"
                >
                  Make this week {otherWeekLetter}
                </button>
              </div>
            </>
          ) : null}
        </section>

        <section className="bell-schedule-editor__setting">
          <span className="field-label">One-off day overrides</span>
          <p className="helper-text">
            Point a single date at a different profile (assembly, short day) without editing the
            week.
          </p>
          <div className="bell-schedule-editor__override-row">
            <input
              aria-label="Override date"
              className="text-field"
              onChange={(event) => setOverrideDateDraft(event.target.value)}
              type="date"
              value={overrideDateDraft}
            />
            <select
              aria-label="Override profile"
              className="text-field"
              onChange={(event) => setOverrideProfileDraft(event.target.value)}
              value={overrideProfileId}
            >
              {controller.bellSchedule.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {getBellScheduleProfileDisplayName(profile)}
                </option>
              ))}
              <option value={BELL_SCHEDULE_NO_SCHOOL_OPTION}>No school</option>
            </select>
            <button
              className="secondary-link"
              disabled={!normalizeDateKey(overrideDateDraft) || !overrideProfileId}
              onClick={() => {
                if (overrideProfileId === BELL_SCHEDULE_NO_SCHOOL_OPTION) {
                  controller.addHolidayDate(overrideDateDraft);
                  return;
                }

                controller.addDayOverride(overrideDateDraft, overrideProfileId);
              }}
              type="button"
            >
              Add
            </button>
          </div>
          {overrideListItems.length > 0 ? (
            <div className="bell-schedule-editor__override-list">
              {overrideListItems.map(({ dateKey, profileId }) => (
                <div className="bell-schedule-editor__override-item" key={dateKey}>
                  <span>
                    {formatLongDate(dateKey)} →{' '}
                    {profileId === null
                      ? 'No school'
                      : profileById.get(profileId)
                        ? getBellScheduleProfileDisplayName(profileById.get(profileId)!)
                        : 'Missing profile'}
                  </span>
                  <button
                    aria-label={`Remove override for ${formatLongDate(dateKey)}`}
                    className="icon-button"
                    onClick={() =>
                      profileId === null
                        ? controller.removeHolidayDate(dateKey)
                        : controller.removeDayOverride(dateKey)
                    }
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="bell-schedule-editor__setting">
          <label className="bell-schedule-editor__toggle">
            <input
              checked={endOfPeriodAlert.enabled}
              onChange={(event) =>
                controller.setEndOfPeriodAlertEnabled(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>Notify before a period ends</span>
          </label>
          {endOfPeriodAlert.enabled ? (
            <div className="custom-row">
              <span className="helper-text">Minutes before the bell</span>
              <input
                aria-label="Minutes before the period ends"
                className="text-field bell-schedule-editor__minutes-field"
                max={BELL_SCHEDULE_ALERT_MINUTES_MAX}
                min={BELL_SCHEDULE_ALERT_MINUTES_MIN}
                onChange={(event) =>
                  controller.setEndOfPeriodAlertMinutes(Number(event.target.value))
                }
                type="number"
                value={endOfPeriodAlert.minutesBefore}
              />
            </div>
          ) : (
            <p className="helper-text">
              Get a system notification like “5 minutes left in Period 3”.
            </p>
          )}
        </section>
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
            className="secondary-link button-tone--utility window-spawn-button"
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
                    aria-label={`Edit ${BELL_SCHEDULE_DAY_LABELS[dayKey]} blocks`}
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
                  <button
                    aria-label={`Copy ${BELL_SCHEDULE_DAY_LABELS[dayKey]} to another day`}
                    className={`icon-button button-tone--utility ${
                      copyMenuDayKey === dayKey ? 'icon-button--active' : ''
                    }`}
                    data-tooltip-content={`Copy ${BELL_SCHEDULE_DAY_LABELS[dayKey]}'s blocks to another day`}
                    disabled={dayEntries.length === 0}
                    onClick={() =>
                      setCopyMenuDayKey((currentDayKey) =>
                        currentDayKey === dayKey ? null : dayKey
                      )
                    }
                    type="button"
                  >
                    ⧉
                  </button>
                  {copyMenuDayKey === dayKey ? (
                    <div className="bell-schedule-editor__add-menu">
                      {BELL_SCHEDULE_DAY_KEYS.filter((targetDayKey) => targetDayKey !== dayKey).map(
                        (targetDayKey) => (
                          <button
                            className="secondary-link button-tone--utility"
                            key={targetDayKey}
                            onClick={() => {
                              controller.copyDaySchedule(dayKey, targetDayKey);
                              setCopyMenuDayKey(null);
                            }}
                            type="button"
                          >
                            → {BELL_SCHEDULE_DAY_LABELS[targetDayKey]}
                          </button>
                        )
                      )}
                      <button
                        className="secondary-link button-tone--utility"
                        onClick={() => {
                          controller.copyDayScheduleToAll(dayKey);
                          setCopyMenuDayKey(null);
                        }}
                        type="button"
                      >
                        → All weekdays
                      </button>
                    </div>
                  ) : null}
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
                          <>
                            <input
                              aria-label={`Rename ${entry.definition.label}`}
                              className="text-field bell-schedule-editor__slot-label-input"
                              defaultValue={entry.definition.label}
                              key={`${entry.definition.id}-${entry.definition.label}`}
                              onBlur={(event) => {
                                const nextLabel = event.target.value.trim();

                                if (nextLabel && nextLabel !== entry.definition.label) {
                                  controller.renameDaySlot(dayKey, entry.definition.id, nextLabel);
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.currentTarget.blur();
                                }
                              }}
                              type="text"
                            />
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
                            <div className="bell-schedule-editor__slot-tools">
                              <button
                                aria-label={`Insert lesson after ${entry.definition.label}`}
                                className="secondary-link button-tone--utility"
                                onClick={() =>
                                  controller.insertDaySlotAfter(dayKey, entry.definition.id, 'teaching')
                                }
                                type="button"
                              >
                                + Lesson
                              </button>
                              <button
                                aria-label={`Insert break after ${entry.definition.label}`}
                                className="secondary-link button-tone--utility"
                                onClick={() =>
                                  controller.insertDaySlotAfter(dayKey, entry.definition.id, 'break')
                                }
                                type="button"
                              >
                                + Break
                              </button>
                              <button
                                aria-label={`Delete ${entry.definition.label}`}
                                className="icon-button"
                                onClick={() =>
                                  controller.removeDaySlotById(dayKey, entry.definition.id)
                                }
                                type="button"
                              >
                                ×
                              </button>
                            </div>
                          </>
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
                    ) : null}
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

export function BellScheduleWidgetPopoutCard({
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
          : 'Set up a weekly timetable.'
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

export function useBellScheduleState() {
  return usePersistentState<BellScheduleSnapshot>(
    'teacher-tools.bell-schedule',
    DEFAULT_BELL_SCHEDULE,
    {
      normalize: normalizeBellScheduleSnapshot
    }
  );
}

export function useBellSchedulePopoutModeState() {
  return usePersistentState<BellSchedulePopoutMode>(
    'teacher-tools.bell-schedule-popout-mode',
    'summary',
    {
      normalize: normalizeBellSchedulePopoutMode
    }
  );
}

export function useBellScheduleController(classLists: ClassList[]) {
  const [bellSchedule, setBellSchedule] = useBellScheduleState();
  const [popoutMode, setPopoutMode] = useBellSchedulePopoutModeState();
  const now = useClockNow();
  const activeProfile =
    bellSchedule.profiles.find((profile) => profile.id === bellSchedule.activeProfileId) ??
    bellSchedule.profiles[0] ??
    null;
  const activeProfileDisplayName = activeProfile
    ? getBellScheduleProfileDisplayName(activeProfile)
    : 'Timetable';
  const todayDate = new Date(now);
  const todayDayKey = getBellScheduleDayKey(todayDate);
  const todayDateKey = formatDateKey(
    todayDate.getFullYear(),
    todayDate.getMonth(),
    todayDate.getDate()
  );
  const isTodayNoSchool = bellSchedule.holidayDateKeys.includes(todayDateKey);
  const currentMinutes = getMinutesSinceMidnight(todayDate);
  const liveResolution = resolveBellScheduleProfileForDate(bellSchedule, todayDate);
  const liveProfile = liveResolution.profile ?? activeProfile;
  const liveProfileDisplayName = liveProfile
    ? getBellScheduleProfileDisplayName(liveProfile)
    : activeProfileDisplayName;
  const liveScheduleLabel =
    liveResolution.source === 'override'
      ? `${liveProfileDisplayName} · today only`
      : liveResolution.weekLetter
        ? `${liveProfileDisplayName} · Week ${liveResolution.weekLetter}`
        : liveProfileDisplayName;
  const weekTimelineByDay = activeProfile
    ? Object.fromEntries(
        BELL_SCHEDULE_DAY_KEYS.map((dayKey) => [
          dayKey,
          buildBellTimelineEntries(activeProfile, dayKey, classLists)
        ])
      ) as Record<BellScheduleDayKey, BellTimelineEntry[]>
    : createEmptyBellTimelineByDay();
  const todayTimeline =
    !isTodayNoSchool && todayDayKey && liveProfile
      ? buildBellTimelineEntries(liveProfile, todayDayKey, classLists)
      : [];
  const mondayPreviewEntries = (() => {
    if (todayDayKey) {
      return [] as BellTimelineEntry[];
    }

    const daysUntilMonday = ((1 - todayDate.getDay()) + 7) % 7 || 7;
    const mondayDate = new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate() + daysUntilMonday
    );
    const mondayDateKey = formatDateKey(
      mondayDate.getFullYear(),
      mondayDate.getMonth(),
      mondayDate.getDate()
    );

    if (bellSchedule.holidayDateKeys.includes(mondayDateKey)) {
      return [] as BellTimelineEntry[];
    }

    const mondayProfile = resolveBellScheduleProfileForDate(bellSchedule, mondayDate).profile;

    return mondayProfile
      ? buildBellTimelineEntries(mondayProfile, 'monday', classLists).slice(0, 3)
      : [];
  })();
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
    ? `${currentEntry.definition.shortLabel} · ${Math.max(
        1,
        Math.ceil(currentRemainingMs / 60000)
      )}m`
    : nextEntry
      ? `Next ${nextEntry.definition.shortLabel}`
      : null;

  const selectProfile = (profileId: string) => {
    setBellSchedule((current) => selectBellScheduleProfile(current, profileId));
  };

  const createProfile = () => {
    setBellSchedule((current) => addBellScheduleProfile(current, current.activeProfileId));
  };

  const deleteActiveProfile = async () => {
    const profileToDelete = activeProfile;

    if (!profileToDelete || bellSchedule.profiles.length <= 1) {
      return;
    }

    const displayName = getBellScheduleProfileDisplayName(profileToDelete);
    const confirmed = await requestConfirm({
      confirmLabel: 'Delete',
      message: `${displayName} and its week layout will be removed.`,
      title: 'Delete this week profile?',
      tone: 'danger'
    });

    if (!confirmed) {
      return;
    }

    const previous = bellSchedule;

    setBellSchedule((current) => removeBellScheduleProfile(current, profileToDelete.id));
    showUndoToast(`Deleted ${displayName}`, () => {
      setBellSchedule((current) => {
        if (current.profiles.some((profile) => profile.id === profileToDelete.id)) {
          return current;
        }

        const restoredOverrides = { ...current.dayOverrides };

        Object.entries(previous.dayOverrides).forEach(([dateKey, profileId]) => {
          if (profileId === profileToDelete.id && !restoredOverrides[dateKey]) {
            restoredOverrides[dateKey] = profileId;
          }
        });

        return {
          ...current,
          activeProfileId: profileToDelete.id,
          dayOverrides: restoredOverrides,
          profiles: [...current.profiles, profileToDelete],
          rotation: {
            ...current.rotation,
            profileAId:
              current.rotation.profileAId ??
              (previous.rotation.profileAId === profileToDelete.id ? profileToDelete.id : null),
            profileBId:
              current.rotation.profileBId ??
              (previous.rotation.profileBId === profileToDelete.id ? profileToDelete.id : null)
          }
        };
      });
    });
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

  const removeDaySlotById = (dayKey: BellScheduleDayKey, slotId: BellScheduleSlotId) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? removeBellScheduleDaySlotById(current, current.activeProfileId, dayKey, slotId)
        : current
    );
  };

  const insertDaySlotAfter = (
    dayKey: BellScheduleDayKey,
    slotId: BellScheduleSlotId,
    kind: BellScheduleSlotKind
  ) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? insertBellScheduleDaySlotAfter(current, current.activeProfileId, dayKey, slotId, kind)
        : current
    );
  };

  const renameDaySlot = (dayKey: BellScheduleDayKey, slotId: BellScheduleSlotId, label: string) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? updateBellScheduleDaySlotLabel(current, current.activeProfileId, dayKey, slotId, label)
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

  const copyDaySchedule = (fromDayKey: BellScheduleDayKey, toDayKey: BellScheduleDayKey) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? copyBellScheduleDay(current, current.activeProfileId, fromDayKey, toDayKey)
        : current
    );
  };

  const copyDayScheduleToAll = (fromDayKey: BellScheduleDayKey) => {
    setBellSchedule((current) =>
      current.activeProfileId
        ? copyBellScheduleDayToAllDays(current, current.activeProfileId, fromDayKey)
        : current
    );
  };

  const setRotationEnabled = (enabled: boolean) => {
    setBellSchedule((current) => {
      const fallbackProfileId = current.activeProfileId ?? current.profiles[0]?.id ?? null;
      const otherProfileId =
        current.profiles.find((profile) => profile.id !== fallbackProfileId)?.id ??
        fallbackProfileId;

      return {
        ...current,
        rotation: {
          anchorMondayKey:
            current.rotation.anchorMondayKey ?? getBellScheduleMondayKey(new Date(now)),
          enabled,
          profileAId: current.rotation.profileAId ?? fallbackProfileId,
          profileBId: current.rotation.profileBId ?? otherProfileId
        }
      };
    });
  };

  const setRotationProfile = (weekLetter: BellScheduleWeekLetter, profileId: string) => {
    setBellSchedule((current) => ({
      ...current,
      rotation: {
        ...current.rotation,
        [weekLetter === 'A' ? 'profileAId' : 'profileBId']: profileId
      }
    }));
  };

  const markThisWeek = (weekLetter: BellScheduleWeekLetter) => {
    const thisMondayKey = getBellScheduleMondayKey(new Date(now));

    setBellSchedule((current) => ({
      ...current,
      rotation: {
        ...current.rotation,
        anchorMondayKey:
          weekLetter === 'A' ? thisMondayKey : shiftDateKey(thisMondayKey, -7)
      }
    }));
  };

  const addDayOverride = (dateKey: string, profileId: string) => {
    const normalizedDate = normalizeDateKey(dateKey);

    if (!normalizedDate) {
      return;
    }

    setBellSchedule((current) =>
      current.profiles.some((profile) => profile.id === profileId)
        ? {
            ...current,
            dayOverrides: {
              ...current.dayOverrides,
              [normalizedDate]: profileId
            },
            holidayDateKeys: current.holidayDateKeys.filter(
              (holidayKey) => holidayKey !== normalizedDate
            )
          }
        : current
    );
  };

  const removeDayOverride = (dateKey: string) => {
    setBellSchedule((current) => {
      const nextOverrides = { ...current.dayOverrides };
      delete nextOverrides[dateKey];

      return {
        ...current,
        dayOverrides: nextOverrides
      };
    });
  };

  const addHolidayDate = (dateKey: string) => {
    const normalizedDate = normalizeDateKey(dateKey);

    if (!normalizedDate) {
      return;
    }

    setBellSchedule((current) => {
      const nextOverrides = { ...current.dayOverrides };
      delete nextOverrides[normalizedDate];

      return {
        ...current,
        dayOverrides: nextOverrides,
        holidayDateKeys: current.holidayDateKeys.includes(normalizedDate)
          ? current.holidayDateKeys
          : [...current.holidayDateKeys, normalizedDate].sort()
      };
    });
  };

  const removeHolidayDate = (dateKey: string) => {
    setBellSchedule((current) => ({
      ...current,
      holidayDateKeys: current.holidayDateKeys.filter((holidayKey) => holidayKey !== dateKey)
    }));
  };

  const setEndOfPeriodAlertEnabled = (enabled: boolean) => {
    setBellSchedule((current) => ({
      ...current,
      endOfPeriodAlert: {
        ...current.endOfPeriodAlert,
        enabled
      }
    }));
  };

  const setEndOfPeriodAlertMinutes = (minutesBefore: number) => {
    setBellSchedule((current) => ({
      ...current,
      endOfPeriodAlert: {
        ...current.endOfPeriodAlert,
        minutesBefore: clampNumber(
          Math.round(minutesBefore),
          BELL_SCHEDULE_ALERT_MINUTES_MIN,
          BELL_SCHEDULE_ALERT_MINUTES_MAX
        )
      }
    }));
  };

  return {
    activeProfile,
    activeProfileDisplayName,
    addDayOverride,
    addDaySlot,
    addHolidayDate,
    badgeLabel,
    copyDaySchedule,
    copyDayScheduleToAll,
    insertDaySlotAfter,
    isTodayNoSchool,
    liveProfile,
    liveProfileDisplayName,
    liveScheduleLabel,
    liveSource: liveResolution.source,
    liveWeekLetter: liveResolution.weekLetter,
    markThisWeek,
    mondayPreviewEntries,
    removeDayOverride,
    removeHolidayDate,
    setEndOfPeriodAlertEnabled,
    setEndOfPeriodAlertMinutes,
    setRotationEnabled,
    setRotationProfile,
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
    renameDaySlot,
    selectProfile,
    setPopoutMode,
    timeUntilNextEntryMs,
    todayDayKey,
    todayTimeline,
    upcomingEntries,
    removeDaySlot,
    removeDaySlotById,
    updateDaySlotTime,
    updateSlotClassList,
    updateSlotEnabled,
    weekTimelineByDay
  };
}

export function normalizeBellSchedulePopoutMode(
  raw: unknown,
  initialValue: BellSchedulePopoutMode
) {
  return raw === 'editor' || raw === 'summary' ? raw : initialValue;
}

const bellTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit'
});

export function formatBellTime(minutes: number) {
  return bellTimeFormatter.format(
    new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)
  );
}

export function formatBellTimeRange(definition: Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>) {
  return `${formatBellTime(definition.startMinutes)}–${formatBellTime(definition.endMinutes)}`;
}

export function formatBellTimeInputValue(minutes: number) {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60)
    .toString()
    .padStart(2, '0')}`;
}

export function parseBellTimeInputValue(value: string) {
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

export function getBellScheduleDayKey(date: Date): BellScheduleDayKey | null {
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

export function getBellScheduleMondayKey(date: Date) {
  const mondayOffset = (date.getDay() + 6) % 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);

  return formatDateKey(monday.getFullYear(), monday.getMonth(), monday.getDate());
}

export function getBellScheduleWeekLetter(
  rotation: BellScheduleRotation,
  date: Date
): BellScheduleWeekLetter | null {
  if (!rotation.enabled || !rotation.anchorMondayKey) {
    return null;
  }

  const mondayKey = getBellScheduleMondayKey(date);
  const dayDelta = getDaysUntilDateKey(rotation.anchorMondayKey, mondayKey);
  const weekDelta = Math.round(dayDelta / 7);

  return ((weekDelta % 2) + 2) % 2 === 0 ? 'A' : 'B';
}

export function resolveBellScheduleProfileForDate(
  snapshot: BellScheduleSnapshot,
  date: Date
): {
  profile: BellScheduleProfile | null;
  source: 'override' | 'rotation' | 'selected';
  weekLetter: BellScheduleWeekLetter | null;
} {
  const dateKey = formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
  const profileById = new Map(snapshot.profiles.map((profile) => [profile.id, profile] as const));
  const weekLetter = getBellScheduleWeekLetter(snapshot.rotation, date);
  const overrideProfile = profileById.get(snapshot.dayOverrides[dateKey] ?? '') ?? null;

  if (overrideProfile) {
    return { profile: overrideProfile, source: 'override', weekLetter };
  }

  if (weekLetter) {
    const rotationProfileId =
      weekLetter === 'A' ? snapshot.rotation.profileAId : snapshot.rotation.profileBId;
    const rotationProfile = rotationProfileId ? profileById.get(rotationProfileId) ?? null : null;

    if (rotationProfile) {
      return { profile: rotationProfile, source: 'rotation', weekLetter };
    }
  }

  const activeProfile =
    profileById.get(snapshot.activeProfileId ?? '') ?? snapshot.profiles[0] ?? null;

  return { profile: activeProfile, source: 'selected', weekLetter };
}

/**
 * Resolves the block running right now (rotation and overrides applied)
 * without needing class lists — used by the always-on-top overlay dot.
 */
export function getLiveBellScheduleStatus(snapshot: BellScheduleSnapshot, now: number) {
  const date = new Date(now);
  const dayKey = getBellScheduleDayKey(date);
  const dateKey = formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
  const resolution = resolveBellScheduleProfileForDate(snapshot, date);

  if (!dayKey || !resolution.profile || snapshot.holidayDateKeys.includes(dateKey)) {
    return null;
  }

  const minutes = getMinutesSinceMidnight(date);
  const day = resolution.profile.days[dayKey];
  const definition =
    getBellScheduleDaySlotDefinitions(day).find(
      (slot) => minutes >= slot.startMinutes && minutes < slot.endMinutes
    ) ?? null;

  if (!definition) {
    return null;
  }

  const assignment = day.assignmentsBySlotId[definition.id];

  return {
    definition,
    isActive: definition.kind === 'break' || assignment?.enabled === true,
    remainingMs: Math.max(getTimestampForMinutes(date, definition.endMinutes) - now, 0)
  };
}

export function copyBellScheduleDay(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  fromDayKey: BellScheduleDayKey,
  toDayKey: BellScheduleDayKey
) {
  if (fromDayKey === toDayKey) {
    return snapshot;
  }

  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const sourceDay = profile.days[fromDayKey];

      return {
        ...profile,
        days: {
          ...profile.days,
          [toDayKey]: {
            assignmentsBySlotId: Object.fromEntries(
              Object.entries(sourceDay.assignmentsBySlotId).map(([slotId, assignment]) => [
                slotId,
                assignment ? { ...assignment } : assignment
              ])
            ),
            slotDefinitions: getBellScheduleDaySlotDefinitions(sourceDay).map((slot) => ({
              ...slot
            }))
          }
        }
      };
    })
  };
}

export function copyBellScheduleDayToAllDays(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  fromDayKey: BellScheduleDayKey
) {
  return BELL_SCHEDULE_DAY_KEYS.reduce(
    (result, targetDayKey) =>
      targetDayKey === fromDayKey
        ? result
        : copyBellScheduleDay(result, profileId, fromDayKey, targetDayKey),
    snapshot
  );
}

export function getDefaultBellScheduleSlotAssignment(): BellScheduleSlotAssignment {
  return {
    classListId: null,
    enabled: false
  };
}

export function getBellScheduleDefaultSlotDefinitions() {
  return BELL_SCHEDULE_SLOT_DEFINITIONS.map((slot) => ({ ...slot }));
}

export function getBellScheduleDaySlotDefinitions(day: BellScheduleDay) {
  const slotDefinitions =
    day.slotDefinitions.length > 0 ? day.slotDefinitions : getBellScheduleDefaultSlotDefinitions();

  return [...slotDefinitions].sort(
    (left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes
  );
}

export function createBellScheduleDay(source?: BellScheduleDay): BellScheduleDay {
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

export function createBellScheduleProfile({
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

export function createBellScheduleProfileId() {
  return `bell-schedule-profile-${createStickyNoteId()}`;
}

export function createEmptyBellTimelineByDay() {
  return BELL_SCHEDULE_DAY_KEYS.reduce(
    (result, dayKey) => ({
      ...result,
      [dayKey]: []
    }),
    {} as Record<BellScheduleDayKey, BellTimelineEntry[]>
  );
}

export function getBellScheduleProfileDisplayName(profile: Pick<BellScheduleProfile, 'name'>) {
  return profile.name.trim() || 'Untitled Profile';
}

export function createBellScheduleProfileName(profiles: BellScheduleProfile[]) {
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

export function selectBellScheduleProfile(snapshot: BellScheduleSnapshot, profileId: string) {
  if (!snapshot.profiles.some((profile) => profile.id === profileId)) {
    return snapshot;
  }

  return {
    ...snapshot,
    activeProfileId: profileId
  };
}

export function addBellScheduleProfile(
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
    ...snapshot,
    activeProfileId: nextProfile.id,
    profiles: [...snapshot.profiles, nextProfile]
  };
}

export function removeBellScheduleProfile(snapshot: BellScheduleSnapshot, profileId: string) {
  if (snapshot.profiles.length <= 1) {
    return snapshot;
  }

  const nextProfiles = snapshot.profiles.filter((profile) => profile.id !== profileId);
  const nextActiveProfileId =
    snapshot.activeProfileId === profileId
      ? nextProfiles[0]?.id ?? null
      : snapshot.activeProfileId;
  const nextOverrides = Object.fromEntries(
    Object.entries(snapshot.dayOverrides).filter(([, overrideId]) => overrideId !== profileId)
  );

  return {
    ...snapshot,
    activeProfileId: nextActiveProfileId,
    dayOverrides: nextOverrides,
    profiles: nextProfiles,
    rotation: {
      ...snapshot.rotation,
      profileAId: snapshot.rotation.profileAId === profileId ? null : snapshot.rotation.profileAId,
      profileBId: snapshot.rotation.profileBId === profileId ? null : snapshot.rotation.profileBId
    }
  };
}

export function renameBellScheduleProfile(
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

export function updateBellScheduleSlotAssignment(
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
            ...profile.days[dayKey],
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

export function getNextBellScheduleTeachingPeriodNumber(slotDefinitions: BellScheduleSlotDefinition[]) {
  const numbers = slotDefinitions
    .filter((slot) => slot.kind === 'teaching')
    .map((slot) => /^Period\s+(\d+)$/i.exec(slot.label.trim())?.[1])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

export function createBellScheduleSlotDefinition(
  slotDefinitions: BellScheduleSlotDefinition[],
  kind: BellScheduleSlotKind,
  requestedStartMinutes?: number
): BellScheduleSlotDefinition {
  const previousSlot = slotDefinitions[slotDefinitions.length - 1] ?? null;
  const durationMinutes = kind === 'teaching' ? 60 : 20;
  const requestedStart =
    requestedStartMinutes ?? (previousSlot ? previousSlot.endMinutes : 8 * 60 + 45);
  const endMinutes = Math.min(requestedStart + durationMinutes, 24 * 60 - 1);
  // Never produce a zero-length block: keep at least 5 minutes, shifting the
  // start earlier when the day already runs up against midnight.
  const startMinutes = Math.max(0, Math.min(requestedStart, endMinutes - 5));

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

export function addBellScheduleDaySlot(
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

export function removeBellScheduleDaySlot(
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

export function removeBellScheduleDaySlotById(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  dayKey: BellScheduleDayKey,
  slotId: BellScheduleSlotId
) {
  return {
    ...snapshot,
    profiles: snapshot.profiles.map((profile) => {
      if (profile.id !== profileId) {
        return profile;
      }

      const day = profile.days[dayKey];
      const slotDefinitions = getBellScheduleDaySlotDefinitions(day);

      if (!slotDefinitions.some((slot) => slot.id === slotId)) {
        return profile;
      }

      const assignmentsBySlotId = { ...day.assignmentsBySlotId };

      delete assignmentsBySlotId[slotId];

      return {
        ...profile,
        days: {
          ...profile.days,
          [dayKey]: {
            assignmentsBySlotId,
            slotDefinitions: slotDefinitions.filter((slot) => slot.id !== slotId)
          }
        }
      };
    })
  };
}

export function insertBellScheduleDaySlotAfter(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  dayKey: BellScheduleDayKey,
  afterSlotId: BellScheduleSlotId,
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
      const anchorIndex = slotDefinitions.findIndex((slot) => slot.id === afterSlotId);

      if (anchorIndex === -1) {
        return profile;
      }

      const anchorSlot = slotDefinitions[anchorIndex];
      const nextSlot = createBellScheduleSlotDefinition(
        slotDefinitions,
        kind,
        anchorSlot.endMinutes
      );
      const assignmentsBySlotId = { ...day.assignmentsBySlotId };

      if (nextSlot.kind === 'teaching') {
        assignmentsBySlotId[nextSlot.id] = getDefaultBellScheduleSlotAssignment();
      }

      return {
        ...profile,
        days: {
          ...profile.days,
          [dayKey]: {
            assignmentsBySlotId,
            slotDefinitions: [
              ...slotDefinitions.slice(0, anchorIndex + 1),
              nextSlot,
              ...slotDefinitions.slice(anchorIndex + 1)
            ]
          }
        }
      };
    })
  };
}

export function deriveBellScheduleShortLabel(label: string) {
  const trimmed = label.trim();
  const periodMatch = /^period\s+(\d+)$/i.exec(trimmed);

  if (periodMatch) {
    return `P${periodMatch[1]}`;
  }

  const breakMatch = /^break(?:\s+(\d+))?$/i.exec(trimmed);

  if (breakMatch) {
    return breakMatch[1] ? `B${breakMatch[1]}` : 'Break';
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((word) => word[0]!.toUpperCase())
      .join('');
  }

  return trimmed.slice(0, 6);
}

export function updateBellScheduleDaySlotLabel(
  snapshot: BellScheduleSnapshot,
  profileId: string,
  dayKey: BellScheduleDayKey,
  slotId: BellScheduleSlotId,
  label: string
) {
  const trimmed = label.trim();

  if (!trimmed) {
    return snapshot;
  }

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
                    label: trimmed,
                    shortLabel: deriveBellScheduleShortLabel(trimmed)
                  }
                : slot
            )
          }
        }
      };
    })
  };
}

export function updateBellScheduleDaySlotTimes(
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
            slotDefinitions: getBellScheduleDaySlotDefinitions(day).map((slot) => {
              if (slot.id !== slotId) {
                return slot;
              }

              const merged = { ...slot, ...times };
              // Keep end strictly after start: bump end to start + 5 min if needed.
              const startMinutes = clampNumber(merged.startMinutes, 0, 24 * 60 - 6);
              const endMinutes =
                merged.endMinutes > startMinutes
                  ? Math.min(merged.endMinutes, 24 * 60 - 1)
                  : Math.min(startMinutes + 5, 24 * 60 - 1);

              return {
                ...merged,
                endMinutes,
                startMinutes
              };
            })
          }
        }
      };
    })
  };
}

export function buildBellTimelineEntries(
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

export function formatBellScheduleStatusLabel(entry: BellTimelineEntry | null) {
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

export function formatBellScheduleEntryDetail(entry: BellTimelineEntry) {
  if (entry.status === 'break') {
    return 'Break block';
  }

  if (entry.status === 'free') {
    return 'Free period';
  }

  return entry.classList?.name ?? 'Class not set';
}

export function getActiveBellScheduleClassListId(entry: BellTimelineEntry | null) {
  if (entry?.status !== 'teaching' || !entry.classList) {
    return null;
  }

  return entry.classList.id;
}

export function normalizeBellScheduleSnapshot(
  raw: unknown,
  initialValue: BellScheduleSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    activeProfileId?: unknown;
    dayOverrides?: Record<string, unknown>;
    endOfPeriodAlert?: unknown;
    holidayDateKeys?: unknown;
    profiles?: unknown[];
    rotation?: unknown;
  };
  const profiles = Array.isArray(nextRaw.profiles)
    ? nextRaw.profiles
        .map((profile) => normalizeBellScheduleProfile(profile))
        .filter((profile): profile is BellScheduleProfile => profile !== null)
    : [];
  const nextProfiles = profiles.length > 0 ? profiles : initialValue.profiles;
  const profileIds = new Set(nextProfiles.map((profile) => profile.id));
  const activeProfileId =
    typeof nextRaw.activeProfileId === 'string' &&
    nextProfiles.some((profile) => profile.id === nextRaw.activeProfileId)
      ? nextRaw.activeProfileId
      : nextProfiles[0]?.id ?? null;
  const dayOverrides: Record<string, string> = {};
  // Prune anything dated more than a week in the past so one-off overrides and
  // holidays never pile up in storage.
  const staleCutoffDateKey = shiftDateKey(getTodayDateKey(), -7);

  if (nextRaw.dayOverrides && typeof nextRaw.dayOverrides === 'object') {
    for (const [dateKeyRaw, profileIdRaw] of Object.entries(nextRaw.dayOverrides)) {
      const dateKey = normalizeDateKey(dateKeyRaw);

      if (
        dateKey &&
        dateKey >= staleCutoffDateKey &&
        typeof profileIdRaw === 'string' &&
        profileIds.has(profileIdRaw)
      ) {
        dayOverrides[dateKey] = profileIdRaw;
      }
    }
  }

  const holidayDateKeys = Array.isArray(nextRaw.holidayDateKeys)
    ? Array.from(
        new Set(
          nextRaw.holidayDateKeys
            .map((dateKeyRaw) =>
              typeof dateKeyRaw === 'string' ? normalizeDateKey(dateKeyRaw) : null
            )
            .filter(
              (dateKey): dateKey is string => dateKey !== null && dateKey >= staleCutoffDateKey
            )
        )
      ).sort()
    : [];

  return {
    activeProfileId,
    dayOverrides,
    endOfPeriodAlert: normalizeBellScheduleEndOfPeriodAlert(nextRaw.endOfPeriodAlert),
    holidayDateKeys,
    profiles: nextProfiles,
    rotation: normalizeBellScheduleRotation(nextRaw.rotation, profileIds)
  };
}

export function normalizeBellScheduleRotation(
  raw: unknown,
  profileIds: Set<string>
): BellScheduleRotation {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_BELL_SCHEDULE_ROTATION;
  }

  const nextRaw = raw as {
    anchorMondayKey?: unknown;
    enabled?: unknown;
    profileAId?: unknown;
    profileBId?: unknown;
  };
  const anchorMondayKey =
    typeof nextRaw.anchorMondayKey === 'string' ? normalizeDateKey(nextRaw.anchorMondayKey) : null;
  const profileAId =
    typeof nextRaw.profileAId === 'string' && profileIds.has(nextRaw.profileAId)
      ? nextRaw.profileAId
      : null;
  const profileBId =
    typeof nextRaw.profileBId === 'string' && profileIds.has(nextRaw.profileBId)
      ? nextRaw.profileBId
      : null;

  return {
    anchorMondayKey,
    enabled: nextRaw.enabled === true && anchorMondayKey !== null,
    profileAId,
    profileBId
  };
}

export function normalizeBellScheduleEndOfPeriodAlert(raw: unknown): BellScheduleEndOfPeriodAlert {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_BELL_SCHEDULE_END_OF_PERIOD_ALERT;
  }

  const nextRaw = raw as { enabled?: unknown; minutesBefore?: unknown };

  return {
    enabled: nextRaw.enabled === true,
    minutesBefore:
      typeof nextRaw.minutesBefore === 'number' && Number.isFinite(nextRaw.minutesBefore)
        ? clampNumber(
            Math.round(nextRaw.minutesBefore),
            BELL_SCHEDULE_ALERT_MINUTES_MIN,
            BELL_SCHEDULE_ALERT_MINUTES_MAX
          )
        : DEFAULT_BELL_SCHEDULE_END_OF_PERIOD_ALERT.minutesBefore
  };
}

export function normalizeBellScheduleProfile(raw: unknown): BellScheduleProfile | null {
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

export function normalizeBellScheduleDay(raw: unknown): BellScheduleDay {
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

export function normalizeBellScheduleSlotDefinition(raw: unknown): BellScheduleSlotDefinition | null {
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

  const safeStartMinutes = Math.min(startMinutes, 24 * 60 - 6);

  return {
    endMinutes:
      endMinutes > safeStartMinutes ? endMinutes : Math.min(safeStartMinutes + 5, 24 * 60 - 1),
    id: nextRaw.id,
    kind: nextRaw.kind,
    label: nextRaw.label,
    shortLabel:
      typeof nextRaw.shortLabel === 'string' && nextRaw.shortLabel.trim()
        ? nextRaw.shortLabel
        : nextRaw.label,
    startMinutes: safeStartMinutes
  };
}

export function normalizeBellScheduleSlotAssignment(
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
