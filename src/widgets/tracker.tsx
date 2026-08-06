import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { buildCalendarDays, formatDateKeyForInput, formatLongDate, formatMonthLabel, getDaysUntilDateKey, getMonthKeyFromDateKey, getTodayDateKey, normalizeDateKey, parseDateInputValue, shiftDateKey, shiftMonthKey } from '../shared/dates';
import { usePersistentState } from '../shared/persistence';
import { announce, showUndoToast, useToday } from '../shared/uiKit';
import { createStickyNoteId } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import { usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';

export type AssessmentTrackerStatus = 'planned' | 'set' | 'marking' | 'complete';

export type HomeworkTrackerStatus = 'set' | 'collecting' | 'reviewed' | 'complete';

export type HomeworkAssessmentEntryBase = {
  classLabel: string;
  classListId: string | null;
  description: string;
  dueDate: string;
  id: string;
  reminderDaysBefore: number;
  title: string;
  updatedAt: number;
};

export type AssessmentTrackerEntry = HomeworkAssessmentEntryBase & {
  status: AssessmentTrackerStatus;
};

export type HomeworkTrackerEntry = HomeworkAssessmentEntryBase & {
  status: HomeworkTrackerStatus;
};

export type HomeworkCompletionStatus = 'done' | 'late' | 'absent' | 'missing';

export type HomeworkAssessmentTrackerSnapshot = {
  assessments: AssessmentTrackerEntry[];
  firedReminderKeys: string[];
  homework: HomeworkTrackerEntry[];
  homeworkCompletionsByHomeworkId: Record<string, Record<string, HomeworkCompletionStatus>>;
};

export type AssessmentTrackerDraft = {
  classListId: string;
  description: string;
  dueDate: string;
  reminderDaysBefore: number;
  status: AssessmentTrackerStatus;
  title: string;
};

export type HomeworkTrackerDraft = {
  classListId: string;
  description: string;
  dueDate: string;
  reminderDaysBefore: number;
  status: HomeworkTrackerStatus;
  title: string;
};

export type HomeworkAssessmentPopoutMode = 'editor' | 'completion';

export const TRACKER_REMINDER_OPTIONS = [
  { label: 'No reminder', value: 0 },
  { label: '1 day before', value: 1 },
  { label: '3 days before', value: 3 },
  { label: '1 week before', value: 7 },
  { label: '2 weeks before', value: 14 }
] as const;

export const ASSESSMENT_TRACKER_STATUS_OPTIONS = [
  { label: 'Planned', value: 'planned' },
  { label: 'Set', value: 'set' },
  { label: 'Marking', value: 'marking' },
  { label: 'Complete', value: 'complete' }
] as const satisfies ReadonlyArray<{ label: string; value: AssessmentTrackerStatus }>;

export const HOMEWORK_TRACKER_STATUS_OPTIONS = [
  { label: 'Set', value: 'set' },
  { label: 'Collecting', value: 'collecting' },
  { label: 'Reviewed', value: 'reviewed' },
  { label: 'Complete', value: 'complete' }
] as const satisfies ReadonlyArray<{ label: string; value: HomeworkTrackerStatus }>;

export const DEFAULT_HOMEWORK_ASSESSMENT_TRACKER: HomeworkAssessmentTrackerSnapshot = {
  assessments: [],
  firedReminderKeys: [],
  homework: [],
  homeworkCompletionsByHomeworkId: {}
};

export const HOMEWORK_COMPLETION_STATUS_CYCLE = [
  'missing',
  'done',
  'late',
  'absent'
] as const satisfies ReadonlyArray<HomeworkCompletionStatus>;

export function isHomeworkCompletionStatus(value: unknown): value is HomeworkCompletionStatus {
  return value === 'done' || value === 'late' || value === 'absent' || value === 'missing';
}

export function getNextHomeworkCompletionStatus(
  status: HomeworkCompletionStatus,
  direction: 1 | -1
): HomeworkCompletionStatus {
  const cycleLength = HOMEWORK_COMPLETION_STATUS_CYCLE.length;
  const index = HOMEWORK_COMPLETION_STATUS_CYCLE.indexOf(status);
  return HOMEWORK_COMPLETION_STATUS_CYCLE[(index + direction + cycleLength) % cycleLength];
}

export function getHomeworkCompletionStatusLabel(status: HomeworkCompletionStatus) {
  switch (status) {
    case 'done':
      return 'Done';
    case 'late':
      return 'Late';
    case 'absent':
      return 'Absent';
    default:
      return 'Missing';
  }
}

export function getHomeworkCompletionStatusGlyph(status: HomeworkCompletionStatus) {
  switch (status) {
    case 'done':
      return '✓';
    case 'late':
      return '!';
    case 'absent':
      return '–';
    default:
      return '';
  }
}

export function truncateTrackerTitle(title: string, maxLength = 10) {
  const trimmed = title.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength).trimEnd()}…` : trimmed;
}

export function escapeTrackerCsvValue(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function HomeworkAssessmentTrackerWidgetContent({
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
  const [entryKind, setEntryKind] = useState<'homework' | 'assessment'>('homework');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [logClassFilter, setLogClassFilter] = useState<'all' | 'active'>('all');
  const [logSearch, setLogSearch] = useState('');
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
    setIsFormOpen(false);
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
    setIsFormOpen(false);
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
  const getCompletionStatus = (homeworkId: string, studentName: string): HomeworkCompletionStatus =>
    controller.tracker.homeworkCompletionsByHomeworkId[homeworkId]?.[studentName] ?? 'missing';
  const completionStudents = completionClassList?.students ?? [];
  const completionDoneCounts = new Map(
    completionHomework.map((item) => [
      item.id,
      completionStudents.filter((studentName) => getCompletionStatus(item.id, studentName) === 'done')
        .length
    ])
  );
  const completedCellCount = completionHomework.reduce(
    (total, item) => total + (completionDoneCounts.get(item.id) ?? 0),
    0
  );

  const activeClassList = controller.activeClassList;
  const normalizedLogSearch = logSearch.trim().toLowerCase();
  const matchesLogFilters = (item: AssessmentTrackerEntry | HomeworkTrackerEntry) => {
    if (logClassFilter === 'active' && activeClassList && item.classListId !== activeClassList.id) {
      return false;
    }

    return !normalizedLogSearch || item.title.toLowerCase().includes(normalizedLogSearch);
  };
  const visibleAssessments = controller.assessments.filter(matchesLogFilters);
  const visibleHomework = controller.homework.filter(matchesLogFilters);

  const exportCompletionCsv = () => {
    if (!completionClassList) {
      return;
    }

    const header = [
      'Student',
      ...completionHomework.map((item) => `${item.title} (${formatLongDate(item.dueDate)})`)
    ];
    const rows = completionStudents.map((studentName) => [
      studentName,
      ...completionHomework.map((item) => getCompletionStatus(item.id, studentName))
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(escapeTrackerCsvValue).join(','))
      .join('\n');

    void navigator.clipboard?.writeText(csv).catch(() => {
      // Ignore clipboard failures; the download still happens.
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `homework-${completionClassList.name.trim().replace(/\s+/g, '-') || 'class'}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    announce(`Exported CSV for ${completionClassList.name}`);
  };

  const isAssessmentForm = entryKind === 'assessment';
  const activeDraft = isAssessmentForm ? assessmentDraft : homeworkDraft;
  const editingEntryId = isAssessmentForm ? editingAssessmentId : editingHomeworkId;
  const updateEntryDraft = (
    patch: Partial<Omit<AssessmentTrackerDraft, 'status'> & Omit<HomeworkTrackerDraft, 'status'>>
  ) => {
    if (isAssessmentForm) {
      setAssessmentDraft((current) => ({ ...current, ...patch }));
    } else {
      setHomeworkDraft((current) => ({ ...current, ...patch }));
    }
  };

  const showDashboardEmpty = !isPopout && controller.totalTrackedCount === 0;

  return (
    <div className="tracker-widget">
      {showDashboardEmpty ? (
        <div className="tracker-empty">
          <span className="tracker-empty__copy">Nothing due.</span>
          {onOpenManager || onOpenCompletion ? (
            <div className="tracker-empty__actions">
              {onOpenManager ? (
                <button
                  aria-label="Open homework and assessment editor"
                  className="secondary-link button-tone--utility"
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
                  onClick={onOpenCompletion}
                  type="button"
                >
                  Completion
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!showDashboardEmpty && !isPopout && (onOpenManager || onOpenCompletion) ? (
        <div className="tracker-summary__footer widget-top-controls">
          {onOpenManager ? (
            <button
              aria-label="Open homework and assessment editor"
              className="secondary-link button-tone--utility window-spawn-button"
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
              className="secondary-link button-tone--selection window-spawn-button"
              data-compact-icon="✓"
              onClick={onOpenCompletion}
              type="button"
            >
              Completion
            </button>
          ) : null}
        </div>
      ) : null}

      {showDashboardEmpty ? null : (
      <section className={`tracker-summary ${isPopout ? '' : 'tracker-summary--compact'}`}>
        {controller.overdueCount > 0 ? (
          <div className="tracker-summary__chips">
            <span className="pill tracker-overdue-chip">{controller.overdueCount} overdue</span>
          </div>
        ) : null}
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
      )}

      {isPopout ? (
        <>
          <div className="tracker-popout-tabs" role="tablist" aria-label="Homework tracker view">
            <button
              aria-selected={popoutMode === 'editor'}
              className={`text-toggle ${popoutMode === 'editor' ? 'text-toggle--active' : ''}`}
              onClick={() => setPopoutMode?.('editor')}
              role="tab"
              type="button"
            >
              Editor
            </button>
            <button
              aria-selected={popoutMode === 'completion'}
              className={`text-toggle ${popoutMode === 'completion' ? 'text-toggle--active' : ''}`}
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
                <span className="field-label">Homework completion</span>
                <div className="tracker-panel__header-actions">
                  {completionClassList && completionHomework.length > 0 ? (
                    <button
                      className="secondary-link button-tone--utility"
                      onClick={exportCompletionCsv}
                      type="button"
                    >
                      Export CSV
                    </button>
                  ) : null}
                  <span className="badge">{completedCellCount}</span>
                </div>
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
                            <span className="tracker-completion-table__title">
                              {truncateTrackerTitle(item.title)}
                            </span>
                            <span className="tracker-completion-table__date">
                              {formatLongDate(item.dueDate)}
                            </span>
                            <span className="tracker-completion-table__meta">
                              <span className="tracker-completion-table__count">
                                {completionDoneCounts.get(item.id) ?? 0}/{completionStudents.length}
                              </span>
                              <button
                                aria-label={`Mark all done for ${item.title}`}
                                className="tracker-completion-table__mark-all"
                                onClick={() =>
                                  controller.markAllHomeworkDone(
                                    item.id,
                                    completionStudents,
                                    item.title
                                  )
                                }
                                type="button"
                              >
                                ✓ all
                              </button>
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
                            const status = getCompletionStatus(item.id, studentName);
                            const statusLabel = getHomeworkCompletionStatusLabel(status);

                            return (
                              <td key={`completion-cell-${item.id}-${studentIndex}-${studentName}`}>
                                <button
                                  aria-label={`${studentName}, ${item.title}: ${statusLabel}`}
                                  className={`tracker-cell-chip tracker-cell-chip--${status}`}
                                  data-tooltip-content={statusLabel}
                                  onClick={() =>
                                    controller.setHomeworkCompletionStatus(
                                      item.id,
                                      studentName,
                                      getNextHomeworkCompletionStatus(status, 1)
                                    )
                                  }
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    controller.setHomeworkCompletionStatus(
                                      item.id,
                                      studentName,
                                      getNextHomeworkCompletionStatus(status, -1)
                                    );
                                  }}
                                  type="button"
                                >
                                  <span aria-hidden="true">
                                    {getHomeworkCompletionStatusGlyph(status)}
                                  </span>
                                </button>
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
              <section className="tracker-panel tracker-panel--form">
                <div className="tracker-form-head">
                  <span className="field-label">
                    {editingEntryId
                      ? isAssessmentForm
                        ? 'Edit assessment'
                        : 'Edit homework'
                      : 'Add'}
                  </span>
                  <button
                    className="secondary-link button-tone--utility"
                    onClick={() => setIsFormOpen((current) => !current)}
                    type="button"
                  >
                    {isFormOpen ? 'Close' : 'New entry'}
                  </button>
                </div>

                {isFormOpen ? (
                  <>
                    <div
                      aria-label="Entry type"
                      className="tracker-popout-tabs tracker-form-kind"
                      role="tablist"
                    >
                      <button
                        aria-selected={!isAssessmentForm}
                        className={`text-toggle ${!isAssessmentForm ? 'text-toggle--active' : ''}`}
                        onClick={() => setEntryKind('homework')}
                        role="tab"
                        type="button"
                      >
                        Homework
                      </button>
                      <button
                        aria-selected={isAssessmentForm}
                        className={`text-toggle ${isAssessmentForm ? 'text-toggle--active' : ''}`}
                        onClick={() => setEntryKind('assessment')}
                        role="tab"
                        type="button"
                      >
                        Assessment
                      </button>
                    </div>

                    <div className="field-stack">
                      <label className="field-label" htmlFor="tracker-entry-class">
                        Class
                      </label>
                      <select
                        className="text-field"
                        id="tracker-entry-class"
                        onChange={(event) => updateEntryDraft({ classListId: event.target.value })}
                        value={activeDraft.classListId}
                      >
                        {controller.classLists.map((list) => (
                          <option key={list.id} value={list.id}>
                            {list.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field-stack">
                      <label className="field-label" htmlFor="tracker-entry-title">
                        Title
                      </label>
                      <input
                        className="text-field"
                        id="tracker-entry-title"
                        onChange={(event) => updateEntryDraft({ title: event.target.value })}
                        placeholder={
                          isAssessmentForm
                            ? 'Semester test, oral presentation, essay...'
                            : 'Worksheet 4, reading response, revision task...'
                        }
                        type="text"
                        value={activeDraft.title}
                      />
                    </div>

                    <div className="tracker-form-row">
                      <div className="field-stack">
                        <TrackerDateField
                          id="tracker-entry-date"
                          label="Due date"
                          onChange={(dueDate) => updateEntryDraft({ dueDate })}
                          value={activeDraft.dueDate}
                        />
                      </div>

                      <div className="field-stack">
                        <label className="field-label" htmlFor="tracker-entry-reminder">
                          Reminder
                        </label>
                        <select
                          className="text-field"
                          id="tracker-entry-reminder"
                          onChange={(event) =>
                            updateEntryDraft({ reminderDaysBefore: Number(event.target.value) })
                          }
                          value={activeDraft.reminderDaysBefore}
                        >
                          {TRACKER_REMINDER_OPTIONS.map((option) => (
                            <option key={`entry-reminder-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="field-stack">
                        <label className="field-label" htmlFor="tracker-entry-status">
                          Status
                        </label>
                        <select
                          className="text-field"
                          id="tracker-entry-status"
                          onChange={(event) => {
                            if (isAssessmentForm) {
                              setAssessmentDraft((current) => ({
                                ...current,
                                status: event.target.value as AssessmentTrackerStatus
                              }));
                            } else {
                              setHomeworkDraft((current) => ({
                                ...current,
                                status: event.target.value as HomeworkTrackerStatus
                              }));
                            }
                          }}
                          value={activeDraft.status}
                        >
                          {(isAssessmentForm
                            ? ASSESSMENT_TRACKER_STATUS_OPTIONS
                            : HOMEWORK_TRACKER_STATUS_OPTIONS
                          ).map((option) => (
                            <option key={`entry-status-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="field-stack">
                      <label className="field-label" htmlFor="tracker-entry-description">
                        Description
                      </label>
                      <textarea
                        className="text-area text-area--tracker"
                        id="tracker-entry-description"
                        onChange={(event) => updateEntryDraft({ description: event.target.value })}
                        value={activeDraft.description}
                      />
                    </div>

                    <div className="action-row">
                      <button
                        className="primary-link"
                        onClick={isAssessmentForm ? saveAssessment : saveHomework}
                        type="button"
                      >
                        {editingEntryId ? 'Save' : 'Add'}
                      </button>
                      <button
                        className="secondary-link button-tone--utility"
                        onClick={() => {
                          if (isAssessmentForm) {
                            resetAssessmentDraft();
                          } else {
                            resetHomeworkDraft();
                          }
                          setIsFormOpen(false);
                        }}
                        type="button"
                      >
                        {editingEntryId ? 'Cancel edit' : 'Clear'}
                      </button>
                    </div>
                  </>
                ) : null}
              </section>

          <div className="tracker-log-toolbar">
            <div aria-label="Filter log by class" className="tracker-filter-chips" role="group">
              <button
                aria-pressed={logClassFilter === 'all'}
                className={`tracker-filter-chip ${
                  logClassFilter === 'all' ? 'tracker-filter-chip--active' : ''
                }`}
                onClick={() => setLogClassFilter('all')}
                type="button"
              >
                All classes
              </button>
              {activeClassList ? (
                <button
                  aria-pressed={logClassFilter === 'active'}
                  className={`tracker-filter-chip ${
                    logClassFilter === 'active' ? 'tracker-filter-chip--active' : ''
                  }`}
                  onClick={() => setLogClassFilter('active')}
                  type="button"
                >
                  {activeClassList.name}
                </button>
              ) : null}
            </div>
            <input
              aria-label="Search by title"
              className="text-field tracker-log-search"
              onChange={(event) => setLogSearch(event.target.value)}
              placeholder="Search"
              type="search"
              value={logSearch}
            />
          </div>

          <div className="tracker-editor-grid">
            <section className="tracker-panel">
              <div className="tracker-panel__header">
                <span className="field-label">Assessment log</span>
                <span className="badge">{visibleAssessments.length}</span>
              </div>

              {visibleAssessments.length > 0 ? (
                <div className="tracker-record-list tracker-record-list--full">
                  {visibleAssessments.map((item) => (
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
                        setEntryKind('assessment');
                        setIsFormOpen(true);
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
                  <p className="empty-copy">
                    {controller.assessments.length > 0 ? 'No matches.' : 'No assessments tracked yet.'}
                  </p>
                </div>
              )}
            </section>

            <section className="tracker-panel">
              <div className="tracker-panel__header">
                <span className="field-label">Homework log</span>
                <span className="badge">{visibleHomework.length}</span>
              </div>

              {visibleHomework.length > 0 ? (
                <div className="tracker-record-list tracker-record-list--full">
                  {visibleHomework.map((item) => (
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
                        setEntryKind('homework');
                        setIsFormOpen(true);
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
                  <p className="empty-copy">
                    {controller.homework.length > 0 ? 'No matches.' : 'No homework tracked yet.'}
                  </p>
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

export function TrackerDateField({
  disabled = false,
  id,
  labelAction,
  label,
  onChange,
  value
}: {
  disabled?: boolean;
  id: string;
  labelAction?: ReactNode;
  label: string;
  onChange: (dateKey: string) => void;
  value: string;
}) {
  const { theme } = useColorModeAppearance();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [pickerStyle, setPickerStyle] = useState<CSSProperties | null>(null);
  const [draftValue, setDraftValue] = useState(() => formatDateKeyForInput(value));
  const [visibleMonth, setVisibleMonth] = useState(() => getMonthKeyFromDateKey(value));
  const selectedDate = normalizeDateKey(value) ?? getTodayDateKey();
  const calendarDays = buildCalendarDays(visibleMonth, selectedDate, new Set<string>());

  const updatePickerPosition = () => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const rect = root.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pickerWidth = Math.min(272, Math.max(0, viewportWidth - 32));
    const pickerHeight = pickerRef.current?.offsetHeight ?? 282;
    const gap = 6;
    const viewportPadding = 16;
    const preferredTop = rect.bottom + gap;
    const fallbackTop = rect.top - pickerHeight - gap;
    const top =
      preferredTop + pickerHeight <= viewportHeight - viewportPadding
        ? preferredTop
        : Math.max(viewportPadding, fallbackTop);

    setPickerStyle({
      left: Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, viewportWidth - pickerWidth - viewportPadding)
      ),
      position: 'fixed',
      top,
      width: pickerWidth
    });
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (rootRef.current?.contains(target) || pickerRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPickerStyle(null);
      return;
    }

    updatePickerPosition();
    window.addEventListener('resize', updatePickerPosition);
    window.addEventListener('scroll', updatePickerPosition, true);
    return () => {
      window.removeEventListener('resize', updatePickerPosition);
      window.removeEventListener('scroll', updatePickerPosition, true);
    };
  }, [isOpen, visibleMonth]);

  useEffect(() => {
    if (!isOpen) {
      setVisibleMonth(getMonthKeyFromDateKey(value));
    }
  }, [isOpen, value]);

  useEffect(() => {
    setDraftValue(formatDateKeyForInput(value));
  }, [value]);

  const commitDraftValue = () => {
    const normalizedDate = parseDateInputValue(draftValue);

    if (!normalizedDate) {
      setDraftValue(formatDateKeyForInput(value));
      return;
    }

    setDraftValue(formatDateKeyForInput(normalizedDate));
    onChange(normalizedDate);
  };

  const openCalendar = () => {
    if (disabled) {
      return;
    }

    setVisibleMonth(getMonthKeyFromDateKey(value));
    setIsOpen((current) => !current);
  };

  return (
    <div className="tracker-date-field" ref={rootRef}>
      <div className="tracker-date-field__header">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {labelAction ? <div className="tracker-date-field__header-action">{labelAction}</div> : null}
      </div>
      <div className="tracker-date-field__control">
        <input
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          className="text-field text-field--date tracker-date-field__input"
          disabled={disabled}
          id={id}
          inputMode="numeric"
          onBlur={commitDraftValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDraftValue(nextValue);

            const normalizedDate = parseDateInputValue(nextValue);
            if (normalizedDate) {
              onChange(normalizedDate);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraftValue();
              setIsOpen(false);
            }
          }}
          placeholder="dd/mm/yyyy"
          type="text"
          value={draftValue}
        />
        <button
          aria-expanded={isOpen}
          aria-label={`Choose ${label.toLowerCase()}`}
          className="widget-icon-button button-tone--utility tracker-date-field__button"
          disabled={disabled}
          onClick={openCalendar}
          type="button"
        >
          <CalendarIcon />
        </button>
      </div>

      {isOpen
        ? createPortal(
            <div
              className="tracker-date-picker"
              data-theme={theme}
              ref={pickerRef}
              role="dialog"
              aria-label={`${label} calendar`}
              style={pickerStyle ?? undefined}
            >
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
                      setDraftValue(formatDateKeyForInput(day.dateKey));
                      setIsOpen(false);
                    }}
                    type="button"
                  >
                    {day.day}
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="calendar-icon" viewBox="0 0 16 16">
      <path d="M4 2.5v2M12 2.5v2M2.75 6.25h10.5M4 3.5h8A1.5 1.5 0 0 1 13.5 5v7A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5Z" />
    </svg>
  );
}

export function TrackerItemCard({
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

        {!compact && reminderLabel ? (
          <div className="pill-list">
            <span className="pill tracker-status-pill tracker-status-pill--reminder">
              {reminderLabel}
            </span>
          </div>
        ) : null}
      </div>

      {!compact ? (
        <div className="tracker-record__actions">
          <button
            aria-label={`Status: ${statusLabel}. Click for next status.`}
            className={`pill tracker-status-pill tracker-status-pill--${statusTone} tracker-status-chip`}
            onClick={() => onStatusChange?.(getNextTrackerEntryStatus(kind, item.status, 1))}
            onContextMenu={(event) => {
              event.preventDefault();
              onStatusChange?.(getNextTrackerEntryStatus(kind, item.status, -1));
            }}
            type="button"
          >
            {statusLabel}
          </button>
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

export function HomeworkAssessmentTrackerWidgetPopoutCard({
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

export function useHomeworkAssessmentTrackerState() {
  return usePersistentState<HomeworkAssessmentTrackerSnapshot>(
    'teacher-tools.homework-assessment-tracker',
    DEFAULT_HOMEWORK_ASSESSMENT_TRACKER,
    {
      normalize: normalizeHomeworkAssessmentTrackerSnapshot
    }
  );
}

export function useHomeworkAssessmentPopoutModeState() {
  return usePersistentState<HomeworkAssessmentPopoutMode>(
    'teacher-tools.homework-assessment-popout-mode',
    'editor',
    {
      normalize: normalizeHomeworkAssessmentPopoutMode
    }
  );
}

export function useHomeworkAssessmentTrackerController(
  selectedListId: string | null,
  classLists: ClassList[]
) {
  const [tracker, setTracker] = useHomeworkAssessmentTrackerState();
  const todayKey = useToday();
  const defaultClassListId = getTrackerDefaultClassListId(selectedListId, classLists);
  const activeClassList =
    classLists.find((list) => list.id === defaultClassListId) ?? classLists[0] ?? null;
  const assessments = [...tracker.assessments].sort((left, right) =>
    compareTrackerEntries(left, right, todayKey)
  );
  const homework = [...tracker.homework].sort((left, right) =>
    compareTrackerEntries(left, right, todayKey)
  );
  const classAssessments = activeClassList
    ? assessments.filter((entry) => entry.classListId === activeClassList.id)
    : assessments;
  const classHomework = activeClassList
    ? homework.filter((entry) => entry.classListId === activeClassList.id)
    : homework;
  const upcomingAssessments = classAssessments
    .filter(
      (entry) =>
        !isTrackerItemComplete(entry.status) &&
        getDaysUntilDateKey(todayKey, entry.dueDate) >= 0
    )
    .slice(0, 3);
  const homeworkDueToday = classHomework.filter(
    (entry) => !isTrackerItemComplete(entry.status) && entry.dueDate === todayKey
  );
  const reminderItems = [...classAssessments, ...classHomework].filter(
    (entry) =>
      !isTrackerItemComplete(entry.status) &&
      isTrackerReminderDueToday(entry.dueDate, entry.reminderDaysBefore, todayKey)
  );
  const overdueCount = [...classAssessments, ...classHomework].filter(
    (entry) =>
      !isTrackerItemComplete(entry.status) && isTrackerItemOverdue(entry.dueDate, todayKey)
  ).length;
  const dueTodayCount =
    classAssessments.filter(
      (entry) => !isTrackerItemComplete(entry.status) && entry.dueDate === todayKey
    ).length + homeworkDueToday.length;
  const reminderCount = reminderItems.length;
  const totalTrackedCount = classAssessments.length + classHomework.length;
  const totalTrackedCountLabel =
    totalTrackedCount === 1 ? '1 item' : `${totalTrackedCount} items`;
  const badgeLabel =
    overdueCount > 0
      ? `${overdueCount} overdue`
      : dueTodayCount > 0
        ? `${dueTodayCount} due`
        : reminderCount > 0
          ? `${reminderCount} reminder${reminderCount === 1 ? '' : 's'}`
          : totalTrackedCount > 0
            ? totalTrackedCountLabel
            : null;
  const classSummarySuffix = activeClassList ? ` for ${activeClassList.name}` : '';
  const summaryDescription =
    totalTrackedCount === 0
      ? activeClassList
        ? `No tracked homework or assessments for ${activeClassList.name}.`
        : 'Track due dates, status, and reminders across classes.'
      : `${upcomingAssessments.length} assessment${upcomingAssessments.length === 1 ? '' : 's'} coming up, ${
          homeworkDueToday.length
        } homework due today${classSummarySuffix}.`;

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
          ? createAssessmentTrackerEntry(
              entry,
              classLists,
              assessmentId,
              assessment.updatedAt,
              assessment.classLabel
            ) ?? assessment
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
              status
            }
          : assessment
      )
    }));
  };

  const removeAssessment = (assessmentId: string) => {
    const removedEntry = tracker.assessments.find((assessment) => assessment.id === assessmentId);
    if (!removedEntry) {
      return;
    }

    setTracker((current) => ({
      ...current,
      assessments: current.assessments.filter((assessment) => assessment.id !== assessmentId)
    }));
    showUndoToast(`Deleted "${removedEntry.title}"`, () => {
      setTracker((current) =>
        current.assessments.some((assessment) => assessment.id === removedEntry.id)
          ? current
          : {
              ...current,
              assessments: [removedEntry, ...current.assessments]
            }
      );
    });
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
          ? createHomeworkTrackerEntry(
              entry,
              classLists,
              homeworkId,
              homeworkEntry.updatedAt,
              homeworkEntry.classLabel
            ) ?? homeworkEntry
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
              status
            }
          : homeworkEntry
      )
    }));
  };

  const removeHomework = (homeworkId: string) => {
    const removedEntry = tracker.homework.find((homeworkEntry) => homeworkEntry.id === homeworkId);
    if (!removedEntry) {
      return;
    }

    const removedCompletions = tracker.homeworkCompletionsByHomeworkId[homeworkId];
    setTracker((current) => ({
      ...current,
      homework: current.homework.filter((homeworkEntry) => homeworkEntry.id !== homeworkId),
      homeworkCompletionsByHomeworkId: Object.fromEntries(
        Object.entries(current.homeworkCompletionsByHomeworkId).filter(([id]) => id !== homeworkId)
      )
    }));
    showUndoToast(`Deleted "${removedEntry.title}"`, () => {
      setTracker((current) => {
        if (current.homework.some((homeworkEntry) => homeworkEntry.id === removedEntry.id)) {
          return current;
        }

        return {
          ...current,
          homework: [removedEntry, ...current.homework],
          homeworkCompletionsByHomeworkId: removedCompletions
            ? {
                ...current.homeworkCompletionsByHomeworkId,
                [removedEntry.id]: removedCompletions
              }
            : current.homeworkCompletionsByHomeworkId
        };
      });
    });
  };

  const setHomeworkCompletionStatus = (
    homeworkId: string,
    studentName: string,
    status: HomeworkCompletionStatus
  ) => {
    const normalizedStudentName = studentName.trim();
    if (!normalizedStudentName) {
      return;
    }

    setTracker((current) => {
      const currentStatuses = current.homeworkCompletionsByHomeworkId[homeworkId] ?? {};
      const nextStatuses = { ...currentStatuses };

      if (status === 'missing') {
        delete nextStatuses[normalizedStudentName];
      } else {
        nextStatuses[normalizedStudentName] = status;
      }

      const nextCompletions = {
        ...current.homeworkCompletionsByHomeworkId,
        [homeworkId]: nextStatuses
      };

      if (Object.keys(nextStatuses).length === 0) {
        delete nextCompletions[homeworkId];
      }

      return {
        ...current,
        homeworkCompletionsByHomeworkId: nextCompletions
      };
    });
  };

  const markAllHomeworkDone = (
    homeworkId: string,
    studentNames: string[],
    homeworkTitle: string
  ) => {
    const previousStatuses = tracker.homeworkCompletionsByHomeworkId[homeworkId];
    const nextStatuses: Record<string, HomeworkCompletionStatus> = {
      ...previousStatuses
    };

    for (const studentName of studentNames) {
      const normalizedStudentName = studentName.trim();
      if (normalizedStudentName) {
        nextStatuses[normalizedStudentName] = 'done';
      }
    }

    setTracker((current) => ({
      ...current,
      homeworkCompletionsByHomeworkId: {
        ...current.homeworkCompletionsByHomeworkId,
        [homeworkId]: nextStatuses
      }
    }));
    showUndoToast(`Marked all done for "${homeworkTitle}"`, () => {
      setTracker((current) => {
        const nextCompletions = { ...current.homeworkCompletionsByHomeworkId };

        if (previousStatuses && Object.keys(previousStatuses).length > 0) {
          nextCompletions[homeworkId] = previousStatuses;
        } else {
          delete nextCompletions[homeworkId];
        }

        return {
          ...current,
          homeworkCompletionsByHomeworkId: nextCompletions
        };
      });
    });
  };

  const reminderSignature = reminderItems
    .map((entry) => entry.id)
    .sort()
    .join('|');

  useEffect(() => {
    if (typeof Notification === 'undefined' || reminderItems.length === 0) {
      return;
    }

    const firedKeys = new Set(tracker.firedReminderKeys);
    const dueEntries = reminderItems.filter((entry) => !firedKeys.has(`${entry.id}:${todayKey}`));
    if (dueEntries.length === 0) {
      return;
    }

    const fireNotifications = () => {
      for (const entry of dueEntries) {
        try {
          new Notification(`Reminder: ${entry.title}`, {
            body: `${getTrackerItemClassLabel(entry, classLists)} · due ${formatLongDate(entry.dueDate)}`
          });
        } catch {
          // Notifications are best-effort; the in-app reminder pill still shows.
        }
      }
    };

    if (Notification.permission === 'granted') {
      fireNotifications();
    } else if (Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          fireNotifications();
        }
      });
    }

    setTracker((current) => {
      const todaySuffix = `:${todayKey}`;
      const nextKeys = new Set(current.firedReminderKeys.filter((key) => key.endsWith(todaySuffix)));

      for (const entry of dueEntries) {
        nextKeys.add(`${entry.id}${todaySuffix}`);
      }

      return {
        ...current,
        firedReminderKeys: Array.from(nextKeys)
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderSignature, todayKey]);

  return {
    activeClassList,
    addAssessment,
    addHomework,
    assessments,
    badgeLabel,
    badgeTone:
      overdueCount > 0 || dueTodayCount > 0 ? ('alert' as const) : ('default' as const),
    classAssessments,
    classLists,
    classHomework,
    defaultClassListId,
    dueTodayCount,
    homework,
    homeworkDueToday,
    markAllHomeworkDone,
    overdueCount,
    reminderCount,
    reminderItems,
    removeAssessment,
    removeHomework,
    setHomeworkCompletionStatus,
    summaryDescription,
    todayKey,
    totalTrackedCount,
    tracker,
    upcomingAssessments,
    updateAssessment,
    updateAssessmentStatus,
    updateHomework,
    updateHomeworkStatus
  };
}

export function normalizeHomeworkAssessmentPopoutMode(
  raw: unknown,
  initialValue: HomeworkAssessmentPopoutMode
) {
  return raw === 'editor' || raw === 'completion' ? raw : initialValue;
}

export function createAssessmentTrackerDraft(defaultClassListId: string): AssessmentTrackerDraft {
  return {
    classListId: defaultClassListId,
    description: '',
    dueDate: shiftDateKey(getTodayDateKey(), 7),
    reminderDaysBefore: 7,
    status: 'planned',
    title: ''
  };
}

export function createHomeworkTrackerDraft(defaultClassListId: string): HomeworkTrackerDraft {
  return {
    classListId: defaultClassListId,
    description: '',
    dueDate: getTodayDateKey(),
    reminderDaysBefore: 0,
    status: 'set',
    title: ''
  };
}

export function getTrackerDefaultClassListId(selectedListId: string | null, classLists: ClassList[]) {
  if (selectedListId && classLists.some((list) => list.id === selectedListId)) {
    return selectedListId;
  }

  return classLists[0]?.id ?? '';
}

export function resolveTrackerDraftClassListId(
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

export function isTrackerItemComplete(status: string) {
  return status === 'complete';
}

export function isTrackerItemOverdue(dueDate: string, todayKey: string) {
  return getDaysUntilDateKey(todayKey, dueDate) < 0;
}

export function isTrackerReminderDueToday(
  dueDate: string,
  reminderDaysBefore: number,
  todayKey: string
) {
  if (reminderDaysBefore <= 0) {
    return false;
  }

  return getDaysUntilDateKey(todayKey, dueDate) === reminderDaysBefore;
}

export function getTrackerItemClassLabel(
  item: Pick<HomeworkAssessmentEntryBase, 'classLabel' | 'classListId'>,
  classLists: ClassList[]
) {
  const activeList =
    item.classListId !== null ? classLists.find((list) => list.id === item.classListId) ?? null : null;

  return activeList?.name ?? (item.classLabel.trim() || 'Class not set');
}

export function formatTrackerDueContextLabel(dueDate: string, todayKey: string) {
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

export function formatTrackerReminderBadgeLabel(
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

export function getAssessmentTrackerStatusLabel(status: AssessmentTrackerStatus) {
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

export function getHomeworkTrackerStatusLabel(status: HomeworkTrackerStatus) {
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

export function getTrackerStatusTone(
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

export function getNextTrackerEntryStatus(
  kind: 'assessment' | 'homework',
  status: AssessmentTrackerStatus | HomeworkTrackerStatus,
  direction: 1 | -1
): AssessmentTrackerStatus | HomeworkTrackerStatus {
  const options =
    kind === 'assessment' ? ASSESSMENT_TRACKER_STATUS_OPTIONS : HOMEWORK_TRACKER_STATUS_OPTIONS;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === status)
  );
  return options[(index + direction + options.length) % options.length].value;
}

export function compareTrackerEntries(
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

export function createAssessmentTrackerEntry(
  entry: Omit<AssessmentTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>,
  classLists: ClassList[],
  entryId = createStickyNoteId(),
  previousUpdatedAt?: number,
  previousClassLabel?: string
) {
  const dueDate = normalizeDateKey(entry.dueDate);
  if (!dueDate || !entry.title.trim()) {
    return null;
  }

  return {
    classLabel:
      classLists.find((list) => list.id === entry.classListId)?.name ??
      previousClassLabel?.trim() ??
      '',
    classListId: entry.classListId,
    description: entry.description.trim(),
    dueDate,
    id: entryId,
    reminderDaysBefore: Math.max(0, Math.round(entry.reminderDaysBefore)),
    status: entry.status,
    title: entry.title.trim(),
    updatedAt: previousUpdatedAt ?? Date.now()
  } satisfies AssessmentTrackerEntry;
}

export function createHomeworkTrackerEntry(
  entry: Omit<HomeworkTrackerEntry, 'classLabel' | 'id' | 'updatedAt'>,
  classLists: ClassList[],
  entryId = createStickyNoteId(),
  previousUpdatedAt?: number,
  previousClassLabel?: string
) {
  const dueDate = normalizeDateKey(entry.dueDate);
  if (!dueDate || !entry.title.trim()) {
    return null;
  }

  return {
    classLabel:
      classLists.find((list) => list.id === entry.classListId)?.name ??
      previousClassLabel?.trim() ??
      '',
    classListId: entry.classListId,
    description: entry.description.trim(),
    dueDate,
    id: entryId,
    reminderDaysBefore: Math.max(0, Math.round(entry.reminderDaysBefore)),
    status: entry.status,
    title: entry.title.trim(),
    updatedAt: previousUpdatedAt ?? Date.now()
  } satisfies HomeworkTrackerEntry;
}

export function normalizeHomeworkAssessmentTrackerSnapshot(
  raw: unknown,
  initialValue: HomeworkAssessmentTrackerSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    assessments?: unknown[];
    firedReminderKeys?: unknown[];
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
    firedReminderKeys: Array.isArray(nextRaw.firedReminderKeys)
      ? nextRaw.firedReminderKeys.filter((key): key is string => typeof key === 'string')
      : [],
    homework,
    homeworkCompletionsByHomeworkId: normalizeHomeworkCompletionMap(
      nextRaw.homeworkCompletionsByHomeworkId,
      homeworkIds
    )
  };
}

export function normalizeHomeworkCompletionMap(
  raw: unknown,
  homeworkIds: Set<string>
): Record<string, Record<string, HomeworkCompletionStatus>> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const completionsByHomeworkId: Record<string, Record<string, HomeworkCompletionStatus>> = {};

  for (const [homeworkId, completionsRaw] of Object.entries(raw)) {
    if (!homeworkIds.has(homeworkId)) {
      continue;
    }

    const statusByStudent: Record<string, HomeworkCompletionStatus> = {};

    if (Array.isArray(completionsRaw)) {
      // Legacy shape: an array of completed student names maps to 'done'.
      for (const studentNameRaw of completionsRaw) {
        const studentName = typeof studentNameRaw === 'string' ? studentNameRaw.trim() : '';
        if (studentName) {
          statusByStudent[studentName] = 'done';
        }
      }
    } else if (completionsRaw && typeof completionsRaw === 'object') {
      for (const [studentNameRaw, statusRaw] of Object.entries(completionsRaw)) {
        const studentName = studentNameRaw.trim();
        if (studentName && isHomeworkCompletionStatus(statusRaw) && statusRaw !== 'missing') {
          statusByStudent[studentName] = statusRaw;
        }
      }
    }

    if (Object.keys(statusByStudent).length > 0) {
      completionsByHomeworkId[homeworkId] = statusByStudent;
    }
  }

  return completionsByHomeworkId;
}

export function normalizeAssessmentTrackerEntry(raw: unknown): AssessmentTrackerEntry | null {
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

export function normalizeHomeworkTrackerEntry(raw: unknown): HomeworkTrackerEntry | null {
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

export function isAssessmentTrackerStatus(value: unknown): value is AssessmentTrackerStatus {
  return value === 'planned' || value === 'set' || value === 'marking' || value === 'complete';
}

export function isHomeworkTrackerStatus(value: unknown): value is HomeworkTrackerStatus {
  return (
    value === 'set' ||
    value === 'collecting' ||
    value === 'reviewed' ||
    value === 'complete'
  );
}
