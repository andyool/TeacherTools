import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { LessonDocumentSelection, LessonPlansPdfEntry, LessonPlansPdfExportOptions } from '../electron-types';
import { useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { formatDateKey, formatLongDate, getDateUtcDayValue, getDaysUntilDateKey, getTodayDateKey, normalizeDateKey, parseDateKey, shiftDateKey } from '../shared/dates';
import { usePersistentState } from '../shared/persistence';
import { clampNumber, createStickyNoteId } from '../shared/utils';
import type { BellScheduleDayKey, BellScheduleSlotDefinition, BellTimelineEntry } from './bellSchedule';
import { BELL_SCHEDULE_DAY_KEYS, BELL_SCHEDULE_DAY_LABELS, BELL_SCHEDULE_SLOT_DEFINITIONS, formatBellTime, formatBellTimeRange, getBellScheduleDayKey, useBellScheduleController } from './bellSchedule';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import { activateClassList } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import { getDashboardLayoutKey } from './dashboard';
import { usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';
import { TrackerDateField } from './tracker';

export type PlannerDocument = {
  id: string;
  name: string;
  path: string;
  addedAt: number;
};

export type LessonPlanEntry = {
  carryOver: boolean;
  documents: PlannerDocument[];
  plan: string;
  updatedAt: number;
};

export type LessonPlanTemplate = {
  createdAt: number;
  id: string;
  name: string;
  plan: string;
};

export type DeletedLessonPlanEntry = LessonPlanEntry & {
  classListId: string;
  className: string;
  dateKey: string;
  deletedAt: number;
  id: string;
  reason: 'deleted' | 'replaced';
};

export type LessonPlanExportRangeMode =
  | 'all-previous'
  | 'this-week'
  | 'last-week'
  | 'this-term'
  | 'term'
  | 'exclude-term'
  | 'term-week'
  | 'custom';

export type PlannerSnapshot = {
  activeDateByListId: Record<string, string>;
  confirmLessonPlanMoves: boolean;
  deletedEntries: DeletedLessonPlanEntry[];
  entriesByListId: Record<string, Record<string, LessonPlanEntry>>;
  templates: LessonPlanTemplate[];
};

export type PlannerPopoutMode = 'editor' | 'week';

export type PlannerLessonMoveRequest = {
  classListId: string;
  sourceDateKey: string;
  sourceSlotLabel: string;
  targetDateKey: string;
  targetSlotLabel: string;
};

export type PlannerWeekLessonBlock = {
  classListId: string;
  className: string;
  dateKey: string;
  dayKey: BellScheduleDayKey;
  documentCount: number;
  endMinutes: number;
  hasContent: boolean;
  id: string;
  plan: string;
  slotLabel: string;
  slotShortLabel: string;
  startMinutes: number;
};

export type PlannerWeekScheduleBlock = {
  dayKey: BellScheduleDayKey;
  endMinutes: number;
  id: string;
  label: string;
  shortLabel: string;
  startMinutes: number;
  status: 'break' | 'free' | 'teaching' | 'unassigned';
};

export const DEFAULT_PLANNER: PlannerSnapshot = {
  activeDateByListId: {},
  confirmLessonPlanMoves: true,
  deletedEntries: [],
  entriesByListId: {},
  templates: []
};

export const PLANNER_TEMPLATE_LIMIT = 50;

export type PlannerCarryOverProps = {
  flagged: boolean;
  offer: { dateKey: string } | null;
  onAccept: () => void;
  onToggle: (flagged: boolean) => void;
};

export type PlannerTemplatesProps = {
  entries: LessonPlanTemplate[];
  onApply: (templateId: string) => void;
  onDelete: (templateId: string) => void;
  onSave: (name: string) => void;
};

export function PlannerWidgetContent({
  carryOver,
  classLists,
  copyForwardTargetLabel,
  deletedLessonPlans,
  documents,
  lessonPlanHistory,
  onAddLink,
  onAttachDocuments,
  onCopyForward,
  onDeleteDeletedLessonPlans,
  onOpenWeeklyPlanner,
  onOpenDocument,
  onRemoveDocument,
  onRestoreDeletedLessonPlan,
  onSelectDate,
  onUpdatePlan,
  planText,
  selectedDate,
  selectedList,
  statusMessage,
  templates,
  weeklyPlannerActionAriaLabel = 'Open weekly lesson planner',
  weeklyPlannerActionCompactIcon = 'Wk',
  weeklyPlannerActionLabel = 'Week view',
  weeklyPlannerActionPlacement = 'toolbar'
}: {
  carryOver?: PlannerCarryOverProps;
  classLists: ClassList[];
  copyForwardTargetLabel?: string | null;
  deletedLessonPlans: DeletedLessonPlanEntry[];
  documents: PlannerDocument[];
  lessonPlanHistory: LessonPlansPdfEntry[];
  onAddLink?: (url: string) => void;
  onAttachDocuments: () => Promise<void> | void;
  onCopyForward?: () => void;
  onDeleteDeletedLessonPlans: (ids: string[]) => void;
  onOpenWeeklyPlanner?: () => void;
  onOpenDocument: (document: PlannerDocument) => Promise<void> | void;
  onRemoveDocument: (id: string) => void;
  onRestoreDeletedLessonPlan: (id: string, dateKey: string) => void;
  onSelectDate: (dateKey: string) => void;
  onUpdatePlan: (plan: string) => void;
  planText: string;
  selectedDate: string;
  selectedList: ClassList | null;
  statusMessage: string | null;
  templates?: PlannerTemplatesProps;
  weeklyPlannerActionAriaLabel?: string;
  weeklyPlannerActionCompactIcon?: string;
  weeklyPlannerActionLabel?: string;
  weeklyPlannerActionPlacement?: 'toolbar' | 'top-left';
}) {
  const planTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isDeletedDialogOpen, setIsDeletedDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isTemplatesDialogOpen, setIsTemplatesDialogOpen] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const hasPlanContent = Boolean(planText.trim() || documents.length > 0);

  useEffect(() => {
    if (!selectedList) {
      setIsExportDialogOpen(false);
      setIsTemplatesDialogOpen(false);
    }
  }, [selectedList]);

  const submitLinkDraft = () => {
    if (!linkDraft.trim() || !onAddLink) {
      return;
    }

    onAddLink(linkDraft);
    setLinkDraft('');
    setIsAddingLink(false);
  };

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
  const showWeeklyPlannerActionInToolbar =
    weeklyPlannerActionPlacement === 'toolbar' && Boolean(onOpenWeeklyPlanner);

  return (
    <>
      <div className="planner-widget">
        {weeklyPlannerActionPlacement === 'top-left' ? (
          <div className="planner-widget__back-row">
            <button
              aria-label={weeklyPlannerActionAriaLabel}
              className="secondary-link button-tone--utility planner-widget__back-button"
              onClick={onOpenWeeklyPlanner}
              type="button"
            >
              {weeklyPlannerActionLabel}
            </button>
          </div>
        ) : null}
        <div className="planner-widget__toolbar widget-top-controls">
          <div className="planner-widget__meta">
            <TrackerDateField
              disabled={!selectedList}
              id="lesson-plan-date"
              label="Lesson date"
              labelAction={
                showWeeklyPlannerActionInToolbar ? (
                  <div className="planner-widget__top-actions">
                    <button
                      aria-label="Select today"
                      className="planner-widget__calendar-action planner-widget__calendar-action--today"
                      disabled={!selectedList}
                      onClick={() => onSelectDate(getTodayDateKey())}
                      type="button"
                    >
                      Today
                    </button>
                    <button
                      aria-label={weeklyPlannerActionAriaLabel}
                      className="planner-widget__calendar-action planner-widget__calendar-action--week"
                      onClick={onOpenWeeklyPlanner}
                      type="button"
                    >
                      {weeklyPlannerActionLabel}
                    </button>
                  </div>
                ) : undefined
              }
              onChange={onSelectDate}
              value={selectedDate}
            />
          </div>
          <div className="planner-widget__action-row">
            {onCopyForward ? (
              <button
                aria-label="Copy this lesson plan to the next lesson with this class"
                className="secondary-link button-tone--utility planner-widget__action-button"
                data-compact-icon="→"
                data-tooltip-content={
                  copyForwardTargetLabel
                    ? `Duplicate this plan to ${copyForwardTargetLabel}`
                    : 'Duplicate this plan to the next lesson with this class'
                }
                disabled={!selectedList || !hasPlanContent}
                onClick={onCopyForward}
                type="button"
              >
                <span className="planner-widget__action-label">Copy forward</span>
              </button>
            ) : null}
            {templates ? (
              <button
                aria-haspopup="dialog"
                aria-label="Open lesson templates"
                className="secondary-link button-tone--utility planner-widget__action-button"
                data-compact-icon="Tpl"
                disabled={!selectedList}
                onClick={() => setIsTemplatesDialogOpen(true)}
                type="button"
              >
                <span className="planner-widget__action-label">
                  Templates{templates.entries.length > 0 ? ` (${templates.entries.length})` : ''}
                </span>
              </button>
            ) : null}
            <button
              aria-haspopup="dialog"
              aria-label="Open deleted lesson plans"
              className="secondary-link planner-widget__action-button planner-widget__deleted"
              data-compact-icon="Del"
              onClick={() => setIsDeletedDialogOpen(true)}
              type="button"
            >
              <span className="planner-widget__action-label">
                Deleted{deletedLessonPlans.length > 0 ? ` (${deletedLessonPlans.length})` : ''}
              </span>
            </button>
            <button
              aria-haspopup="dialog"
              aria-label="Export previous lesson plans as PDF"
              className="secondary-link button-tone--utility planner-widget__action-button planner-widget__export"
              data-compact-icon="PDF"
              disabled={!selectedList}
              onClick={() => setIsExportDialogOpen(true)}
              type="button"
            >
              <span className="planner-widget__action-label">Export PDF</span>
            </button>
          </div>
        </div>

        <div className="planner-widget__copy">
          <div className="planner-widget__copy-row">
            <p className="helper-text">{helperCopy}</p>
          </div>
          {statusMessage ? <p className="helper-text helper-text--accent">{statusMessage}</p> : null}
        </div>

        {carryOver?.offer ? (
          <div className="planner-widget__carry-offer">
            <span className="helper-text">
              The {formatLongDate(carryOver.offer.dateKey)} lesson was flagged “not finished”.
            </span>
            <button
              className="secondary-link"
              onClick={carryOver.onAccept}
              type="button"
            >
              Bring it forward
            </button>
          </div>
        ) : null}

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
          {carryOver ? (
            <label
              className="planner-widget__carry-toggle"
              data-tooltip-content="Offers this plan's content to the next lesson with this class"
            >
              <input
                checked={carryOver.flagged}
                disabled={!selectedList || !hasPlanContent}
                onChange={(event) => carryOver.onToggle(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Not finished — carry over to the next lesson</span>
            </label>
          ) : null}
        </div>

        <div className="planner-documents">
          <div className="planner-documents__header">
            <div className="planner-documents__header-copy">
              <span className="field-label">Documents</span>
              <p className="helper-text">Attach files from your computer and reopen them from here.</p>
            </div>
          </div>
          <div className="planner-documents__toolbar">
            <button
              aria-label="Attach lesson files"
              className="planner-widget__calendar-action planner-widget__calendar-action--attach planner-documents__attach-action window-spawn-button"
              disabled={!selectedList}
              onClick={() => void onAttachDocuments()}
              type="button"
            >
              Attach files
            </button>
            {onAddLink ? (
              <button
                aria-label="Attach a web link"
                className="planner-widget__calendar-action planner-documents__attach-action"
                disabled={!selectedList}
                onClick={() => setIsAddingLink((current) => !current)}
                type="button"
              >
                Add link
              </button>
            ) : null}
          </div>

          {isAddingLink && onAddLink ? (
            <div className="planner-documents__link-row">
              <input
                aria-label="Link address"
                autoFocus
                className="text-field"
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submitLinkDraft();
                  }
                  if (event.key === 'Escape') {
                    setIsAddingLink(false);
                    setLinkDraft('');
                  }
                }}
                placeholder="https://docs.google.com/…"
                type="text"
                value={linkDraft}
              />
              <button
                className="secondary-link"
                disabled={!linkDraft.trim()}
                onClick={submitLinkDraft}
                type="button"
              >
                Attach
              </button>
            </div>
          ) : null}

          {documents.length > 0 ? (
            <div className="planner-documents__list">
              {documents.map((document) => (
                <article className="planner-document" key={document.id}>
                  <button
                    className="planner-document__open"
                    onClick={() => void onOpenDocument(document)}
                    type="button"
                  >
                    <span className="planner-document__name">
                      {isPlannerLinkDocument(document) ? '↗ ' : ''}
                      {document.name}
                    </span>
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
      {isExportDialogOpen && selectedList ? (
        <LessonPlanPdfExportDialog
          classLists={classLists}
          classListName={selectedList.name}
          currentClassListId={selectedList.id}
          entries={lessonPlanHistory}
          onClose={() => setIsExportDialogOpen(false)}
        />
      ) : null}
      {isDeletedDialogOpen ? (
        <DeletedLessonPlansDialog
          classLists={classLists}
          deletedLessonPlans={deletedLessonPlans}
          onClose={() => setIsDeletedDialogOpen(false)}
          onDeleteSelected={onDeleteDeletedLessonPlans}
          onRestore={onRestoreDeletedLessonPlan}
        />
      ) : null}
      {isTemplatesDialogOpen && templates ? (
        <LessonPlanTemplatesDialog
          canSaveCurrentPlan={Boolean(planText.trim())}
          onClose={() => setIsTemplatesDialogOpen(false)}
          templates={templates}
        />
      ) : null}
    </>
  );
}

export function LessonPlanTemplatesDialog({
  canSaveCurrentPlan,
  onClose,
  templates
}: {
  canSaveCurrentPlan: boolean;
  onClose: () => void;
  templates: PlannerTemplatesProps;
}) {
  const { theme } = useColorModeAppearance();
  const [templateNameDraft, setTemplateNameDraft] = useState('');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="lesson-plan-export-dialog__backdrop planner-week-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="lesson-templates-title"
        aria-modal="true"
        className="panel planner-week-dialog lesson-templates-dialog"
        data-theme={theme}
        role="dialog"
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content planner-week-dialog__content lesson-templates-dialog__content">
          <header className="planner-week-dialog__header">
            <div>
              <span className="panel-kicker">Reusable structures</span>
              <h2 id="lesson-templates-title">Lesson templates</h2>
              <p className="helper-text">
                Save a plan structure (starter / main / plenary) once and drop it into any lesson.
              </p>
            </div>
            <button
              aria-label="Close lesson templates"
              className="widget-icon-button widget-icon-button--close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="lesson-templates-dialog__save-row">
            <input
              aria-label="Template name"
              className="text-field"
              onChange={(event) => setTemplateNameDraft(event.target.value)}
              placeholder="Template name (e.g. Starter / Main / Plenary)"
              type="text"
              value={templateNameDraft}
            />
            <button
              className="primary-link"
              data-tooltip-content={
                canSaveCurrentPlan
                  ? 'Saves the plan currently in the editor as a template'
                  : 'Write a plan first, then save it as a template'
              }
              disabled={!canSaveCurrentPlan}
              onClick={() => {
                templates.onSave(templateNameDraft);
                setTemplateNameDraft('');
              }}
              type="button"
            >
              Save current plan
            </button>
          </div>

          {templates.entries.length > 0 ? (
            <div className="lesson-templates-dialog__list">
              {templates.entries.map((template) => (
                <article className="lesson-templates-dialog__item" key={template.id}>
                  <div className="lesson-templates-dialog__item-copy">
                    <strong>{template.name}</strong>
                    <p>{summarizeLessonPlanForPreview(template.plan)}</p>
                  </div>
                  <div className="lesson-templates-dialog__item-actions">
                    <button
                      className="secondary-link"
                      onClick={() => {
                        templates.onApply(template.id);
                        onClose();
                      }}
                      type="button"
                    >
                      Insert
                    </button>
                    <button
                      aria-label={`Delete template ${template.name}`}
                      className="danger-link"
                      onClick={() => templates.onDelete(template.id)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="widget-empty-state">
              <p className="empty-copy">
                No templates yet. Write a plan, then save it here to reuse its structure.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

export function LessonPlanPdfExportDialog({
  classLists,
  classListName,
  currentClassListId,
  entries,
  onClose
}: {
  classLists: ClassList[];
  classListName: string;
  currentClassListId: string;
  entries: LessonPlansPdfEntry[];
  onClose: () => void;
}) {
  const { theme } = useColorModeAppearance();
  const currentTermSelection = useMemo(
    () => getLessonPlanExportSchoolTermSelection(getTodayDateKey()),
    []
  );
  const availableYears = useMemo(() => getLessonPlanExportYears(entries), [entries]);
  const [selectedClassScope, setSelectedClassScope] = useState<string>(currentClassListId);
  const [rangeMode, setRangeMode] = useState<LessonPlanExportRangeMode>('all-previous');
  const [selectedYear, setSelectedYear] = useState(
    currentTermSelection?.year ?? new Date().getFullYear()
  );
  const [selectedTerm, setSelectedTerm] = useState<number>(currentTermSelection?.term ?? 1);
  const [selectedWeek, setSelectedWeek] = useState<number>(currentTermSelection?.week ?? 1);
  const [customStartDate, setCustomStartDate] = useState(() => entries[0]?.dateKey ?? getTodayDateKey());
  const [customEndDate, setCustomEndDate] = useState(getTodayDateKey());
  const [includeFuturePlans, setIncludeFuturePlans] = useState(false);
  const [includePlanText, setIncludePlanText] = useState(true);
  const [includeAttachedFiles, setIncludeAttachedFiles] = useState(true);
  const [showClassName, setShowClassName] = useState(false);
  const [groupBy, setGroupBy] = useState<LessonPlansPdfExportOptions['groupBy']>('date');
  const [sortOrder, setSortOrder] = useState<LessonPlansPdfExportOptions['sortOrder']>('ascending');
  const [pageBreak, setPageBreak] = useState<LessonPlansPdfExportOptions['pageBreak']>('none');
  const [pdfTitle, setPdfTitle] = useState(`${classListName} Lesson Plans`);
  const [exportStatus, setExportStatus] = useState<{
    kind: 'idle' | 'saving' | 'saved' | 'error';
    message: string | null;
  }>({
    kind: 'idle',
    message: null
  });
  const isSaving = exportStatus.kind === 'saving';
  const selectedClassLabel = getLessonPlanExportClassScopeLabel(
    selectedClassScope,
    classLists,
    classListName
  );
  const filteredEntries = useMemo(
    () =>
      sortLessonPlanExportEntries(
        filterLessonPlanExportEntries(entries, {
          customEndDate,
          customStartDate,
          includeFuturePlans,
          rangeMode,
          selectedClassScope,
          selectedTerm,
          selectedWeek,
          selectedYear
        }),
        groupBy,
        sortOrder
      ),
    [
      customEndDate,
      customStartDate,
      entries,
      groupBy,
      includeFuturePlans,
      rangeMode,
      selectedClassScope,
      selectedTerm,
      selectedWeek,
      selectedYear,
      sortOrder
    ]
  );
  const totalDocumentCount = filteredEntries.reduce(
    (total, entry) => total + entry.documentNames.length,
    0
  );
  const dateRangeLabel = formatLessonPlanExportDateRange(filteredEntries);
  const lessonCountLabel = `${filteredEntries.length} lesson${filteredEntries.length === 1 ? '' : 's'}`;
  const fileCountLabel = `${totalDocumentCount} file${totalDocumentCount === 1 ? '' : 's'}`;
  const filterSummary = buildLessonPlanExportFilterSummary({
    classLabel: selectedClassLabel,
    customEndDate,
    customStartDate,
    includeFuturePlans,
    rangeMode,
    selectedTerm,
    selectedWeek,
    selectedYear
  });
  const contentSelectionIsEmpty = !includePlanText && !includeAttachedFiles;
  const canGenerate = filteredEntries.length > 0 && !contentSelectionIsEmpty;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, onClose]);

  const exportPdf = async () => {
    if (filteredEntries.length === 0) {
      setExportStatus({
        kind: 'error',
        message: 'No lesson plans match these export options.'
      });
      return;
    }

    if (contentSelectionIsEmpty) {
      setExportStatus({
        kind: 'error',
        message: 'Choose at least one thing to include in the PDF.'
      });
      return;
    }

    if (!window.electronAPI?.exportLessonPlansPdf) {
      setExportStatus({
        kind: 'error',
        message: 'PDF export is available in the desktop app only.'
      });
      return;
    }

    setExportStatus({
      kind: 'saving',
      message: 'Choose where to save the PDF...'
    });

    try {
      const result = await window.electronAPI.exportLessonPlansPdf({
        className: selectedClassLabel,
        entries: filteredEntries,
        exportedAtLabel: formatLessonPlanExportGeneratedAtLabel(),
        options: {
          filterSummary,
          groupBy,
          includeAttachedFiles,
          includeClassName: showClassName || selectedClassScope === 'all',
          includePlanText,
          pageBreak,
          sortOrder,
          title: pdfTitle.trim() || 'Lesson Plans'
        }
      });

      if (result.ok) {
        setExportStatus({
          kind: 'saved',
          message: result.filePath ? `Saved PDF to ${result.filePath}.` : 'Saved lesson plan PDF.'
        });
        return;
      }

      if (result.canceled) {
        setExportStatus({
          kind: 'idle',
          message: null
        });
        return;
      }

      setExportStatus({
        kind: 'error',
        message: result.errorMessage ?? 'The lesson plan PDF could not be generated.'
      });
    } catch (error) {
      setExportStatus({
        kind: 'error',
        message:
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'The lesson plan PDF could not be generated.'
      });
    }
  };

  return createPortal(
    <div
      className="lesson-plan-export-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="lesson-plan-export-title"
        aria-modal="true"
        className="panel lesson-plan-export-dialog"
        data-theme={theme}
        role="dialog"
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content lesson-plan-export-dialog__content">
          <header className="lesson-plan-export-dialog__header">
            <div>
              <span className="panel-kicker">PDF generator</span>
              <h2 className="lesson-plan-export-dialog__title" id="lesson-plan-export-title">
                Previous lesson plans
              </h2>
              <p className="helper-text">{filterSummary}</p>
            </div>
            <button
              aria-label="Close PDF generator"
              className="widget-icon-button widget-icon-button--close"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="lesson-plan-export-dialog__options">
            <div className="field-stack lesson-plan-export-dialog__title-field">
              <label className="field-label" htmlFor="lesson-plan-export-title-field">
                PDF title
              </label>
              <input
                className="text-field"
                id="lesson-plan-export-title-field"
                onChange={(event) => setPdfTitle(event.target.value)}
                type="text"
                value={pdfTitle}
              />
            </div>

            <div className="lesson-plan-export-dialog__option-grid">
              <label className="field-stack">
                <span className="field-label">Class</span>
                <select
                  className="text-field"
                  onChange={(event) => setSelectedClassScope(event.target.value)}
                  value={selectedClassScope}
                >
                  <option value={currentClassListId}>{classListName}</option>
                  <option value="all">All classes</option>
                  {classLists
                    .filter((classList) => classList.id !== currentClassListId)
                    .map((classList) => (
                      <option key={classList.id} value={classList.id}>
                        {classList.name}
                      </option>
                    ))}
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Dates</span>
                <select
                  className="text-field"
                  onChange={(event) => setRangeMode(event.target.value as LessonPlanExportRangeMode)}
                  value={rangeMode}
                >
                  <option value="all-previous">All previous dates</option>
                  <option value="this-week">This week</option>
                  <option value="last-week">Last week</option>
                  <option value="this-term">This term</option>
                  <option value="term">Only one term</option>
                  <option value="exclude-term">Everything except one term</option>
                  <option value="term-week">A term week</option>
                  <option value="custom">Custom date range</option>
                </select>
              </label>

              {rangeMode === 'term' || rangeMode === 'exclude-term' || rangeMode === 'term-week' ? (
                <>
                  <label className="field-stack">
                    <span className="field-label">Year</span>
                    <select
                      className="text-field"
                      onChange={(event) => setSelectedYear(Number(event.target.value))}
                      value={selectedYear}
                    >
                      {availableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-stack">
                    <span className="field-label">Term</span>
                    <select
                      className="text-field"
                      onChange={(event) => setSelectedTerm(Number(event.target.value))}
                      value={selectedTerm}
                    >
                      {[1, 2, 3, 4].map((term) => (
                        <option key={term} value={term}>
                          Term {term}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}

              {rangeMode === 'term-week' ? (
                <label className="field-stack">
                  <span className="field-label">Week</span>
                  <select
                    className="text-field"
                    onChange={(event) => setSelectedWeek(Number(event.target.value))}
                    value={selectedWeek}
                  >
                    {Array.from({ length: 12 }, (_value, index) => index + 1).map((week) => (
                      <option key={week} value={week}>
                        Week {week}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {rangeMode === 'custom' ? (
                <>
                  <label className="field-stack">
                    <span className="field-label">From</span>
                    <input
                      className="text-field"
                      onChange={(event) => setCustomStartDate(event.target.value)}
                      type="date"
                      value={customStartDate}
                    />
                  </label>

                  <label className="field-stack">
                    <span className="field-label">To</span>
                    <input
                      className="text-field"
                      onChange={(event) => setCustomEndDate(event.target.value)}
                      type="date"
                      value={customEndDate}
                    />
                  </label>
                </>
              ) : null}

              <label className="field-stack">
                <span className="field-label">Group by</span>
                <select
                  className="text-field"
                  onChange={(event) =>
                    setGroupBy(event.target.value as LessonPlansPdfExportOptions['groupBy'])
                  }
                  value={groupBy}
                >
                  <option value="date">Date</option>
                  <option value="class">Class</option>
                  <option value="term">Term</option>
                  <option value="week">School week</option>
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Order</span>
                <select
                  className="text-field"
                  onChange={(event) =>
                    setSortOrder(event.target.value as LessonPlansPdfExportOptions['sortOrder'])
                  }
                  value={sortOrder}
                >
                  <option value="ascending">Oldest first</option>
                  <option value="descending">Newest first</option>
                </select>
              </label>

              <label className="field-stack">
                <span className="field-label">Page breaks</span>
                <select
                  className="text-field"
                  onChange={(event) => {
                    const nextPageBreak = event.target.value as LessonPlansPdfExportOptions['pageBreak'];
                    setPageBreak(nextPageBreak);
                    if (
                      nextPageBreak === 'class' ||
                      nextPageBreak === 'term' ||
                      nextPageBreak === 'week'
                    ) {
                      setGroupBy(nextPageBreak);
                    }
                  }}
                  value={pageBreak}
                >
                  <option value="none">Flow continuously</option>
                  <option value="class">New page per class</option>
                  <option value="term">New page per term</option>
                  <option value="week">New page per week</option>
                  <option value="lesson">New page per lesson</option>
                </select>
              </label>
            </div>

            <div className="lesson-plan-export-dialog__toggle-grid">
              <label className="lesson-plan-export-dialog__toggle">
                <input
                  checked={includePlanText}
                  onChange={(event) => setIncludePlanText(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>Lesson text</span>
              </label>
              <label className="lesson-plan-export-dialog__toggle">
                <input
                  checked={includeAttachedFiles}
                  onChange={(event) => setIncludeAttachedFiles(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>Attached filenames</span>
              </label>
              <label className="lesson-plan-export-dialog__toggle">
                <input
                  checked={showClassName || selectedClassScope === 'all'}
                  disabled={selectedClassScope === 'all'}
                  onChange={(event) => setShowClassName(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>Class name on each lesson</span>
              </label>
              <label className="lesson-plan-export-dialog__toggle">
                <input
                  checked={includeFuturePlans}
                  onChange={(event) => setIncludeFuturePlans(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>Include future dates</span>
              </label>
            </div>
          </div>

          <div className="lesson-plan-export-dialog__summary" aria-label="Export summary">
            <span>
              <strong>{lessonCountLabel}</strong>
              <small>{dateRangeLabel}</small>
            </span>
            <span>
              <strong>{fileCountLabel}</strong>
              <small>Attached filenames</small>
            </span>
          </div>

          <div className="lesson-plan-export-dialog__preview" role="list">
            {filteredEntries.length > 0 ? (
              filteredEntries.map((entry) => (
                <article className="lesson-plan-export-dialog__entry" key={`${entry.classListId}-${entry.dateKey}`} role="listitem">
                  <div className="lesson-plan-export-dialog__entry-header">
                    <strong>{entry.dateLabel}</strong>
                    <span>
                      {entry.documentNames.length} file{entry.documentNames.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {selectedClassScope === 'all' ? (
                    <span className="lesson-plan-export-dialog__entry-class">{entry.className}</span>
                  ) : null}
                  <p>{summarizeLessonPlanForPreview(entry.plan)}</p>
                  {entry.documentNames.length > 0 ? (
                    <div className="lesson-plan-export-dialog__files">
                      {entry.documentNames.map((documentName) => (
                        <span key={`${entry.classListId}-${entry.dateKey}-${documentName}`}>{documentName}</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="group-maker__empty lesson-plan-export-dialog__empty">
                <p className="empty-copy">No lesson plans match these export options.</p>
              </div>
            )}
          </div>

          <footer className="lesson-plan-export-dialog__footer">
            {exportStatus.message ? (
              <p className={`helper-text lesson-plan-export-dialog__status lesson-plan-export-dialog__status--${exportStatus.kind}`}>
                {exportStatus.message}
              </p>
            ) : contentSelectionIsEmpty ? (
              <p className="helper-text lesson-plan-export-dialog__status lesson-plan-export-dialog__status--error">
                Choose lesson text, attached filenames, or both.
              </p>
            ) : (
              <p className="helper-text">{filterSummary}</p>
            )}
            <div className="lesson-plan-export-dialog__actions">
              <button
                className="secondary-link button-tone--utility"
                disabled={isSaving}
                onClick={onClose}
                type="button"
              >
                Close
              </button>
              <button
                className="primary-link"
                disabled={isSaving || !canGenerate}
                onClick={() => void exportPdf()}
                type="button"
              >
                {isSaving ? 'Generating...' : 'Generate PDF'}
              </button>
            </div>
          </footer>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function WeeklyLessonPlannerContent({
  bellSchedule,
  classLists,
  onOpenDayPlanner,
  onOpenLesson,
  planner
}: {
  bellSchedule: ReturnType<typeof useBellScheduleController>;
  classLists: ClassList[];
  onOpenDayPlanner: () => void;
  onOpenLesson: (classListId: string, dateKey: string) => void;
  planner: ReturnType<typeof useLessonPlannerController>;
}) {
  const [weekStartDate, setWeekStartDate] = useState(() =>
    getPlannerWeekStartDateKey(planner.selectedDate)
  );
  const [weekYear, setWeekYear] = useState(() => getPlannerWeekYear(weekStartDate));
  const [draggedBlock, setDraggedBlock] = useState<PlannerWeekLessonBlock | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    clientX: number;
    clientY: number;
    height: number;
    offsetX: number;
    offsetY: number;
    width: number;
  } | null>(null);
  const [pendingMove, setPendingMove] = useState<
    (PlannerLessonMoveRequest & { className: string }) | null
  >(null);
  const [isDeletedDialogOpen, setIsDeletedDialogOpen] = useState(false);
  const plannerWeekDragStateRef = useRef<{
    draggedBlock: PlannerWeekLessonBlock;
    hasMoved: boolean;
    height: number;
    offsetX: number;
    offsetY: number;
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    width: number;
  } | null>(null);
  const plannerWeekDragPointerRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const plannerWeekDragAnimationFrameRef = useRef<number | null>(null);
  const weekDatesByDay = useMemo(() => getPlannerWeekDatesByDay(weekStartDate), [weekStartDate]);
  const weekOptions = useMemo(
    () => buildPlannerWeekSelectorOptions(weekYear, weekStartDate),
    [weekStartDate, weekYear]
  );
  const weekYears = useMemo(
    () => getPlannerWeekSelectorYears(weekStartDate, planner.lessonPlanHistory, planner.deletedLessonPlans),
    [planner.deletedLessonPlans, planner.lessonPlanHistory, weekStartDate]
  );
  const scheduleBlocks = useMemo(
    () => buildPlannerWeekScheduleBlocks(bellSchedule.weekTimelineByDay),
    [bellSchedule.weekTimelineByDay]
  );
  const lessonBlocks = useMemo(
    () =>
      buildPlannerWeekLessonBlocks({
        getEntryForClassDate: planner.getEntryForClassDate,
        weekDatesByDay,
        weekTimelineByDay: bellSchedule.weekTimelineByDay
      }),
    [bellSchedule.weekTimelineByDay, planner.getEntryForClassDate, weekDatesByDay]
  );
  const lessonBlocksById = useMemo(
    () => new Map(lessonBlocks.map((block) => [block.id, block])),
    [lessonBlocks]
  );
  const timeRange = useMemo(
    () => getPlannerWeekTimeRange(bellSchedule.weekTimelineByDay),
    [bellSchedule.weekTimelineByDay]
  );
  const timeMarks = useMemo(
    () => getPlannerWeekTimeMarks(timeRange, bellSchedule.weekTimelineByDay),
    [bellSchedule.weekTimelineByDay, timeRange]
  );
  const plannedLessonCount = lessonBlocks.filter((block) => block.hasContent).length;
  const weekSummary =
    lessonBlocks.length > 0
      ? `${plannedLessonCount}/${lessonBlocks.length} scheduled lesson${lessonBlocks.length === 1 ? '' : 's'} planned`
      : 'No scheduled lessons in this timetable profile';

  const updateWeekStartDate = (nextDateKey: string) => {
    const normalizedDate = normalizeDateKey(nextDateKey) ?? getTodayDateKey();
    const nextWeekStart = getPlannerWeekStartDateKey(normalizedDate);
    setWeekStartDate(nextWeekStart);
    setWeekYear(getPlannerWeekYear(nextWeekStart));
  };

  const performMove = (request: PlannerLessonMoveRequest) => {
    planner.moveLessonPlan(request);
    setPendingMove(null);
  };

  const handleBlockDrop = (
    sourceBlock: PlannerWeekLessonBlock,
    targetBlock: PlannerWeekLessonBlock
  ) => {
    if (
      sourceBlock.classListId !== targetBlock.classListId ||
      sourceBlock.id === targetBlock.id
    ) {
      return;
    }

    const moveRequest = {
      classListId: sourceBlock.classListId,
      sourceDateKey: sourceBlock.dateKey,
      sourceSlotLabel: `${sourceBlock.slotLabel}, ${formatLongDate(sourceBlock.dateKey)}`,
      targetDateKey: targetBlock.dateKey,
      targetSlotLabel: `${targetBlock.slotLabel}, ${formatLongDate(targetBlock.dateKey)}`
    };

    if (planner.confirmLessonPlanMoves) {
      setPendingMove({
        ...moveRequest,
        className: sourceBlock.className
      });
      return;
    }

    performMove(moveRequest);
  };

  const clearPlannerWeekDragState = () => {
    plannerWeekDragStateRef.current = null;
    plannerWeekDragPointerRef.current = null;
    if (plannerWeekDragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(plannerWeekDragAnimationFrameRef.current);
      plannerWeekDragAnimationFrameRef.current = null;
    }
    setDraggedBlock(null);
    setDragOverBlockId(null);
    setDragPreview(null);
  };

  const getPlannerWeekBlockUnderPointer = (clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY);
    const blockElement = target?.closest<HTMLElement>('[data-planner-week-block-id]') ?? null;
    const blockId = blockElement?.dataset.plannerWeekBlockId;
    return blockId ? lessonBlocksById.get(blockId) ?? null : null;
  };

  const updatePlannerWeekDragPresentation = () => {
    plannerWeekDragAnimationFrameRef.current = null;
    const dragState = plannerWeekDragStateRef.current;
    const pointer = plannerWeekDragPointerRef.current;

    if (!dragState || !pointer || !dragState.hasMoved) {
      return;
    }

    setDragPreview({
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      height: dragState.height,
      offsetX: dragState.offsetX,
      offsetY: dragState.offsetY,
      width: dragState.width
    });

    const hoveredBlock = getPlannerWeekBlockUnderPointer(pointer.clientX, pointer.clientY);
    const canDrop =
      hoveredBlock &&
      hoveredBlock.classListId === dragState.draggedBlock.classListId &&
      hoveredBlock.id !== dragState.draggedBlock.id;

    setDragOverBlockId(canDrop ? hoveredBlock.id : null);
  };

  const beginPlannerWeekDrag = (
    block: PlannerWeekLessonBlock,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0 || !block.hasContent) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    plannerWeekDragStateRef.current = {
      draggedBlock: block,
      hasMoved: false,
      height: bounds.height,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      width: bounds.width
    };
    plannerWeekDragPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };
  };

  const continuePlannerWeekDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = plannerWeekDragStateRef.current;
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
      setDraggedBlock(dragState.draggedBlock);
    }

    plannerWeekDragPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY
    };

    if (plannerWeekDragAnimationFrameRef.current === null) {
      plannerWeekDragAnimationFrameRef.current = window.requestAnimationFrame(
        updatePlannerWeekDragPresentation
      );
    }
  };

  const finishPlannerWeekDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = plannerWeekDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const hoveredBlock = getPlannerWeekBlockUnderPointer(event.clientX, event.clientY);
    const canDrop =
      dragState.hasMoved &&
      hoveredBlock &&
      hoveredBlock.classListId === dragState.draggedBlock.classListId &&
      hoveredBlock.id !== dragState.draggedBlock.id;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    clearPlannerWeekDragState();

    if (canDrop && hoveredBlock) {
      handleBlockDrop(dragState.draggedBlock, hoveredBlock);
    }
  };

  const cancelPlannerWeekDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = plannerWeekDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    clearPlannerWeekDragState();
  };

  useEffect(() => {
    return () => {
      if (plannerWeekDragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(plannerWeekDragAnimationFrameRef.current);
      }
    };
  }, []);

  return (
    <>
      <div className="planner-week">
        <div className="planner-week__toolbar widget-top-controls">
          <div className="planner-week__nav">
            <button
              aria-label="Previous week"
              className="widget-icon-button button-tone--utility planner-week__week-arrow"
              onClick={() => updateWeekStartDate(shiftDateKey(weekStartDate, -7))}
              type="button"
            >
              &lt;
            </button>
            <label className="field-stack planner-week__year-field">
              <span className="field-label">Year</span>
              <select
                className="text-field"
                onChange={(event) => {
                  const nextYear = Number(event.target.value);
                  const nextWeek = buildPlannerWeekSelectorOptions(nextYear, weekStartDate)[0]?.options[0];
                  setWeekYear(nextYear);
                  if (nextWeek) {
                    setWeekStartDate(nextWeek.value);
                  }
                }}
                value={weekYear}
              >
                {weekYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack planner-week__week-field">
              <span className="field-label">Term week</span>
              <select
                className="text-field"
                onChange={(event) => updateWeekStartDate(event.target.value)}
                value={weekStartDate}
              >
                {weekOptions.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button
              aria-label="Next week"
              className="widget-icon-button button-tone--utility planner-week__week-arrow"
              onClick={() => updateWeekStartDate(shiftDateKey(weekStartDate, 7))}
              type="button"
            >
              &gt;
            </button>
          </div>

          <div className="planner-week__actions">
            <button
              className="secondary-link"
              onClick={() => setIsDeletedDialogOpen(true)}
              type="button"
            >
              Deleted plans
              {planner.deletedLessonPlans.length > 0 ? ` (${planner.deletedLessonPlans.length})` : ''}
            </button>
            <label className="planner-week__confirm-toggle">
              <input
                checked={planner.confirmLessonPlanMoves}
                onChange={(event) => planner.setConfirmLessonPlanMoves(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Confirm moves</span>
            </label>
            <button
              className="secondary-link button-tone--utility"
              onClick={() => {
                planner.setSelectedDate(weekStartDate);
                onOpenDayPlanner();
              }}
              type="button"
            >
              Day planner
            </button>
          </div>
        </div>

        <div className="planner-week__summary">
          <div>
            <span className="planner-week__eyebrow">{bellSchedule.activeProfileDisplayName}</span>
            <h3>{formatPlannerWeekRangeLabel(weekStartDate)}</h3>
          </div>
          <p className="helper-text">{planner.statusMessage ?? weekSummary}</p>
        </div>

        {lessonBlocks.length > 0 ? (
          <div className="planner-week__grid">
            <div className="planner-week__axis" aria-hidden="true">
              <div className="planner-week__axis-heading">Time</div>
              <div className="planner-week__axis-track">
                {timeMarks.map((mark) => (
                  <span
                    className="planner-week__time-label"
                    key={`planner-week-time-${mark}`}
                    style={getPlannerWeekTimeMarkStyle(mark, timeRange)}
                  >
                    {formatBellTime(mark)}
                  </span>
                ))}
              </div>
            </div>

            {BELL_SCHEDULE_DAY_KEYS.map((dayKey) => {
              const dayScheduleBlocks = scheduleBlocks.filter((block) => block.dayKey === dayKey);
              const dayBlocks = lessonBlocks.filter((block) => block.dayKey === dayKey);

              return (
                <section className="planner-week__day" key={dayKey}>
                  <header className="planner-week__day-header">
                    <span>{BELL_SCHEDULE_DAY_LABELS[dayKey].slice(0, 3)}</span>
                    <strong>{formatPlannerWeekDayLabel(weekDatesByDay[dayKey])}</strong>
                  </header>
                  <div className="planner-week__day-track">
                    {dayScheduleBlocks.map((block) => (
                      <div
                        aria-hidden="true"
                        className={`planner-week-slot planner-week-slot--${block.status}`}
                        key={block.id}
                        style={getPlannerWeekTimedBlockStyle(block, timeRange)}
                      >
                        {block.status !== 'teaching' ? (
                          <>
                            <span>{block.shortLabel}</span>
                            <strong>{block.label}</strong>
                          </>
                        ) : null}
                      </div>
                    ))}
                    {timeMarks.map((mark) => (
                      <span
                        aria-hidden="true"
                        className="planner-week__time-line"
                        key={`planner-week-line-${dayKey}-${mark}`}
                        style={getPlannerWeekTimeMarkStyle(mark, timeRange)}
                      />
                    ))}
                    {dayBlocks.map((block) => {
                      const isOtherClassDragging =
                        Boolean(draggedBlock) && draggedBlock?.classListId !== block.classListId;
                      const isSameClassDragging =
                        Boolean(draggedBlock) && draggedBlock?.classListId === block.classListId;

                      return (
                        <article
                          className={`planner-week-lesson ${
                            block.hasContent ? '' : 'planner-week-lesson--empty'
                          } ${isOtherClassDragging ? 'planner-week-lesson--faded' : ''} ${
                            isSameClassDragging ? 'planner-week-lesson--highlighted' : ''
                          } ${draggedBlock?.id === block.id ? 'planner-week-lesson--dragging' : ''} ${
                            dragOverBlockId === block.id ? 'planner-week-lesson--drop-target' : ''
                          }`}
                          data-planner-week-block-id={block.id}
                          key={block.id}
                          onDoubleClick={() => onOpenLesson(block.classListId, block.dateKey)}
                          onPointerCancel={cancelPlannerWeekDrag}
                          onPointerDown={(event) => beginPlannerWeekDrag(block, event)}
                          onPointerMove={continuePlannerWeekDrag}
                          onPointerUp={finishPlannerWeekDrag}
                          style={getPlannerWeekTimedBlockStyle(block, timeRange)}
                        >
                          <div className="planner-week-lesson__header">
                            <span>{block.slotShortLabel}</span>
                            <strong>{block.className}</strong>
                            <button
                              aria-label={`${
                                block.hasContent ? 'Edit' : 'Add'
                              } ${block.className} lesson for ${formatLongDate(block.dateKey)}`}
                              className={`planner-week-lesson__open ${
                                block.hasContent ? '' : 'planner-week-lesson__open--empty'
                              }`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenLesson(block.classListId, block.dateKey);
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onDragStart={(event) => event.preventDefault()}
                              onPointerDown={(event) => event.stopPropagation()}
                              type="button"
                            >
                              {block.hasContent ? 'Edit' : 'Add lesson'}
                            </button>
                            {block.hasContent ? (
                              <button
                                aria-label={`Move ${block.className} plan for ${formatLongDate(block.dateKey)} to deleted plans`}
                                className="planner-week-lesson__delete"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  planner.deleteLessonPlan(block.classListId, block.dateKey);
                                }}
                                onDoubleClick={(event) => event.stopPropagation()}
                                onDragStart={(event) => event.preventDefault()}
                                onPointerDown={(event) => event.stopPropagation()}
                                type="button"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                          <p>{block.hasContent ? summarizeLessonPlanForPreview(block.plan) : 'No plan saved'}</p>
                          <div className="planner-week-lesson__meta">
                            <span>{formatBellTimeRange(block)}</span>
                            {block.documentCount > 0 ? (
                              <span>
                                {block.documentCount} file{block.documentCount === 1 ? '' : 's'}
                              </span>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="widget-empty-state planner-week__empty">
            <p className="empty-copy">
              Assign classes to teaching blocks in Timetable and they will appear here.
            </p>
          </div>
        )}
      </div>

      {draggedBlock && dragPreview
        ? createPortal(
            <article
              aria-hidden="true"
              className="planner-week-lesson planner-week__drag-preview"
              style={{
                height: `${dragPreview.height}px`,
                transform: `translate(${dragPreview.clientX - dragPreview.offsetX}px, ${
                  dragPreview.clientY - dragPreview.offsetY
                }px)`,
                width: `${dragPreview.width}px`
              }}
            >
              <div className="planner-week-lesson__header">
                <span>{draggedBlock.slotShortLabel}</span>
                <strong>{draggedBlock.className}</strong>
              </div>
              <p>{summarizeLessonPlanForPreview(draggedBlock.plan)}</p>
              <div className="planner-week-lesson__meta">
                <span>{formatBellTimeRange(draggedBlock)}</span>
                {draggedBlock.documentCount > 0 ? (
                  <span>
                    {draggedBlock.documentCount} file{draggedBlock.documentCount === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
            </article>,
            document.body
          )
        : null}

      {pendingMove ? (
        <LessonPlanMoveConfirmationDialog
          moveRequest={pendingMove}
          onCancel={() => setPendingMove(null)}
          onConfirm={(turnOffFutureConfirmations) => {
            if (turnOffFutureConfirmations) {
              planner.setConfirmLessonPlanMoves(false);
            }
            performMove(pendingMove);
          }}
        />
      ) : null}

      {isDeletedDialogOpen ? (
        <DeletedLessonPlansDialog
          classLists={classLists}
          deletedLessonPlans={planner.deletedLessonPlans}
          onClose={() => setIsDeletedDialogOpen(false)}
          onDeleteSelected={planner.permanentlyDeleteLessonPlans}
          onRestore={planner.restoreDeletedLessonPlan}
        />
      ) : null}
    </>
  );
}

export function LessonPlanMoveConfirmationDialog({
  moveRequest,
  onCancel,
  onConfirm
}: {
  moveRequest: PlannerLessonMoveRequest & { className: string };
  onCancel: () => void;
  onConfirm: (turnOffFutureConfirmations: boolean) => void;
}) {
  const { theme } = useColorModeAppearance();
  const [turnOffFutureConfirmations, setTurnOffFutureConfirmations] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="lesson-plan-export-dialog__backdrop planner-week-dialog__backdrop">
      <section
        aria-labelledby="planner-week-move-title"
        aria-modal="true"
        className="panel planner-week-dialog"
        data-theme={theme}
        role="dialog"
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content planner-week-dialog__content">
          <header className="planner-week-dialog__header">
            <div>
              <span className="panel-kicker">Move lesson</span>
              <h2 id="planner-week-move-title">Confirm replacement</h2>
            </div>
            <button
              aria-label="Close move confirmation"
              className="widget-icon-button widget-icon-button--close"
              onClick={onCancel}
              type="button"
            >
              ×
            </button>
          </header>
          <p className="helper-text">
            Move {moveRequest.className} from {moveRequest.sourceSlotLabel} to{' '}
            {moveRequest.targetSlotLabel}. If a plan is already saved there, it will move to Deleted plans.
          </p>
          <label className="lesson-plan-export-dialog__toggle planner-week-dialog__toggle">
            <input
              checked={turnOffFutureConfirmations}
              onChange={(event) => setTurnOffFutureConfirmations(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>Do not ask me again for lesson moves</span>
          </label>
          <footer className="planner-week-dialog__actions">
            <button className="secondary-link button-tone--utility" onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="primary-link"
              onClick={() => onConfirm(turnOffFutureConfirmations)}
              type="button"
            >
              Move lesson
            </button>
          </footer>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function DeletedLessonPlansDialog({
  classLists,
  deletedLessonPlans,
  onClose,
  onDeleteSelected,
  onRestore
}: {
  classLists: ClassList[];
  deletedLessonPlans: DeletedLessonPlanEntry[];
  onClose: () => void;
  onDeleteSelected: (ids: string[]) => void;
  onRestore: (id: string, dateKey: string) => void;
}) {
  const { theme } = useColorModeAppearance();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [restoreDatesById, setRestoreDatesById] = useState<Record<string, string>>({});
  const sortedEntries = useMemo(
    () => [...deletedLessonPlans].sort((left, right) => right.deletedAt - left.deletedAt),
    [deletedLessonPlans]
  );
  const allSelected = sortedEntries.length > 0 && selectedIds.length === sortedEntries.length;

  useEffect(() => {
    const liveIds = new Set(deletedLessonPlans.map((entry) => entry.id));
    setSelectedIds((current) => current.filter((id) => liveIds.has(id)));
  }, [deletedLessonPlans]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const toggleSelectedId = (entryId: string, selected: boolean) => {
    setSelectedIds((current) => {
      if (selected) {
        return current.includes(entryId) ? current : [...current, entryId];
      }

      return current.filter((id) => id !== entryId);
    });
  };

  return createPortal(
    <div className="lesson-plan-export-dialog__backdrop planner-week-dialog__backdrop">
      <section
        aria-labelledby="deleted-lesson-plans-title"
        aria-modal="true"
        className="panel deleted-lessons-dialog"
        data-theme={theme}
        role="dialog"
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content deleted-lessons-dialog__content">
          <header className="planner-week-dialog__header">
            <div>
              <span className="panel-kicker">Deleted plans</span>
              <h2 id="deleted-lesson-plans-title">Lesson plan history</h2>
              <p className="helper-text">
                Restore a plan by choosing a date, or select plans to permanently delete.
              </p>
            </div>
            <button
              aria-label="Close deleted lesson plans"
              className="widget-icon-button widget-icon-button--close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="deleted-lessons-dialog__toolbar">
            <label className="deleted-lessons-dialog__check-all">
              <input
                checked={allSelected}
                disabled={sortedEntries.length === 0}
                onChange={(event) =>
                  setSelectedIds(event.currentTarget.checked ? sortedEntries.map((entry) => entry.id) : [])
                }
                type="checkbox"
              />
              <span>Check all</span>
            </label>
            <button
              className="danger-link"
              disabled={selectedIds.length === 0}
              onClick={() => {
                onDeleteSelected(selectedIds);
                setSelectedIds([]);
              }}
              type="button"
            >
              Permanently delete
              {selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </button>
          </div>

          {sortedEntries.length > 0 ? (
            <div className="deleted-lessons-dialog__list">
              {sortedEntries.map((entry) => {
                const restoreDate = restoreDatesById[entry.id] ?? '';
                const className = getPlannerClassName(entry.classListId, classLists, entry.className);

                return (
                  <article className="deleted-lesson" key={entry.id}>
                    <label className="deleted-lesson__select">
                      <input
                        checked={selectedIds.includes(entry.id)}
                        onChange={(event) => toggleSelectedId(entry.id, event.currentTarget.checked)}
                        type="checkbox"
                      />
                      <span className="sr-only">Select {className}</span>
                    </label>
                    <div className="deleted-lesson__copy">
                      <div className="deleted-lesson__heading">
                        <strong>{className}</strong>
                        <span>{entry.reason === 'replaced' ? 'Replaced' : 'Deleted'}</span>
                      </div>
                      <p>{summarizeLessonPlanForPreview(entry.plan)}</p>
                      <div className="deleted-lesson__meta">
                        <span>Original date: {formatLongDate(entry.dateKey)}</span>
                        <span>Deleted: {formatDeletedLessonPlanTimestamp(entry.deletedAt)}</span>
                        {entry.documents.length > 0 ? (
                          <span>
                            {entry.documents.length} file{entry.documents.length === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="deleted-lesson__restore">
                      <label className="field-stack">
                        <span className="field-label">Restore date</span>
                        <input
                          className="text-field"
                          onChange={(event) =>
                            setRestoreDatesById((current) => ({
                              ...current,
                              [entry.id]: event.target.value
                            }))
                          }
                          type="date"
                          value={restoreDate}
                        />
                      </label>
                      <button
                        className="primary-link"
                        disabled={!normalizeDateKey(restoreDate)}
                        onClick={() => onRestore(entry.id, restoreDate)}
                        type="button"
                      >
                        Restore
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="widget-empty-state deleted-lessons-dialog__empty">
              <p className="empty-copy">No deleted lesson plans yet.</p>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

export function PlannerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const [picker, setPicker] = usePickerState();
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const planner = useLessonPlannerController(picker.selectedListId, picker.lists);
  const bellSchedule = useBellScheduleController(picker.lists);
  const [popoutMode, setPopoutMode] = usePlannerPopoutModeState();
  const showWeekPlanner = popoutMode === 'week';
  const nextLessonDateKey = selectedList
    ? findNextLessonDateKey(bellSchedule.weekTimelineByDay, selectedList.id, planner.selectedDate)
    : null;

  return (
    <WidgetCard
      badge={planner.documents.length > 0 ? `${planner.documents.length}` : null}
      collapsed={false}
      description={
        showWeekPlanner
          ? `Weekly planner using ${bellSchedule.activeProfileDisplayName}`
          : selectedList
            ? `Planning ${selectedList.name}`
            : 'Choose a class from the main dashboard.'
      }
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
      {showWeekPlanner ? (
        <WeeklyLessonPlannerContent
          bellSchedule={bellSchedule}
          classLists={picker.lists}
          onOpenDayPlanner={() => setPopoutMode('editor')}
          onOpenLesson={(classListId, dateKey) => {
            planner.setSelectedDateForClass(classListId, dateKey);
            setPicker((current) => activateClassList(current, classListId));
            setPopoutMode('editor');
          }}
          planner={planner}
        />
      ) : (
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
          onOpenWeeklyPlanner={() => setPopoutMode('week')}
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
          weeklyPlannerActionAriaLabel="Back to weekly lesson planner"
          weeklyPlannerActionLabel="Back"
          weeklyPlannerActionPlacement="top-left"
        />
      )}
    </WidgetCard>
  );
}

export function usePlannerState() {
  return usePersistentState<PlannerSnapshot>('teacher-tools.planner', DEFAULT_PLANNER, {
    normalize: normalizePlannerSnapshot
  });
}

export function usePlannerPopoutModeState() {
  return usePersistentState<PlannerPopoutMode>(
    'teacher-tools.planner-popout-mode',
    'week',
    {
      normalize: normalizePlannerPopoutMode
    }
  );
}

export function useLessonPlannerController(selectedListId: string | null, classLists: ClassList[]) {
  const [planner, setPlanner] = usePlannerState();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const selectedDate = getPlannerSelectedDate(planner, selectedListId);
  const entry = getPlannerEntry(planner, selectedListId, selectedDate);
  const documents = entry?.documents ?? [];
  const plan = entry?.plan ?? '';
  const entryDates = Object.keys(planner.entriesByListId[getDashboardLayoutKey(selectedListId)] ?? {});
  const deletedLessonPlans = planner.deletedEntries;
  const confirmLessonPlanMoves = planner.confirmLessonPlanMoves;
  const lessonPlanHistory = useMemo(
    () => getPlannerEntriesForClassLists(planner, classLists),
    [classLists, planner]
  );

  useEffect(() => {
    setStatusMessage(null);
  }, [selectedDate, selectedListId]);

  const setSelectedDate = (dateKey: string) => {
    const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();

    setPlanner((current) => setPlannerDateForList(current, selectedListId, normalizedDate));
  };

  const setSelectedDateForClass = (classListId: string, dateKey: string) => {
    const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();

    setPlanner((current) => setPlannerDateForList(current, classListId, normalizedDate));
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

  const moveLessonPlan = (request: PlannerLessonMoveRequest) => {
    const sourceEntry = getPlannerEntry(planner, request.classListId, request.sourceDateKey);
    const className = getPlannerClassName(request.classListId, classLists);

    if (!sourceEntry) {
      setStatusMessage(`No saved lesson plan to move from ${formatLongDate(request.sourceDateKey)}.`);
      return;
    }

    if (request.sourceDateKey === request.targetDateKey) {
      setStatusMessage(`${className} is already planned for ${formatLongDate(request.targetDateKey)}.`);
      return;
    }

    const targetEntry = getPlannerEntry(planner, request.classListId, request.targetDateKey);

    setPlanner((current) => movePlannerLessonEntry(current, request, classLists));
    setStatusMessage(
      targetEntry
        ? `Moved ${className} to ${formatLongDate(request.targetDateKey)}. The replaced plan is in Deleted plans.`
        : `Moved ${className} to ${formatLongDate(request.targetDateKey)}.`
    );
  };

  const deleteLessonPlan = (classListId: string, dateKey: string) => {
    const entryToDelete = getPlannerEntry(planner, classListId, dateKey);
    const className = getPlannerClassName(classListId, classLists);

    if (!entryToDelete) {
      setStatusMessage(`No saved ${className} plan to delete for ${formatLongDate(dateKey)}.`);
      return;
    }

    setPlanner((current) => deletePlannerLessonEntry(current, classListId, dateKey, classLists));
    setStatusMessage(`Moved ${className}'s ${formatLongDate(dateKey)} plan to Deleted plans.`);
  };

  const restoreDeletedLessonPlan = (deletedEntryId: string, dateKey: string) => {
    const normalizedDate = normalizeDateKey(dateKey);
    const deletedEntry = planner.deletedEntries.find((candidate) => candidate.id === deletedEntryId);

    if (!normalizedDate || !deletedEntry) {
      return;
    }

    const existingEntry = getPlannerEntry(planner, deletedEntry.classListId, normalizedDate);

    setPlanner((current) =>
      restoreDeletedPlannerLessonEntry(current, deletedEntryId, normalizedDate, classLists)
    );
    setStatusMessage(
      existingEntry
        ? `Restored ${deletedEntry.className} to ${formatLongDate(normalizedDate)}. The replaced plan is still in Deleted plans.`
        : `Restored ${deletedEntry.className} to ${formatLongDate(normalizedDate)}.`
    );
  };

  const permanentlyDeleteLessonPlans = (deletedEntryIds: string[]) => {
    const selectedIds = new Set(deletedEntryIds);

    if (selectedIds.size === 0) {
      return;
    }

    setPlanner((current) => ({
      ...current,
      deletedEntries: current.deletedEntries.filter((entry) => !selectedIds.has(entry.id))
    }));
    setStatusMessage(
      `Permanently deleted ${selectedIds.size} lesson plan${selectedIds.size === 1 ? '' : 's'}.`
    );
  };

  const setConfirmLessonPlanMoves = (confirmLessonMoves: boolean) => {
    setPlanner((current) => ({
      ...current,
      confirmLessonPlanMoves: confirmLessonMoves
    }));
  };

  const toggleCarryOver = (carryOver: boolean) => {
    setPlanner((current) =>
      updatePlannerEntry(current, selectedListId, selectedDate, (existing) => ({
        ...existing,
        carryOver
      }))
    );
  };

  const carryOverSource = getPlannerCarryOverSource(planner, selectedListId, selectedDate);

  const acceptCarryOver = () => {
    if (!selectedListId || !carryOverSource) {
      return;
    }

    const sourceDateKey = carryOverSource.dateKey;

    setPlanner((current) => {
      const sourceEntry = getPlannerEntry(current, selectedListId, sourceDateKey);

      if (!sourceEntry) {
        return current;
      }

      const carriedText = `Carried over from ${formatLongDate(sourceDateKey)}:\n${sourceEntry.plan.trim()}`;
      const withAppendedPlan = updatePlannerEntry(
        current,
        selectedListId,
        selectedDate,
        (existing) => ({
          ...existing,
          plan: existing.plan.trim() ? `${existing.plan.trimEnd()}\n\n${carriedText}` : carriedText,
          updatedAt: Date.now()
        })
      );

      return setPlannerEntryForClassDate(withAppendedPlan, selectedListId, sourceDateKey, {
        ...sourceEntry,
        carryOver: false
      });
    });
    setStatusMessage(`Brought the unfinished plan forward from ${formatLongDate(sourceDateKey)}.`);
  };

  const copyLessonForward = (targetDateKey: string) => {
    if (!selectedListId) {
      return;
    }

    const normalizedTarget = normalizeDateKey(targetDateKey);
    const sourceEntry = getPlannerEntry(planner, selectedListId, selectedDate);

    if (!sourceEntry) {
      setStatusMessage('Save a plan or attach documents first, then copy it forward.');
      return;
    }

    if (!normalizedTarget || normalizedTarget === selectedDate) {
      return;
    }

    const targetEntry = getPlannerEntry(planner, selectedListId, normalizedTarget);

    setPlanner((current) =>
      copyPlannerLessonEntry(current, selectedListId, selectedDate, normalizedTarget, classLists)
    );
    setStatusMessage(
      targetEntry
        ? `Copied to ${formatLongDate(normalizedTarget)}. The replaced plan is in Deleted plans.`
        : `Copied this lesson to ${formatLongDate(normalizedTarget)}.`
    );
  };

  const addLinkDocument = (rawUrl: string) => {
    const url = normalizePlannerLinkUrl(rawUrl);

    if (!url) {
      setStatusMessage('That link did not look like a web address.');
      return;
    }

    setPlanner((current) =>
      updatePlannerEntry(current, selectedListId, selectedDate, (existing) => ({
        ...existing,
        documents: existing.documents.some((document) => document.path === url)
          ? existing.documents
          : [
              ...existing.documents,
              {
                addedAt: Date.now(),
                id: createStickyNoteId(),
                name: getPlannerLinkDisplayName(url),
                path: url
              }
            ],
        updatedAt: Date.now()
      }))
    );
    setStatusMessage(`Link attached for ${formatLongDate(selectedDate)}.`);
  };

  const saveTemplate = (name: string) => {
    const trimmedPlan = plan.trim();

    if (!trimmedPlan) {
      return;
    }

    setPlanner((current) => ({
      ...current,
      templates: [
        {
          createdAt: Date.now(),
          id: `lesson-template-${createStickyNoteId()}`,
          name: name.trim() || `Template ${current.templates.length + 1}`,
          plan
        },
        ...current.templates
      ].slice(0, PLANNER_TEMPLATE_LIMIT)
    }));
    setStatusMessage('Saved the current plan as a template.');
  };

  const applyTemplate = (templateId: string) => {
    const template = planner.templates.find((candidate) => candidate.id === templateId);

    if (!template) {
      return;
    }

    setPlanner((current) =>
      updatePlannerEntry(current, selectedListId, selectedDate, (existing) => ({
        ...existing,
        plan: existing.plan.trim()
          ? `${existing.plan.trimEnd()}\n\n${template.plan}`
          : template.plan,
        updatedAt: Date.now()
      }))
    );
    setStatusMessage(`Inserted the “${template.name}” template.`);
  };

  const deleteTemplate = (templateId: string) => {
    setPlanner((current) => ({
      ...current,
      templates: current.templates.filter((template) => template.id !== templateId)
    }));
  };

  return {
    acceptCarryOver,
    addLinkDocument,
    applyTemplate,
    attachDocuments,
    carryOverFlagged: entry?.carryOver === true,
    carryOverSource,
    confirmLessonPlanMoves,
    copyLessonForward,
    deleteLessonPlan,
    deleteTemplate,
    deletedLessonPlans,
    documents,
    entryDates,
    getEntryForClassDate: (classListId: string, dateKey: string) =>
      getPlannerEntry(planner, classListId, dateKey),
    hasContent: Boolean(plan.trim() || documents.length > 0),
    lessonPlanHistory,
    moveLessonPlan,
    openDocument,
    permanentlyDeleteLessonPlans,
    plan,
    removeDocument,
    restoreDeletedLessonPlan,
    saveTemplate,
    selectedDate,
    setSelectedDate,
    setSelectedDateForClass,
    setConfirmLessonPlanMoves,
    statusMessage,
    templates: planner.templates,
    toggleCarryOver,
    updatePlan
  };
}

export function normalizePlannerPopoutMode(
  raw: unknown,
  initialValue: PlannerPopoutMode
) {
  return raw === 'editor' || raw === 'week' ? raw : initialValue;
}

export const SCHOOL_TERMS = [
  { end: { day: 2, monthIndex: 3 }, start: { day: 2, monthIndex: 1 }, term: 1 },
  { end: { day: 3, monthIndex: 6 }, start: { day: 20, monthIndex: 3 }, term: 2 },
  { end: { day: 25, monthIndex: 8 }, start: { day: 20, monthIndex: 6 }, term: 3 },
  { end: { day: 17, monthIndex: 11 }, start: { day: 12, monthIndex: 9 }, term: 4 }
] as const;

export function getSchoolTermWeek(date: Date) {
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

export function formatSchoolDateLabel(date: Date) {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  const schoolTermWeek = getSchoolTermWeek(date);

  if (!schoolTermWeek) {
    return `${weekday}, School holidays`;
  }

  return `${weekday}, Week ${schoolTermWeek.week}, Term ${schoolTermWeek.term}`;
}

export function formatLessonPlanExportDate(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return dateKey;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    year: 'numeric'
  }).format(new Date(parsed.year, parsed.monthIndex, parsed.day));
}

export function formatLessonPlanExportGeneratedAtLabel() {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date());
}

export function getLessonPlanExportSchoolTermSelection(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  const schoolTermWeek = getSchoolTermWeek(new Date(parsed.year, parsed.monthIndex, parsed.day));
  if (!schoolTermWeek) {
    return null;
  }

  return {
    term: schoolTermWeek.term,
    week: schoolTermWeek.week,
    year: parsed.year
  };
}

export function getLessonPlanExportWeekRange(dateKey: string, weekOffset = 0) {
  const parsed = parseDateKey(dateKey) ?? parseDateKey(getTodayDateKey());
  if (!parsed) {
    return {
      end: getTodayDateKey(),
      start: getTodayDateKey()
    };
  }

  const date = new Date(parsed.year, parsed.monthIndex, parsed.day + weekOffset * 7);
  const mondayOffset = (date.getDay() + 6) % 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);

  return {
    end: formatDateKey(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()),
    start: formatDateKey(monday.getFullYear(), monday.getMonth(), monday.getDate())
  };
}

export function getLessonPlanExportYears(entries: LessonPlansPdfEntry[]) {
  const currentYear = new Date().getFullYear();
  const years = Array.from(new Set([currentYear, ...entries.map((entry) => entry.year)]))
    .filter((year) => Number.isInteger(year))
    .sort((left, right) => right - left);

  return years.length > 0 ? years : [currentYear];
}

export function getLessonPlanExportClassScopeLabel(
  selectedClassScope: string,
  classLists: ClassList[],
  fallbackClassName: string
) {
  if (selectedClassScope === 'all') {
    return 'All classes';
  }

  return classLists.find((classList) => classList.id === selectedClassScope)?.name ?? fallbackClassName;
}

export function formatLessonPlanExportRangeLabel({
  customEndDate,
  customStartDate,
  rangeMode,
  selectedTerm,
  selectedWeek,
  selectedYear
}: {
  customEndDate: string;
  customStartDate: string;
  rangeMode: LessonPlanExportRangeMode;
  selectedTerm: number;
  selectedWeek: number;
  selectedYear: number;
}) {
  if (rangeMode === 'this-week' || rangeMode === 'last-week') {
    const range = getLessonPlanExportWeekRange(getTodayDateKey(), rangeMode === 'last-week' ? -1 : 0);
    return `${rangeMode === 'last-week' ? 'Last week' : 'This week'} (${formatLessonPlanExportDate(range.start)} - ${formatLessonPlanExportDate(range.end)})`;
  }

  if (rangeMode === 'this-term') {
    const currentTerm = getLessonPlanExportSchoolTermSelection(getTodayDateKey());
    return currentTerm ? `This term (Term ${currentTerm.term}, ${currentTerm.year})` : 'This term';
  }

  if (rangeMode === 'term') {
    return `Only Term ${selectedTerm}, ${selectedYear}`;
  }

  if (rangeMode === 'exclude-term') {
    return `Everything except Term ${selectedTerm}, ${selectedYear}`;
  }

  if (rangeMode === 'term-week') {
    return `Term ${selectedTerm}, Week ${selectedWeek}, ${selectedYear}`;
  }

  if (rangeMode === 'custom') {
    return `${formatLessonPlanExportDate(customStartDate)} - ${formatLessonPlanExportDate(customEndDate)}`;
  }

  return 'All previous dates';
}

export function buildLessonPlanExportFilterSummary({
  classLabel,
  customEndDate,
  customStartDate,
  includeFuturePlans,
  rangeMode,
  selectedTerm,
  selectedWeek,
  selectedYear
}: {
  classLabel: string;
  customEndDate: string;
  customStartDate: string;
  includeFuturePlans: boolean;
  rangeMode: LessonPlanExportRangeMode;
  selectedTerm: number;
  selectedWeek: number;
  selectedYear: number;
}) {
  const rangeLabel = formatLessonPlanExportRangeLabel({
    customEndDate,
    customStartDate,
    rangeMode,
    selectedTerm,
    selectedWeek,
    selectedYear
  });

  return `${classLabel}; ${rangeLabel}; ${includeFuturePlans ? 'future dates included' : 'saved through today'}`;
}

export function filterLessonPlanExportEntries(
  entries: LessonPlansPdfEntry[],
  options: {
    customEndDate: string;
    customStartDate: string;
    includeFuturePlans: boolean;
    rangeMode: LessonPlanExportRangeMode;
    selectedClassScope: string;
    selectedTerm: number;
    selectedWeek: number;
    selectedYear: number;
  }
) {
  const todayKey = getTodayDateKey();
  const currentTerm = getLessonPlanExportSchoolTermSelection(todayKey);
  const thisWeekRange = getLessonPlanExportWeekRange(todayKey);
  const lastWeekRange = getLessonPlanExportWeekRange(todayKey, -1);
  const customStart = normalizeDateKey(options.customStartDate) ?? todayKey;
  const customEnd = normalizeDateKey(options.customEndDate) ?? todayKey;
  const customRangeStart = customStart <= customEnd ? customStart : customEnd;
  const customRangeEnd = customStart <= customEnd ? customEnd : customStart;

  return entries.filter((entry) => {
    if (options.selectedClassScope !== 'all' && entry.classListId !== options.selectedClassScope) {
      return false;
    }

    if (!options.includeFuturePlans && entry.dateKey > todayKey) {
      return false;
    }

    if (options.rangeMode === 'this-week') {
      return entry.dateKey >= thisWeekRange.start && entry.dateKey <= thisWeekRange.end;
    }

    if (options.rangeMode === 'last-week') {
      return entry.dateKey >= lastWeekRange.start && entry.dateKey <= lastWeekRange.end;
    }

    if (options.rangeMode === 'this-term') {
      return Boolean(
        currentTerm &&
          entry.year === currentTerm.year &&
          entry.schoolTerm === currentTerm.term
      );
    }

    if (options.rangeMode === 'term') {
      return entry.year === options.selectedYear && entry.schoolTerm === options.selectedTerm;
    }

    if (options.rangeMode === 'exclude-term') {
      return !(entry.year === options.selectedYear && entry.schoolTerm === options.selectedTerm);
    }

    if (options.rangeMode === 'term-week') {
      return (
        entry.year === options.selectedYear &&
        entry.schoolTerm === options.selectedTerm &&
        entry.schoolWeek === options.selectedWeek
      );
    }

    if (options.rangeMode === 'custom') {
      return entry.dateKey >= customRangeStart && entry.dateKey <= customRangeEnd;
    }

    return true;
  });
}

export function getLessonPlanExportGroupSortValue(
  entry: LessonPlansPdfEntry,
  groupBy: LessonPlansPdfExportOptions['groupBy']
) {
  if (groupBy === 'class') {
    return entry.className;
  }

  if (groupBy === 'term') {
    return `${entry.year}-${`${entry.schoolTerm ?? 99}`.padStart(2, '0')}`;
  }

  if (groupBy === 'week') {
    return `${entry.year}-${`${entry.schoolTerm ?? 99}`.padStart(2, '0')}-${`${entry.schoolWeek ?? 99}`.padStart(2, '0')}`;
  }

  return '';
}

export function sortLessonPlanExportEntries(
  entries: LessonPlansPdfEntry[],
  groupBy: LessonPlansPdfExportOptions['groupBy'],
  sortOrder: LessonPlansPdfExportOptions['sortOrder']
) {
  return [...entries].sort((left, right) => {
    const leftGroup = getLessonPlanExportGroupSortValue(left, groupBy);
    const rightGroup = getLessonPlanExportGroupSortValue(right, groupBy);
    const groupComparison = leftGroup.localeCompare(rightGroup);

    if (groupComparison !== 0) {
      return sortOrder === 'descending' ? -groupComparison : groupComparison;
    }

    const dateComparison = left.dateKey.localeCompare(right.dateKey);
    if (dateComparison !== 0) {
      return sortOrder === 'descending' ? -dateComparison : dateComparison;
    }

    return left.className.localeCompare(right.className);
  });
}

export function formatLessonPlanExportDateRange(entries: LessonPlansPdfEntry[]) {
  if (entries.length === 0) {
    return 'No previous dates';
  }

  const sortedDates = entries.map((entry) => entry.dateKey).sort();
  const firstDate = sortedDates[0];
  const lastDate = sortedDates.at(-1) ?? firstDate;

  if (firstDate === lastDate) {
    return formatLessonPlanExportDate(firstDate);
  }

  return `${formatLessonPlanExportDate(firstDate)} - ${formatLessonPlanExportDate(lastDate)}`;
}

export function summarizeLessonPlanForPreview(plan: string) {
  const normalizedPlan = plan.trim().replace(/\s+/g, ' ');

  if (!normalizedPlan) {
    return 'No written plan saved.';
  }

  return normalizedPlan.length > 140 ? `${normalizedPlan.slice(0, 137)}...` : normalizedPlan;
}

export function getPlannerClassName(
  classListId: string,
  classLists: ClassList[],
  fallback = 'Class not set'
) {
  return classLists.find((classList) => classList.id === classListId)?.name ?? fallback;
}

export function copyLessonPlanEntry(entry: LessonPlanEntry): LessonPlanEntry {
  return {
    carryOver: entry.carryOver,
    documents: entry.documents.map((document) => ({ ...document })),
    plan: entry.plan,
    updatedAt: Date.now()
  };
}

export function createDeletedLessonPlanEntry(
  entry: LessonPlanEntry,
  classListId: string,
  dateKey: string,
  classLists: ClassList[],
  reason: DeletedLessonPlanEntry['reason']
): DeletedLessonPlanEntry {
  return {
    ...copyLessonPlanEntry(entry),
    classListId,
    className: getPlannerClassName(classListId, classLists),
    dateKey,
    deletedAt: Date.now(),
    id: `deleted-lesson-plan-${createStickyNoteId()}`,
    reason
  };
}

export function setPlannerEntryForClassDate(
  snapshot: PlannerSnapshot,
  classListId: string,
  dateKey: string,
  entry: LessonPlanEntry | null
) {
  const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();
  const listKey = getDashboardLayoutKey(classListId);
  const nextEntriesByListId = { ...snapshot.entriesByListId };
  const nextEntriesForList = { ...(nextEntriesByListId[listKey] ?? {}) };

  if (entry) {
    nextEntriesForList[normalizedDate] = normalizeLessonPlanEntry(entry) ?? copyLessonPlanEntry(entry);
  } else {
    delete nextEntriesForList[normalizedDate];
  }

  if (Object.keys(nextEntriesForList).length > 0) {
    nextEntriesByListId[listKey] = nextEntriesForList;
  } else {
    delete nextEntriesByListId[listKey];
  }

  return {
    ...snapshot,
    entriesByListId: nextEntriesByListId
  };
}

export function movePlannerLessonEntry(
  snapshot: PlannerSnapshot,
  request: PlannerLessonMoveRequest,
  classLists: ClassList[]
) {
  const sourceDate = normalizeDateKey(request.sourceDateKey);
  const targetDate = normalizeDateKey(request.targetDateKey);

  if (!sourceDate || !targetDate || sourceDate === targetDate) {
    return snapshot;
  }

  const sourceEntry = getPlannerEntry(snapshot, request.classListId, sourceDate);
  if (!sourceEntry) {
    return snapshot;
  }

  const targetEntry = getPlannerEntry(snapshot, request.classListId, targetDate);
  const deletedEntries = targetEntry
    ? [
        ...snapshot.deletedEntries,
        createDeletedLessonPlanEntry(targetEntry, request.classListId, targetDate, classLists, 'replaced')
      ]
    : snapshot.deletedEntries;
  const withoutSource = setPlannerEntryForClassDate(snapshot, request.classListId, sourceDate, null);
  const withTarget = setPlannerEntryForClassDate(
    withoutSource,
    request.classListId,
    targetDate,
    copyLessonPlanEntry(sourceEntry)
  );

  return {
    ...setPlannerDateForList(withTarget, request.classListId, targetDate),
    deletedEntries
  };
}

export function copyPlannerLessonEntry(
  snapshot: PlannerSnapshot,
  classListId: string,
  sourceDateKey: string,
  targetDateKey: string,
  classLists: ClassList[]
) {
  const sourceDate = normalizeDateKey(sourceDateKey);
  const targetDate = normalizeDateKey(targetDateKey);

  if (!sourceDate || !targetDate || sourceDate === targetDate) {
    return snapshot;
  }

  const sourceEntry = getPlannerEntry(snapshot, classListId, sourceDate);

  if (!sourceEntry) {
    return snapshot;
  }

  const targetEntry = getPlannerEntry(snapshot, classListId, targetDate);
  const deletedEntries = targetEntry
    ? [
        ...snapshot.deletedEntries,
        createDeletedLessonPlanEntry(targetEntry, classListId, targetDate, classLists, 'replaced')
      ]
    : snapshot.deletedEntries;

  return {
    ...setPlannerEntryForClassDate(snapshot, classListId, targetDate, {
      ...copyLessonPlanEntry(sourceEntry),
      carryOver: false
    }),
    deletedEntries
  };
}

/**
 * The most recent lesson before `beforeDateKey` that was flagged "not
 * finished" — its content gets offered to the next lesson with that class.
 */
export function getPlannerCarryOverSource(
  snapshot: PlannerSnapshot,
  listId: string | null,
  beforeDateKey: string
) {
  const entriesForList = snapshot.entriesByListId[getDashboardLayoutKey(listId)] ?? {};
  const flaggedDates = Object.keys(entriesForList)
    .filter((dateKey) => dateKey < beforeDateKey && entriesForList[dateKey].carryOver)
    .sort();
  const sourceDateKey = flaggedDates.at(-1);

  if (!sourceDateKey) {
    return null;
  }

  return {
    dateKey: sourceDateKey,
    plan: entriesForList[sourceDateKey].plan
  };
}

/**
 * Finds the next date after `afterDateKey` on which this class appears in the
 * timetable, falling back to the same weekday next week.
 */
export function findNextLessonDateKey(
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>,
  classListId: string,
  afterDateKey: string
) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const dateKey = shiftDateKey(afterDateKey, offset);
    const parsed = parseDateKey(dateKey);

    if (!parsed) {
      continue;
    }

    const dayKey = getBellScheduleDayKey(new Date(parsed.year, parsed.monthIndex, parsed.day));

    if (
      dayKey &&
      weekTimelineByDay[dayKey]?.some(
        (entry) => entry.status === 'teaching' && entry.classList?.id === classListId
      )
    ) {
      return dateKey;
    }
  }

  return shiftDateKey(afterDateKey, 7);
}

export function normalizePlannerLinkUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    if (!parsed.hostname.includes('.')) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function getPlannerLinkDisplayName(url: string) {
  try {
    const parsed = new URL(url);
    const pathLabel = parsed.pathname !== '/' ? decodeURIComponent(parsed.pathname) : '';
    const label = `${parsed.hostname.replace(/^www\./, '')}${pathLabel}`;

    return label.length > 60 ? `${label.slice(0, 57)}…` : label;
  } catch {
    return url;
  }
}

export function isPlannerLinkDocument(document: PlannerDocument) {
  return /^https?:\/\//i.test(document.path);
}

export function deletePlannerLessonEntry(
  snapshot: PlannerSnapshot,
  classListId: string,
  dateKey: string,
  classLists: ClassList[]
) {
  const normalizedDate = normalizeDateKey(dateKey);

  if (!normalizedDate) {
    return snapshot;
  }

  const entry = getPlannerEntry(snapshot, classListId, normalizedDate);
  if (!entry) {
    return snapshot;
  }

  return {
    ...setPlannerEntryForClassDate(snapshot, classListId, normalizedDate, null),
    deletedEntries: [
      ...snapshot.deletedEntries,
      createDeletedLessonPlanEntry(entry, classListId, normalizedDate, classLists, 'deleted')
    ]
  };
}

export function restoreDeletedPlannerLessonEntry(
  snapshot: PlannerSnapshot,
  deletedEntryId: string,
  restoreDateKey: string,
  classLists: ClassList[]
) {
  const restoreDate = normalizeDateKey(restoreDateKey);
  const deletedEntry = snapshot.deletedEntries.find((entry) => entry.id === deletedEntryId);

  if (!restoreDate || !deletedEntry) {
    return snapshot;
  }

  const existingEntry = getPlannerEntry(snapshot, deletedEntry.classListId, restoreDate);
  const deletedEntries = snapshot.deletedEntries.filter((entry) => entry.id !== deletedEntryId);
  const nextDeletedEntries = existingEntry
    ? [
        ...deletedEntries,
        createDeletedLessonPlanEntry(
          existingEntry,
          deletedEntry.classListId,
          restoreDate,
          classLists,
          'replaced'
        )
      ]
    : deletedEntries;
  const withRestoredEntry = setPlannerEntryForClassDate(
    snapshot,
    deletedEntry.classListId,
    restoreDate,
    copyLessonPlanEntry(deletedEntry)
  );

  return {
    ...setPlannerDateForList(withRestoredEntry, deletedEntry.classListId, restoreDate),
    deletedEntries: nextDeletedEntries
  };
}

export function getPlannerWeekStartDateKey(dateKey: string) {
  return getLessonPlanExportWeekRange(dateKey).start;
}

export function getPlannerWeekYear(weekStartDate: string) {
  return parseDateKey(weekStartDate)?.year ?? new Date().getFullYear();
}

export function getPlannerWeekDatesByDay(weekStartDate: string): Record<BellScheduleDayKey, string> {
  return BELL_SCHEDULE_DAY_KEYS.reduce(
    (result, dayKey, index) => ({
      ...result,
      [dayKey]: shiftDateKey(weekStartDate, index)
    }),
    {} as Record<BellScheduleDayKey, string>
  );
}

export function formatPlannerWeekDayLabel(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return dateKey;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short'
  }).format(new Date(parsed.year, parsed.monthIndex, parsed.day));
}

export function formatPlannerWeekRangeLabel(weekStartDate: string) {
  const weekEndDate = shiftDateKey(weekStartDate, 4);
  const startParsed = parseDateKey(weekStartDate);
  const endParsed = parseDateKey(weekEndDate);

  if (!startParsed || !endParsed) {
    return `${weekStartDate} - ${weekEndDate}`;
  }

  const startDate = new Date(startParsed.year, startParsed.monthIndex, startParsed.day);
  const endDate = new Date(endParsed.year, endParsed.monthIndex, endParsed.day);
  const startLabel = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short'
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(endDate);

  return `${startLabel} - ${endLabel}`;
}

export function formatPlannerWeekSelectorRange(weekStartDate: string) {
  return formatPlannerWeekRangeLabel(weekStartDate).replace(/\s+/g, ' ');
}

export function getPlannerWeekSelectorYears(
  weekStartDate: string,
  entries: LessonPlansPdfEntry[],
  deletedEntries: DeletedLessonPlanEntry[]
) {
  const currentYear = new Date().getFullYear();
  const years = new Set<number>([
    currentYear - 1,
    currentYear,
    currentYear + 1,
    getPlannerWeekYear(weekStartDate),
    ...entries.map((entry) => entry.year),
    ...deletedEntries
      .map((entry) => parseDateKey(entry.dateKey)?.year)
      .filter((year): year is number => typeof year === 'number')
  ]);

  return Array.from(years).sort((left, right) => left - right);
}

export function buildPlannerWeekSelectorOptions(year: number, selectedWeekStart: string) {
  const groups = SCHOOL_TERMS.map((schoolTerm) => {
    const termStart = formatDateKey(year, schoolTerm.start.monthIndex, schoolTerm.start.day);
    const termEnd = formatDateKey(year, schoolTerm.end.monthIndex, schoolTerm.end.day);
    const termDays = Math.max(getDaysUntilDateKey(termStart, termEnd) + 1, 1);
    const weekCount = Math.ceil(termDays / 7);

    return {
      label: `Term ${schoolTerm.term}`,
      options: Array.from({ length: weekCount }, (_value, index) => {
        const weekStartDate = getPlannerWeekStartDateKey(shiftDateKey(termStart, index * 7));

        return {
          label: `Week ${index + 1}: ${formatPlannerWeekSelectorRange(weekStartDate)}`,
          value: weekStartDate
        };
      })
    };
  });
  const optionValues = new Set(groups.flatMap((group) => group.options.map((option) => option.value)));

  if (getPlannerWeekYear(selectedWeekStart) === year && !optionValues.has(selectedWeekStart)) {
    return [
      {
        label: 'Selected week',
        options: [
          {
            label: `Week of ${formatPlannerWeekSelectorRange(selectedWeekStart)}`,
            value: selectedWeekStart
          }
        ]
      },
      ...groups
    ];
  }

  return groups;
}

export function buildPlannerWeekLessonBlocks({
  getEntryForClassDate,
  weekDatesByDay,
  weekTimelineByDay
}: {
  getEntryForClassDate: (classListId: string, dateKey: string) => LessonPlanEntry | null;
  weekDatesByDay: Record<BellScheduleDayKey, string>;
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>;
}) {
  return BELL_SCHEDULE_DAY_KEYS.flatMap((dayKey) => {
    const dateKey = weekDatesByDay[dayKey];

    return weekTimelineByDay[dayKey]
      .filter((entry) => entry.status === 'teaching' && entry.classList)
      .map((entry) => {
        const classList = entry.classList as ClassList;
        const plannerEntry = getEntryForClassDate(classList.id, dateKey);

        return {
          classListId: classList.id,
          className: classList.name,
          dateKey,
          dayKey,
          documentCount: plannerEntry?.documents.length ?? 0,
          endMinutes: entry.definition.endMinutes,
          hasContent: Boolean(plannerEntry?.plan.trim() || plannerEntry?.documents.length),
          id: `${dayKey}-${entry.definition.id}-${classList.id}`,
          plan: plannerEntry?.plan ?? '',
          slotLabel: entry.definition.label,
          slotShortLabel: entry.definition.shortLabel,
          startMinutes: entry.definition.startMinutes
        } satisfies PlannerWeekLessonBlock;
      });
  });
}

export function buildPlannerWeekScheduleBlocks(
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>
) {
  return BELL_SCHEDULE_DAY_KEYS.flatMap((dayKey) =>
    weekTimelineByDay[dayKey]
      .slice()
      .sort((left, right) => {
        const startDelta = left.definition.startMinutes - right.definition.startMinutes;
        return startDelta !== 0 ? startDelta : left.definition.endMinutes - right.definition.endMinutes;
      })
      .map((entry) => {
        const status =
          entry.status === 'teaching' && !entry.classList
            ? 'unassigned'
            : entry.status;

        return {
          dayKey,
          endMinutes: entry.definition.endMinutes,
          id: `${dayKey}-${entry.definition.id}-schedule`,
          label: entry.definition.label,
          shortLabel: entry.definition.shortLabel,
          startMinutes: entry.definition.startMinutes,
          status
        } satisfies PlannerWeekScheduleBlock;
      })
  );
}

export function getPlannerWeekTimeRange(weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>) {
  const definitions = BELL_SCHEDULE_DAY_KEYS.flatMap((dayKey) =>
    weekTimelineByDay[dayKey].map((entry) => entry.definition)
  );
  const fallbackStart = BELL_SCHEDULE_SLOT_DEFINITIONS[0]?.startMinutes ?? 8 * 60;
  const fallbackEnd = BELL_SCHEDULE_SLOT_DEFINITIONS.at(-1)?.endMinutes ?? 15 * 60;
  const startMinutes = definitions.length
    ? Math.min(...definitions.map((definition) => definition.startMinutes))
    : fallbackStart;
  const endMinutes = definitions.length
    ? Math.max(...definitions.map((definition) => definition.endMinutes))
    : fallbackEnd;

  return {
    endMinutes: Math.max(endMinutes, startMinutes + 60),
    startMinutes
  };
}

export function getPlannerWeekTimeMarks(
  timeRange: Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>,
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>
) {
  const boundaryMarks = new Set<number>([timeRange.startMinutes, timeRange.endMinutes]);

  BELL_SCHEDULE_DAY_KEYS.forEach((dayKey) => {
    weekTimelineByDay[dayKey].forEach((entry) => {
      boundaryMarks.add(entry.definition.startMinutes);
      boundaryMarks.add(entry.definition.endMinutes);
    });
  });

  return Array.from(boundaryMarks)
    .filter((mark) => mark >= timeRange.startMinutes && mark <= timeRange.endMinutes)
    .sort((left, right) => left - right);
}

export function getPlannerWeekOffsetPercent(
  minutes: number,
  timeRange: Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>
) {
  const duration = Math.max(timeRange.endMinutes - timeRange.startMinutes, 1);
  return clampNumber(((minutes - timeRange.startMinutes) / duration) * 100, 0, 100);
}

export function getPlannerWeekTimeMarkStyle(
  minutes: number,
  timeRange: Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>
) {
  return {
    '--planner-week-line-top': `${getPlannerWeekOffsetPercent(minutes, timeRange)}%`
  } as CSSProperties;
}

export function getPlannerWeekTimedBlockStyle(
  block: Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>,
  timeRange: Pick<BellScheduleSlotDefinition, 'endMinutes' | 'startMinutes'>
) {
  const top = getPlannerWeekOffsetPercent(block.startMinutes, timeRange);
  const bottom = getPlannerWeekOffsetPercent(block.endMinutes, timeRange);
  const availableHeight = Math.max(100 - top, 0);
  const blockHeight = clampNumber(bottom - top, 0, availableHeight);

  return {
    '--planner-week-block-height': `${blockHeight}%`,
    '--planner-week-block-top': `${top}%`
  } as CSSProperties;
}

export function formatDeletedLessonPlanTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short'
  }).format(new Date(timestamp));
}

export function getPlannerSelectedDate(snapshot: PlannerSnapshot, listId: string | null) {
  return snapshot.activeDateByListId[getDashboardLayoutKey(listId)] ?? getTodayDateKey();
}

export function getPlannerEntry(snapshot: PlannerSnapshot, listId: string | null, dateKey: string) {
  const normalizedDate = normalizeDateKey(dateKey);
  if (!normalizedDate) {
    return null;
  }

  return snapshot.entriesByListId[getDashboardLayoutKey(listId)]?.[normalizedDate] ?? null;
}

export function getPlannerEntriesForClassLists(snapshot: PlannerSnapshot, classLists: ClassList[]): LessonPlansPdfEntry[] {
  return classLists
    .flatMap((classList) => {
      const entriesForList = snapshot.entriesByListId[getDashboardLayoutKey(classList.id)] ?? {};

      return Object.entries(entriesForList).map(([dateKey, entry]) => {
        const parsed = parseDateKey(dateKey);
        const termSelection = getLessonPlanExportSchoolTermSelection(dateKey);
        const termLabel = termSelection
          ? `Term ${termSelection.term}, ${termSelection.year}`
          : parsed
            ? `School holidays, ${parsed.year}`
            : 'School holidays';
        const weekLabel = termSelection
          ? `Term ${termSelection.term}, Week ${termSelection.week}, ${termSelection.year}`
          : termLabel;

        return {
          classListId: classList.id,
          className: classList.name,
          dateKey,
          dateLabel: formatLessonPlanExportDate(dateKey),
          documentNames: entry.documents.map((document) => document.name),
          plan: entry.plan,
          schoolTerm: termSelection?.term ?? null,
          schoolWeek: termSelection?.week ?? null,
          termLabel,
          weekLabel,
          year: parsed?.year ?? new Date().getFullYear()
        } satisfies LessonPlansPdfEntry;
      });
    })
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

export function setPlannerDateForList(snapshot: PlannerSnapshot, listId: string | null, dateKey: string) {
  const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();

  return {
    ...snapshot,
    activeDateByListId: {
      ...snapshot.activeDateByListId,
      [getDashboardLayoutKey(listId)]: normalizedDate
    }
  };
}

export function updatePlannerEntry(
  snapshot: PlannerSnapshot,
  listId: string | null,
  dateKey: string,
  updater: (entry: LessonPlanEntry) => LessonPlanEntry
) {
  const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();
  const listKey = getDashboardLayoutKey(listId);
  const currentEntry = snapshot.entriesByListId[listKey]?.[normalizedDate] ?? {
    carryOver: false,
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

export function normalizePlannerSnapshot(raw: unknown, initialValue: PlannerSnapshot) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    activeDateByListId?: Record<string, unknown>;
    confirmLessonPlanMoves?: unknown;
    deletedEntries?: unknown[];
    entriesByListId?: Record<string, Record<string, unknown>>;
    templates?: unknown[];
  };
  const activeDateByListId: Record<string, string> = {};
  const entriesByListId: Record<string, Record<string, LessonPlanEntry>> = {};
  const deletedEntries = Array.isArray(nextRaw.deletedEntries)
    ? nextRaw.deletedEntries
        .map((entry) => normalizeDeletedLessonPlanEntry(entry))
        .filter((entry): entry is DeletedLessonPlanEntry => entry !== null)
    : [];

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
    confirmLessonPlanMoves:
      typeof nextRaw.confirmLessonPlanMoves === 'boolean'
        ? nextRaw.confirmLessonPlanMoves
        : initialValue.confirmLessonPlanMoves,
    deletedEntries,
    entriesByListId,
    templates: Array.isArray(nextRaw.templates)
      ? nextRaw.templates
          .map((template) => normalizeLessonPlanTemplate(template))
          .filter((template): template is LessonPlanTemplate => template !== null)
          .slice(0, PLANNER_TEMPLATE_LIMIT)
      : []
  };
}

export function normalizeLessonPlanEntry(raw: unknown): LessonPlanEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    carryOver?: unknown;
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
    carryOver: nextRaw.carryOver === true,
    documents,
    plan,
    updatedAt
  };
}

export function normalizeLessonPlanTemplate(raw: unknown): LessonPlanTemplate | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    createdAt?: unknown;
    id?: unknown;
    name?: unknown;
    plan?: unknown;
  };

  if (
    typeof nextRaw.id !== 'string' ||
    !nextRaw.id.trim() ||
    typeof nextRaw.plan !== 'string' ||
    !nextRaw.plan.trim()
  ) {
    return null;
  }

  return {
    createdAt:
      typeof nextRaw.createdAt === 'number' && Number.isFinite(nextRaw.createdAt)
        ? nextRaw.createdAt
        : Date.now(),
    id: nextRaw.id,
    name:
      typeof nextRaw.name === 'string' && nextRaw.name.trim()
        ? nextRaw.name.trim()
        : 'Untitled template',
    plan: nextRaw.plan
  };
}

export function normalizeDeletedLessonPlanEntry(raw: unknown): DeletedLessonPlanEntry | null {
  const entry = normalizeLessonPlanEntry(raw);

  if (!entry || !raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    classListId?: unknown;
    className?: unknown;
    dateKey?: unknown;
    deletedAt?: unknown;
    id?: unknown;
    reason?: unknown;
  };
  const classListId = typeof nextRaw.classListId === 'string' ? nextRaw.classListId.trim() : '';
  const className = typeof nextRaw.className === 'string' ? nextRaw.className.trim() : '';
  const dateKey = typeof nextRaw.dateKey === 'string' ? normalizeDateKey(nextRaw.dateKey) : null;
  const id = typeof nextRaw.id === 'string' ? nextRaw.id.trim() : '';

  if (!classListId || !dateKey || !id) {
    return null;
  }

  return {
    ...entry,
    classListId,
    className: className || 'Class not set',
    dateKey,
    deletedAt:
      typeof nextRaw.deletedAt === 'number' && Number.isFinite(nextRaw.deletedAt)
        ? nextRaw.deletedAt
        : Date.now(),
    id,
    reason: nextRaw.reason === 'replaced' ? 'replaced' : 'deleted'
  };
}

export function normalizePlannerDocument(raw: unknown): PlannerDocument | null {
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

export function mergeLessonDocuments(
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

export function getFilenameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}
