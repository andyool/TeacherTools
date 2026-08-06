import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { LessonDocumentSelection, LessonPlansPdfEntry, LessonPlansPdfExportOptions } from '../electron-types';
import { useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { formatDateKey, formatLongDate, getDaysUntilDateKey, getMinutesSinceMidnight, getTodayDateKey, normalizeDateKey, parseDateKey, shiftDateKey } from '../shared/dates';
import { usePersistentState } from '../shared/persistence';
import { showUndoToast, useToday, WidgetDialog } from '../shared/uiKit';
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
  /** Session-only decoration set by the controller when opening the file failed. Never persisted. */
  missing?: boolean;
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
  /** Bell-schedule slot the entry was keyed to, or null for the date-level entry. */
  slotId: string | null;
};

export type SchoolTermDefinition = {
  endDateKey: string;
  number: number;
  startDateKey: string;
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
  /** Keys are either a plain date key or `dateKey#slotId` for slot-keyed plans. */
  entriesByListId: Record<string, Record<string, LessonPlanEntry>>;
  schoolTerms: SchoolTermDefinition[];
  schoolTermsEnabled: boolean;
  templates: LessonPlanTemplate[];
};

export type PlannerPopoutMode = 'editor' | 'week';

export type PlannerSurface = 'dashboard' | 'popout';

export type PlannerLessonMoveRequest = {
  classListId: string;
  sourceDateKey: string;
  /** Slot id the source entry is actually keyed to (null = date-level entry). */
  sourceEntrySlotId?: string | null;
  sourceSlotLabel: string;
  targetDateKey: string;
  /** Bell-schedule slot the plan is dropped on; the moved entry becomes slot-keyed. */
  targetSlotId?: string | null;
  targetSlotLabel: string;
};

export type PlannerWeekLessonBlock = {
  classListId: string;
  className: string;
  dateKey: string;
  dayKey: BellScheduleDayKey;
  documentCount: number;
  endMinutes: number;
  /** Slot id of the entry the block resolved to (null = date-level entry). */
  entrySlotId: string | null;
  hasContent: boolean;
  id: string;
  plan: string;
  slotId: string;
  slotLabel: string;
  slotShortLabel: string;
  startMinutes: number;
};

export type PlannerCopyForwardChoice = {
  description: string;
  id: string;
  label: string;
  targetDateKeys: string[];
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

const DEFAULT_SCHOOL_TERM_SEEDS = [
  { end: { day: 2, monthIndex: 3 }, start: { day: 2, monthIndex: 1 }, term: 1 },
  { end: { day: 3, monthIndex: 6 }, start: { day: 20, monthIndex: 3 }, term: 2 },
  { end: { day: 25, monthIndex: 8 }, start: { day: 20, monthIndex: 6 }, term: 3 },
  { end: { day: 17, monthIndex: 11 }, start: { day: 12, monthIndex: 9 }, term: 4 }
] as const;

export function buildDefaultSchoolTermDates(year = new Date().getFullYear()): SchoolTermDefinition[] {
  return DEFAULT_SCHOOL_TERM_SEEDS.map((seed) => ({
    endDateKey: formatDateKey(year, seed.end.monthIndex, seed.end.day),
    number: seed.term,
    startDateKey: formatDateKey(year, seed.start.monthIndex, seed.start.day)
  }));
}

export const DEFAULT_PLANNER: PlannerSnapshot = {
  activeDateByListId: {},
  confirmLessonPlanMoves: true,
  deletedEntries: [],
  entriesByListId: {},
  schoolTerms: buildDefaultSchoolTermDates(),
  schoolTermsEnabled: true,
  templates: []
};

export const PLANNER_TEMPLATE_LIMIT = 50;

export const PLANNER_DELETED_ENTRY_LIMIT = 100;

export const PLANNER_CARRY_OVER_MAX_AGE_DAYS = 14;

/**
 * Module-level mirror of the configured terms so date-label helpers keep their
 * argument-free signatures (TeacherPopover calls formatSchoolDateLabel(date)
 * directly). Synced by usePlannerState on every render of a planner window.
 */
let activeSchoolTermsCache: SchoolTermDefinition[] = DEFAULT_PLANNER.schoolTerms;

export function getActiveSchoolTerms() {
  return activeSchoolTermsCache;
}

export function syncActiveSchoolTerms(snapshot: Pick<PlannerSnapshot, 'schoolTerms' | 'schoolTermsEnabled'>) {
  activeSchoolTermsCache = snapshot.schoolTermsEnabled ? snapshot.schoolTerms : [];
}

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
  onUpdate?: (templateId: string, name: string, plan: string) => void;
};

export type PlannerCopyForwardProps = {
  choices: PlannerCopyForwardChoice[];
  onCopy: (choiceId: string) => void;
};

export function PlannerWidgetContent({
  carryOver,
  classLists,
  copyForward,
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
  copyForward?: PlannerCopyForwardProps;
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
  const [isCopyMenuOpen, setIsCopyMenuOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');

  // The textarea edits a local draft committed on blur / 500ms idle so every
  // keystroke does not rewrite the persisted snapshot.
  const [planDraft, setPlanDraft] = useState(planText);
  const planDraftDirtyRef = useRef(false);
  const planCommitTimeoutRef = useRef<number | null>(null);
  const onUpdatePlanRef = useRef(onUpdatePlan);
  onUpdatePlanRef.current = onUpdatePlan;
  const planDraftRef = useRef(planDraft);
  planDraftRef.current = planDraft;

  const commitPlanDraft = () => {
    if (planCommitTimeoutRef.current !== null) {
      window.clearTimeout(planCommitTimeoutRef.current);
      planCommitTimeoutRef.current = null;
    }

    if (!planDraftDirtyRef.current) {
      return;
    }

    planDraftDirtyRef.current = false;
    onUpdatePlanRef.current(planDraftRef.current);
  };

  const editPlanDraft = (nextDraft: string) => {
    planDraftDirtyRef.current = true;
    setPlanDraft(nextDraft);

    if (planCommitTimeoutRef.current !== null) {
      window.clearTimeout(planCommitTimeoutRef.current);
    }
    planCommitTimeoutRef.current = window.setTimeout(commitPlanDraft, 500);
  };

  // Adopt outside changes (template insert, carry-over accept, date/class
  // switches) whenever there is no pending local edit.
  useEffect(() => {
    if (!planDraftDirtyRef.current) {
      setPlanDraft(planText);
    }
  }, [planText]);

  useEffect(() => {
    planDraftDirtyRef.current = false;
    if (planCommitTimeoutRef.current !== null) {
      window.clearTimeout(planCommitTimeoutRef.current);
      planCommitTimeoutRef.current = null;
    }
    setPlanDraft(planText);
    // Reset the draft only when the lesson identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedList?.id]);

  useEffect(
    () => () => {
      if (planCommitTimeoutRef.current !== null) {
        window.clearTimeout(planCommitTimeoutRef.current);
      }
      if (planDraftDirtyRef.current) {
        planDraftDirtyRef.current = false;
        onUpdatePlanRef.current(planDraftRef.current);
      }
    },
    []
  );

  const hasPlanContent = Boolean(planDraft.trim() || documents.length > 0);

  useEffect(() => {
    if (!selectedList) {
      setIsExportDialogOpen(false);
      setIsTemplatesDialogOpen(false);
      setIsCopyMenuOpen(false);
    }
  }, [selectedList]);

  useEffect(() => {
    if (!isCopyMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.planner-copy-menu')) {
        setIsCopyMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCopyMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCopyMenuOpen]);

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
  }, [planDraft, selectedList]);

  const helperCopy = !selectedList
    ? 'Choose a class first, then save lesson plans and documents by date.'
    : null;
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
            {copyForward && copyForward.choices.length > 0 ? (
              <div className="planner-copy-menu">
                <button
                  aria-expanded={isCopyMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Copy this lesson plan forward"
                  className="secondary-link button-tone--utility planner-widget__action-button"
                  data-compact-icon="→"
                  disabled={!selectedList || !hasPlanContent}
                  onClick={() => setIsCopyMenuOpen((current) => !current)}
                  type="button"
                >
                  <span className="planner-widget__action-label">Copy forward</span>
                </button>
                {isCopyMenuOpen ? (
                  <div className="planner-copy-menu__list" role="menu">
                    {copyForward.choices.map((choice) => (
                      <button
                        className="planner-copy-menu__item"
                        key={choice.id}
                        onClick={() => {
                          setIsCopyMenuOpen(false);
                          copyForward.onCopy(choice.id);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span>{choice.label}</span>
                        <small>{choice.description}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : onCopyForward ? (
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

        {helperCopy || statusMessage ? (
          <div className="planner-widget__copy">
            {helperCopy ? (
              <div className="planner-widget__copy-row">
                <p className="helper-text">{helperCopy}</p>
              </div>
            ) : null}
            {statusMessage ? (
              <p className="helper-text helper-text--accent">{statusMessage}</p>
            ) : null}
          </div>
        ) : null}

        {carryOver?.offer ? (
          <div className="planner-widget__carry-offer">
            <span className="helper-text">
              Unfinished plan from {formatLongDate(carryOver.offer.dateKey)}.
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
          <textarea
            aria-label="Lesson plan"
            className="text-area text-area--planner"
            disabled={!selectedList}
            id="lesson-plan-text"
            onBlur={commitPlanDraft}
            onChange={(event) => editPlanDraft(event.target.value)}
            placeholder="Outline your lesson, activities, reminders, and follow-up."
            ref={planTextareaRef}
            value={planDraft}
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
              <span>Carry over if unfinished</span>
            </label>
          ) : null}
        </div>

        <div className="planner-documents">
          <div className="planner-documents__header">
            <div className="planner-documents__header-copy">
              <span className="field-label">Documents</span>
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
              {documents.map((document) => {
                const secondaryLabel = getPlannerDocumentSecondaryLabel(document);

                return (
                  <article
                    className={`planner-document${document.missing ? ' planner-document--missing' : ''}`}
                    key={document.id}
                  >
                    <button
                      className="planner-document__open"
                      data-tooltip-content={
                        isPlannerLinkDocument(document) ? document.path : document.name
                      }
                      onClick={() => void onOpenDocument(document)}
                      type="button"
                    >
                      <span className="planner-document__name-row">
                        <span className="planner-document__name">
                          {isPlannerLinkDocument(document) ? '↗ ' : ''}
                          {getPlannerDocumentDisplayName(document)}
                        </span>
                        {document.missing ? (
                          <span className="planner-document__missing">Missing</span>
                        ) : null}
                      </span>
                      {secondaryLabel ? (
                        <span className="planner-document__path">{secondaryLabel}</span>
                      ) : null}
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
                );
              })}
            </div>
          ) : (
            <div className="group-maker__empty">
              <p className="empty-copy">No documents yet.</p>
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
          canSaveCurrentPlan={Boolean(planDraft.trim())}
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
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingNameDraft, setEditingNameDraft] = useState('');
  const [editingPlanDraft, setEditingPlanDraft] = useState('');
  const editingTemplate = editingTemplateId
    ? templates.entries.find((template) => template.id === editingTemplateId) ?? null
    : null;

  const beginEditingTemplate = (template: LessonPlanTemplate) => {
    setEditingTemplateId(template.id);
    setEditingNameDraft(template.name);
    setEditingPlanDraft(template.plan);
  };

  const stopEditingTemplate = () => {
    setEditingTemplateId(null);
    setEditingNameDraft('');
    setEditingPlanDraft('');
  };

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

          {editingTemplate ? (
            <div className="lesson-templates-dialog__edit">
              <input
                aria-label="Template name"
                className="text-field"
                onChange={(event) => setEditingNameDraft(event.target.value)}
                placeholder="Template name"
                type="text"
                value={editingNameDraft}
              />
              <textarea
                aria-label="Template plan"
                className="text-area lesson-templates-dialog__edit-plan"
                onChange={(event) => setEditingPlanDraft(event.target.value)}
                value={editingPlanDraft}
              />
              <div className="lesson-templates-dialog__edit-actions">
                <button
                  className="secondary-link button-tone--utility"
                  onClick={stopEditingTemplate}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary-link"
                  disabled={!editingPlanDraft.trim()}
                  onClick={() => {
                    templates.onUpdate?.(editingTemplate.id, editingNameDraft, editingPlanDraft);
                    stopEditingTemplate();
                  }}
                  type="button"
                >
                  Save changes
                </button>
              </div>
            </div>
          ) : (
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
          )}

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
                    {templates.onUpdate ? (
                      <button
                        aria-label={`Edit template ${template.name}`}
                        className="secondary-link button-tone--utility"
                        onClick={() => beginEditingTemplate(template)}
                        type="button"
                      >
                        Edit
                      </button>
                    ) : null}
                    <button
                      aria-label={`Delete template ${template.name}`}
                      className="danger-link"
                      onClick={() => {
                        if (editingTemplateId === template.id) {
                          stopEditingTemplate();
                        }
                        templates.onDelete(template.id);
                      }}
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
  const configuredTerms = getActiveSchoolTerms();
  const hasConfiguredTerms = configuredTerms.length > 0;
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
  const [selectedTerm, setSelectedTerm] = useState<number>(
    currentTermSelection?.term ?? configuredTerms[0]?.number ?? 1
  );
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
  const [groupByAutoNote, setGroupByAutoNote] = useState<string | null>(null);
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
                  {hasConfiguredTerms ? (
                    <>
                      <option value="this-term">This term</option>
                      <option value="term">Only one term</option>
                      <option value="exclude-term">Everything except one term</option>
                      <option value="term-week">A term week</option>
                    </>
                  ) : null}
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
                      {(hasConfiguredTerms ? configuredTerms.map((term) => term.number) : [1, 2, 3, 4]).map(
                        (term) => (
                          <option key={term} value={term}>
                            Term {term}
                          </option>
                        )
                      )}
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
                  onChange={(event) => {
                    setGroupBy(event.target.value as LessonPlansPdfExportOptions['groupBy']);
                    setGroupByAutoNote(null);
                  }}
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

                    // Only adjust the grouping when it is actually incompatible
                    // with the requested page breaks, and say so visibly.
                    if (isLessonPlanExportGroupingCompatible(groupBy, nextPageBreak)) {
                      setGroupByAutoNote(null);
                      return;
                    }

                    const adjustedGroupBy =
                      nextPageBreak === 'class' || nextPageBreak === 'term' || nextPageBreak === 'week'
                        ? nextPageBreak
                        : groupBy;
                    setGroupBy(adjustedGroupBy);
                    setGroupByAutoNote(
                      `Grouping switched to “${LESSON_PLAN_EXPORT_GROUP_LABELS[adjustedGroupBy]}” to match the page breaks.`
                    );
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

            {groupByAutoNote ? (
              <p className="helper-text lesson-plan-export-dialog__group-note">{groupByAutoNote}</p>
            ) : null}

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
              filteredEntries.map((entry, entryIndex) => (
                <article className="lesson-plan-export-dialog__entry" key={`${entry.classListId}-${entry.dateKey}-${entryIndex}`} role="listitem">
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
  const [isTermDatesDialogOpen, setIsTermDatesDialogOpen] = useState(false);
  const todayKey = useToday();
  const [nowMinutes, setNowMinutes] = useState(() => getMinutesSinceMidnight(new Date()));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMinutes(getMinutesSinceMidnight(new Date()));
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);
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
  const effectiveSchoolTerms = useMemo(
    () => (planner.schoolTermsEnabled ? planner.schoolTerms : []),
    [planner.schoolTerms, planner.schoolTermsEnabled]
  );
  const weekOptions = useMemo(
    () => buildPlannerWeekSelectorOptions(weekYear, weekStartDate, effectiveSchoolTerms),
    [effectiveSchoolTerms, weekStartDate, weekYear]
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
        resolveEntryForClassDateSlot: planner.resolveEntryForClassDateSlot,
        weekDatesByDay,
        weekTimelineByDay: bellSchedule.weekTimelineByDay
      }),
    [bellSchedule.weekTimelineByDay, planner.resolveEntryForClassDateSlot, weekDatesByDay]
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
      sourceEntrySlotId: sourceBlock.entrySlotId,
      sourceSlotLabel: `${sourceBlock.slotLabel}, ${formatLongDate(sourceBlock.dateKey)}`,
      targetDateKey: targetBlock.dateKey,
      targetSlotId: targetBlock.slotId,
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
                  const nextWeek = buildPlannerWeekSelectorOptions(nextYear, weekStartDate, effectiveSchoolTerms)[0]
                    ?.options[0];
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
              <span className="field-label">{effectiveSchoolTerms.length > 0 ? 'Term week' : 'Week'}</span>
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
              aria-haspopup="dialog"
              aria-label="Edit school term dates"
              className="secondary-link button-tone--utility"
              onClick={() => setIsTermDatesDialogOpen(true)}
              type="button"
            >
              Term dates
            </button>
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
              const isToday = weekDatesByDay[dayKey] === todayKey;
              const showNowLine =
                isToday &&
                nowMinutes >= timeRange.startMinutes &&
                nowMinutes <= timeRange.endMinutes;

              return (
                <section
                  className={`planner-week__day${isToday ? ' planner-week__day--today' : ''}`}
                  key={dayKey}
                >
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
                    {showNowLine ? (
                      <span
                        aria-hidden="true"
                        className="planner-week__now-line"
                        style={getPlannerWeekTimeMarkStyle(nowMinutes, timeRange)}
                      />
                    ) : null}
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
                                  planner.deleteLessonPlan(block.classListId, block.dateKey, block.entrySlotId);
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

      {isTermDatesDialogOpen ? (
        <SchoolTermDatesDialog
          enabled={planner.schoolTermsEnabled}
          onClose={() => setIsTermDatesDialogOpen(false)}
          onSave={(configuration) => {
            planner.setSchoolTermConfiguration(configuration);
            setIsTermDatesDialogOpen(false);
          }}
          terms={planner.schoolTerms}
        />
      ) : null}
    </>
  );
}

export function SchoolTermDatesDialog({
  enabled,
  onClose,
  onSave,
  terms
}: {
  enabled: boolean;
  onClose: () => void;
  onSave: (configuration: { enabled: boolean; terms: SchoolTermDefinition[] }) => void;
  terms: SchoolTermDefinition[];
}) {
  const { theme } = useColorModeAppearance();
  const [termsDisabled, setTermsDisabled] = useState(!enabled);
  const [termDrafts, setTermDrafts] = useState<Array<{ endDateKey: string; startDateKey: string }>>(
    () =>
      (terms.length > 0 ? terms : buildDefaultSchoolTermDates()).map((term) => ({
        endDateKey: term.endDateKey,
        startDateKey: term.startDateKey
      }))
  );
  const hasInvalidDraft =
    !termsDisabled &&
    termDrafts.some(
      (draft) => !normalizeDateKey(draft.startDateKey) || !normalizeDateKey(draft.endDateKey)
    );

  const updateDraft = (index: number, field: 'endDateKey' | 'startDateKey', value: string) => {
    setTermDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, [field]: value } : draft
      )
    );
  };

  const submit = () => {
    if (hasInvalidDraft) {
      return;
    }

    onSave({
      enabled: !termsDisabled,
      terms: termDrafts.map((draft, index) => ({
        endDateKey: normalizeDateKey(draft.endDateKey) ?? draft.endDateKey,
        number: index + 1,
        startDateKey: normalizeDateKey(draft.startDateKey) ?? draft.startDateKey
      }))
    });
  };

  return (
    <WidgetDialog
      className="school-terms-dialog"
      kicker="School calendar"
      onClose={onClose}
      theme={theme}
      title="Term dates"
    >
      <p className="helper-text">
        Terms repeat every year. Week labels, the week selector, and PDF exports follow these dates.
      </p>

      <label className="lesson-plan-export-dialog__toggle school-terms-dialog__disable-toggle">
        <input
          checked={termsDisabled}
          onChange={(event) => setTermsDisabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>No terms — use plain dates</span>
      </label>

      {!termsDisabled ? (
        <div className="school-terms-dialog__rows">
          {termDrafts.map((draft, index) => (
            <div className="school-terms-dialog__row" key={`school-term-${index}`}>
              <span className="school-terms-dialog__row-label">Term {index + 1}</span>
              <label className="field-stack">
                <span className="field-label">Starts</span>
                <input
                  aria-label={`Term ${index + 1} start date`}
                  className="text-field"
                  onChange={(event) => updateDraft(index, 'startDateKey', event.target.value)}
                  type="date"
                  value={draft.startDateKey}
                />
              </label>
              <label className="field-stack">
                <span className="field-label">Ends</span>
                <input
                  aria-label={`Term ${index + 1} end date`}
                  className="text-field"
                  onChange={(event) => updateDraft(index, 'endDateKey', event.target.value)}
                  type="date"
                  value={draft.endDateKey}
                />
              </label>
              <button
                aria-label={`Remove term ${index + 1}`}
                className="note-row__delete school-terms-dialog__remove"
                disabled={termDrafts.length <= 1}
                onClick={() =>
                  setTermDrafts((current) => current.filter((_draft, draftIndex) => draftIndex !== index))
                }
                type="button"
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="secondary-link button-tone--utility school-terms-dialog__add"
            disabled={termDrafts.length >= 12}
            onClick={() =>
              setTermDrafts((current) => {
                const lastDraft = current.at(-1);
                const lastEnd = lastDraft ? normalizeDateKey(lastDraft.endDateKey) : null;

                return [
                  ...current,
                  {
                    endDateKey: lastEnd ? shiftDateKey(lastEnd, 70) : getTodayDateKey(),
                    startDateKey: lastEnd ? shiftDateKey(lastEnd, 15) : getTodayDateKey()
                  }
                ];
              })
            }
            type="button"
          >
            Add term
          </button>
        </div>
      ) : (
        <p className="helper-text">
          Dates will show as plain dates, and the week selector lists calendar weeks.
        </p>
      )}

      <footer className="planner-week-dialog__actions">
        <button className="secondary-link button-tone--utility" onClick={onClose} type="button">
          Cancel
        </button>
        <button className="primary-link" disabled={hasInvalidDraft} onClick={submit} type="button">
          Save term dates
        </button>
      </footer>
    </WidgetDialog>
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
                      <button
                        aria-label={`Restore ${className} to ${formatLongDate(entry.dateKey)}`}
                        className="primary-link deleted-lesson__restore-original"
                        onClick={() => onRestore(entry.id, entry.dateKey)}
                        type="button"
                      >
                        Restore to original date
                      </button>
                      <div className="deleted-lesson__restore-custom">
                        <label className="field-stack">
                          <span className="field-label">Other date</span>
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
                          className="secondary-link"
                          disabled={!normalizeDateKey(restoreDate)}
                          onClick={() => onRestore(entry.id, restoreDate)}
                          type="button"
                        >
                          Restore
                        </button>
                      </div>
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
  const [popoutMode, setPopoutMode] = usePlannerPopoutModeState('popout');
  const showWeekPlanner = popoutMode === 'week';
  const nextLessonDateKey = selectedList
    ? findNextLessonDateKey(bellSchedule.weekTimelineByDay, selectedList.id, planner.selectedDate)
    : null;
  const copyForwardChoices = useMemo(
    () =>
      selectedList
        ? buildPlannerCopyForwardChoices(
            bellSchedule.weekTimelineByDay,
            selectedList.id,
            planner.selectedDate
          )
        : [],
    [bellSchedule.weekTimelineByDay, planner.selectedDate, selectedList]
  );

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
          copyForward={{
            choices: copyForwardChoices,
            onCopy: (choiceId) => {
              const choice = copyForwardChoices.find((candidate) => candidate.id === choiceId);
              if (choice) {
                planner.copyLessonForwardToDates(choice.targetDateKeys);
              }
            }
          }}
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
            onSave: planner.saveTemplate,
            onUpdate: planner.updateTemplate
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
  const plannerState = usePersistentState<PlannerSnapshot>('teacher-tools.planner', DEFAULT_PLANNER, {
    normalize: normalizePlannerSnapshot
  });

  // Keep the module-level term mirror in sync so argument-free helpers
  // (formatSchoolDateLabel and friends) see the configured terms.
  syncActiveSchoolTerms(plannerState[0]);

  return plannerState;
}

/**
 * Last-used planner view, persisted per surface. Both surfaces default to the
 * day editor.
 */
export function usePlannerPopoutModeState(surface: PlannerSurface = 'popout') {
  return usePersistentState<PlannerPopoutMode>(
    surface === 'popout'
      ? 'teacher-tools.planner-popout-mode'
      : 'teacher-tools.planner-dashboard-mode',
    'editor',
    {
      normalize: normalizePlannerPopoutMode
    }
  );
}

export function useLessonPlannerController(selectedListId: string | null, classLists: ClassList[]) {
  const [planner, setPlanner] = usePlannerState();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [missingDocumentIds, setMissingDocumentIds] = useState<Record<string, true>>({});
  const selectedDate = getPlannerSelectedDate(planner, selectedListId);
  const entry = getPlannerEntry(planner, selectedListId, selectedDate);
  const storedDocuments = entry?.documents ?? [];
  const documents = storedDocuments.map((document) =>
    missingDocumentIds[document.id] ? { ...document, missing: true } : document
  );
  const plan = entry?.plan ?? '';
  const entryDates = Array.from(
    new Set(
      Object.keys(planner.entriesByListId[getDashboardLayoutKey(selectedListId)] ?? {}).map(
        (entryKey) => parsePlannerEntryKey(entryKey).dateKey
      )
    )
  );
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
    const removedDocument = storedDocuments.find((document) => document.id === documentId) ?? null;
    const removedFromListId = selectedListId;
    const removedFromDate = selectedDate;

    setPlanner((current) =>
      updatePlannerEntry(current, selectedListId, selectedDate, (existing) => ({
        ...existing,
        documents: existing.documents.filter((document) => document.id !== documentId),
        updatedAt: Date.now()
      }))
    );

    if (removedDocument) {
      showUndoToast(`Removed ${getPlannerDocumentDisplayName(removedDocument)}.`, () => {
        setPlanner((current) =>
          updatePlannerEntry(current, removedFromListId, removedFromDate, (existing) => ({
            ...existing,
            documents: existing.documents.some((document) => document.id === removedDocument.id)
              ? existing.documents
              : [...existing.documents, removedDocument],
            updatedAt: Date.now()
          }))
        );
      });
    }
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
      setMissingDocumentIds((current) =>
        current[document.id] ? current : { ...current, [document.id]: true }
      );
      setStatusMessage(`Couldn't open ${document.name}. ${errorMessage}`);
      return;
    }

    setMissingDocumentIds((current) => {
      if (!current[document.id]) {
        return current;
      }

      const next = { ...current };
      delete next[document.id];
      return next;
    });
    setStatusMessage(`Opened ${document.name}.`);
  };

  const moveLessonPlan = (request: PlannerLessonMoveRequest) => {
    const sourceSlotId = request.sourceEntrySlotId ?? null;
    const targetSlotId = request.targetSlotId ?? null;
    const sourceEntry = getPlannerEntryAtKey(
      planner,
      request.classListId,
      request.sourceDateKey,
      sourceSlotId
    );
    const className = getPlannerClassName(request.classListId, classLists);

    if (!sourceEntry) {
      setStatusMessage(`No saved lesson plan to move from ${formatLongDate(request.sourceDateKey)}.`);
      return;
    }

    if (request.sourceDateKey === request.targetDateKey && sourceSlotId === targetSlotId) {
      setStatusMessage(`${className} is already planned for ${formatLongDate(request.targetDateKey)}.`);
      return;
    }

    const targetEntry = getPlannerEntryAtKey(
      planner,
      request.classListId,
      request.targetDateKey,
      targetSlotId
    );

    setPlanner((current) => movePlannerLessonEntry(current, request, classLists));
    setStatusMessage(
      targetEntry
        ? `Moved ${className} to ${formatLongDate(request.targetDateKey)}. The replaced plan is in Deleted plans.`
        : `Moved ${className} to ${formatLongDate(request.targetDateKey)}.`
    );
  };

  const deleteLessonPlan = (classListId: string, dateKey: string, slotId: string | null = null) => {
    const entryToDelete = getPlannerEntryAtKey(planner, classListId, dateKey, slotId);
    const className = getPlannerClassName(classListId, classLists);

    if (!entryToDelete) {
      setStatusMessage(`No saved ${className} plan to delete for ${formatLongDate(dateKey)}.`);
      return;
    }

    setPlanner((current) => deletePlannerLessonEntry(current, classListId, dateKey, classLists, slotId));
    setStatusMessage(`Moved ${className}'s ${formatLongDate(dateKey)} plan to Deleted plans.`);
  };

  const restoreDeletedLessonPlan = (deletedEntryId: string, dateKey: string) => {
    const normalizedDate = normalizeDateKey(dateKey);
    const deletedEntry = planner.deletedEntries.find((candidate) => candidate.id === deletedEntryId);

    if (!normalizedDate || !deletedEntry) {
      return;
    }

    // Restoring to the original date puts the entry back at its original slot
    // key; restoring anywhere else lands date-level.
    const restoreSlotId = normalizedDate === deletedEntry.dateKey ? deletedEntry.slotId ?? null : null;
    const existingEntry = getPlannerEntryAtKey(
      planner,
      deletedEntry.classListId,
      normalizedDate,
      restoreSlotId
    );

    setPlanner((current) =>
      restoreDeletedPlannerLessonEntry(current, deletedEntryId, normalizedDate, classLists, restoreSlotId)
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

  const copyLessonForwardToDates = (targetDateKeys: string[]) => {
    if (!selectedListId) {
      return;
    }

    const sourceEntry = getPlannerEntry(planner, selectedListId, selectedDate);

    if (!sourceEntry) {
      setStatusMessage('Save a plan or attach documents first, then copy it forward.');
      return;
    }

    const normalizedTargets = Array.from(
      new Set(
        targetDateKeys
          .map((dateKey) => normalizeDateKey(dateKey))
          .filter((dateKey): dateKey is string => Boolean(dateKey) && dateKey !== selectedDate)
      )
    );

    if (normalizedTargets.length === 0) {
      return;
    }

    if (normalizedTargets.length === 1) {
      copyLessonForward(normalizedTargets[0]);
      return;
    }

    setPlanner((current) =>
      normalizedTargets.reduce(
        (snapshot, targetDateKey) =>
          copyPlannerLessonEntry(snapshot, selectedListId, selectedDate, targetDateKey, classLists),
        current
      )
    );
    setStatusMessage(
      `Copied this lesson to ${normalizedTargets.length} dates (${normalizedTargets
        .map((dateKey) => formatLongDate(dateKey))
        .join(', ')}).`
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

  const updateTemplate = (templateId: string, name: string, nextPlan: string) => {
    if (!nextPlan.trim()) {
      return;
    }

    setPlanner((current) => ({
      ...current,
      templates: current.templates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              name: name.trim() || template.name,
              plan: nextPlan
            }
          : template
      )
    }));
    setStatusMessage('Updated the template.');
  };

  const deleteTemplate = (templateId: string) => {
    const removedIndex = planner.templates.findIndex((template) => template.id === templateId);
    const removedTemplate = removedIndex === -1 ? null : planner.templates[removedIndex];

    setPlanner((current) => ({
      ...current,
      templates: current.templates.filter((template) => template.id !== templateId)
    }));

    if (removedTemplate) {
      showUndoToast(`Deleted the “${removedTemplate.name}” template.`, () => {
        setPlanner((current) => {
          if (current.templates.some((template) => template.id === removedTemplate.id)) {
            return current;
          }

          const nextTemplates = [...current.templates];
          nextTemplates.splice(Math.min(removedIndex, nextTemplates.length), 0, removedTemplate);
          return {
            ...current,
            templates: nextTemplates.slice(0, PLANNER_TEMPLATE_LIMIT)
          };
        });
      });
    }
  };

  const setSchoolTermConfiguration = ({
    enabled,
    terms
  }: {
    enabled: boolean;
    terms: SchoolTermDefinition[];
  }) => {
    setPlanner((current) => ({
      ...current,
      schoolTerms: normalizeSchoolTermList(terms) ?? current.schoolTerms,
      schoolTermsEnabled: enabled
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
    copyLessonForwardToDates,
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
    resolveEntryForClassDateSlot: (classListId: string, dateKey: string, slotId: string | null) =>
      resolvePlannerEntryForSlot(planner, classListId, dateKey, slotId),
    restoreDeletedLessonPlan,
    saveTemplate,
    schoolTerms: planner.schoolTerms,
    schoolTermsEnabled: planner.schoolTermsEnabled,
    selectedDate,
    setSchoolTermConfiguration,
    setSelectedDate,
    setSelectedDateForClass,
    setConfirmLessonPlanMoves,
    statusMessage,
    templates: planner.templates,
    toggleCarryOver,
    updatePlan,
    updateTemplate
  };
}

export function normalizePlannerPopoutMode(
  raw: unknown,
  initialValue: PlannerPopoutMode
) {
  return raw === 'editor' || raw === 'week' ? raw : initialValue;
}

/** Legacy hardcoded seeds — configured terms now live in planner state. */
export const SCHOOL_TERMS = DEFAULT_SCHOOL_TERM_SEEDS;

/**
 * Terms recur annually: the stored dates supply the month/day pattern, and a
 * term whose end falls before its start spans the year boundary.
 */
export function projectSchoolTermToYear(term: SchoolTermDefinition, year: number) {
  const start = parseDateKey(term.startDateKey);
  const end = parseDateKey(term.endDateKey);

  if (!start || !end) {
    return null;
  }

  const crossesYearBoundary =
    end.monthIndex < start.monthIndex ||
    (end.monthIndex === start.monthIndex && end.day < start.day);

  return {
    endDateKey: formatDateKey(crossesYearBoundary ? year + 1 : year, end.monthIndex, end.day),
    number: term.number,
    startDateKey: formatDateKey(year, start.monthIndex, start.day)
  };
}

export function getSchoolTermWeek(date: Date, terms: SchoolTermDefinition[] = getActiveSchoolTerms()) {
  const dateKey = formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());

  for (const year of [date.getFullYear() - 1, date.getFullYear()]) {
    for (const schoolTerm of terms) {
      const projected = projectSchoolTermToYear(schoolTerm, year);

      if (!projected || dateKey < projected.startDateKey || dateKey > projected.endDateKey) {
        continue;
      }

      return {
        term: projected.number,
        week: Math.floor(getDaysUntilDateKey(projected.startDateKey, dateKey) / 7) + 1
      };
    }
  }

  return null;
}

export function formatSchoolDateLabel(date: Date, terms: SchoolTermDefinition[] = getActiveSchoolTerms()) {
  const schoolTermWeek = terms.length > 0 ? getSchoolTermWeek(date, terms) : null;

  if (!schoolTermWeek) {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'long',
      weekday: 'long'
    }).format(date);
  }

  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  return `${weekday}, Week ${schoolTermWeek.week}, Term ${schoolTermWeek.term}`;
}

export function normalizeSchoolTermDefinition(raw: unknown): SchoolTermDefinition | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as { endDateKey?: unknown; number?: unknown; startDateKey?: unknown };
  const startDateKey =
    typeof nextRaw.startDateKey === 'string' ? normalizeDateKey(nextRaw.startDateKey) : null;
  const endDateKey =
    typeof nextRaw.endDateKey === 'string' ? normalizeDateKey(nextRaw.endDateKey) : null;

  if (!startDateKey || !endDateKey) {
    return null;
  }

  return {
    endDateKey,
    number:
      typeof nextRaw.number === 'number' && Number.isInteger(nextRaw.number) && nextRaw.number > 0
        ? nextRaw.number
        : 1,
    startDateKey
  };
}

export function normalizeSchoolTermList(raw: unknown): SchoolTermDefinition[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const terms = raw
    .map((term) => normalizeSchoolTermDefinition(term))
    .filter((term): term is SchoolTermDefinition => term !== null)
    .slice(0, 12)
    .map((term, index) => ({ ...term, number: index + 1 }));

  return terms;
}

export const LESSON_PLAN_EXPORT_GROUP_LABELS: Record<
  NonNullable<LessonPlansPdfExportOptions['groupBy']>,
  string
> = {
  class: 'Class',
  date: 'Date',
  term: 'Term',
  week: 'School week'
};

/**
 * Page breaks per class/term/week only make sense when lessons are grouped so
 * those boundaries are contiguous. Term breaks also work with week grouping
 * because week sort order nests inside terms.
 */
export function isLessonPlanExportGroupingCompatible(
  groupBy: LessonPlansPdfExportOptions['groupBy'],
  pageBreak: LessonPlansPdfExportOptions['pageBreak']
) {
  if (pageBreak === 'class') {
    return groupBy === 'class';
  }

  if (pageBreak === 'term') {
    return groupBy === 'term' || groupBy === 'week';
  }

  if (pageBreak === 'week') {
    return groupBy === 'week';
  }

  return true;
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

export function getLessonPlanExportSchoolTermSelection(
  dateKey: string,
  terms: SchoolTermDefinition[] = getActiveSchoolTerms()
) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  const schoolTermWeek = getSchoolTermWeek(new Date(parsed.year, parsed.monthIndex, parsed.day), terms);
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
  reason: DeletedLessonPlanEntry['reason'],
  slotId: string | null = null
): DeletedLessonPlanEntry {
  return {
    ...copyLessonPlanEntry(entry),
    classListId,
    className: getPlannerClassName(classListId, classLists),
    dateKey,
    deletedAt: Date.now(),
    id: `deleted-lesson-plan-${createStickyNoteId()}`,
    reason,
    slotId
  };
}

export function capDeletedLessonPlanEntries(entries: DeletedLessonPlanEntry[]) {
  if (entries.length <= PLANNER_DELETED_ENTRY_LIMIT) {
    return entries;
  }

  return [...entries]
    .sort((left, right) => left.deletedAt - right.deletedAt)
    .slice(-PLANNER_DELETED_ENTRY_LIMIT);
}

export function setPlannerEntryForClassDate(
  snapshot: PlannerSnapshot,
  classListId: string,
  dateKey: string,
  entry: LessonPlanEntry | null,
  slotId: string | null = null
) {
  const normalizedDate = normalizeDateKey(dateKey) ?? getTodayDateKey();
  const entryKey = makePlannerEntryKey(normalizedDate, slotId);
  const listKey = getDashboardLayoutKey(classListId);
  const nextEntriesByListId = { ...snapshot.entriesByListId };
  const nextEntriesForList = { ...(nextEntriesByListId[listKey] ?? {}) };

  if (entry) {
    nextEntriesForList[entryKey] = normalizeLessonPlanEntry(entry) ?? copyLessonPlanEntry(entry);
  } else {
    delete nextEntriesForList[entryKey];
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
  const sourceSlotId = request.sourceEntrySlotId ?? null;
  const targetSlotId = request.targetSlotId ?? null;

  if (!sourceDate || !targetDate || (sourceDate === targetDate && sourceSlotId === targetSlotId)) {
    return snapshot;
  }

  const sourceEntry = getPlannerEntryAtKey(snapshot, request.classListId, sourceDate, sourceSlotId);
  if (!sourceEntry) {
    return snapshot;
  }

  const targetEntry = getPlannerEntryAtKey(snapshot, request.classListId, targetDate, targetSlotId);
  const deletedEntries = targetEntry
    ? capDeletedLessonPlanEntries([
        ...snapshot.deletedEntries,
        createDeletedLessonPlanEntry(
          targetEntry,
          request.classListId,
          targetDate,
          classLists,
          'replaced',
          targetSlotId
        )
      ])
    : snapshot.deletedEntries;
  const withoutSource = setPlannerEntryForClassDate(
    snapshot,
    request.classListId,
    sourceDate,
    null,
    sourceSlotId
  );
  const withTarget = setPlannerEntryForClassDate(
    withoutSource,
    request.classListId,
    targetDate,
    copyLessonPlanEntry(sourceEntry),
    targetSlotId
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
    ? capDeletedLessonPlanEntries([
        ...snapshot.deletedEntries,
        createDeletedLessonPlanEntry(targetEntry, classListId, targetDate, classLists, 'replaced')
      ])
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
    .filter(
      (entryKey) =>
        !entryKey.includes('#') &&
        entryKey < beforeDateKey &&
        entriesForList[entryKey].carryOver &&
        getDaysUntilDateKey(entryKey, beforeDateKey) <= PLANNER_CARRY_OVER_MAX_AGE_DAYS
    )
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

/**
 * Teaching dates for this class after `afterDateKey`, scanning up to two weeks
 * ahead. Unlike findNextLessonDateKey there is no same-weekday fallback.
 */
export function findNextLessonDateKeys(
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>,
  classListId: string,
  afterDateKey: string,
  count: number
) {
  const dateKeys: string[] = [];

  for (let offset = 1; offset <= 14 && dateKeys.length < count; offset += 1) {
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
      dateKeys.push(dateKey);
    }
  }

  return dateKeys;
}

/** Teaching dates for this class strictly after `fromDateKey` within its Mon-Fri week. */
export function getRemainingWeekLessonDateKeys(
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>,
  classListId: string,
  fromDateKey: string
) {
  const weekStartDate = getPlannerWeekStartDateKey(fromDateKey);
  const weekEndDate = shiftDateKey(weekStartDate, 4);

  return findNextLessonDateKeys(weekTimelineByDay, classListId, fromDateKey, 5).filter(
    (dateKey) => dateKey <= weekEndDate
  );
}

export function buildPlannerCopyForwardChoices(
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>,
  classListId: string,
  fromDateKey: string
): PlannerCopyForwardChoice[] {
  const nextTwo = findNextLessonDateKeys(weekTimelineByDay, classListId, fromDateKey, 2);
  const nextLessonDateKey = nextTwo[0] ?? shiftDateKey(fromDateKey, 7);
  const restOfWeek = getRemainingWeekLessonDateKeys(weekTimelineByDay, classListId, fromDateKey);
  const sameDayNextWeek = shiftDateKey(fromDateKey, 7);
  const choices: Array<PlannerCopyForwardChoice | null> = [
    {
      description: formatLongDate(nextLessonDateKey),
      id: 'next-lesson',
      label: 'Next lesson',
      targetDateKeys: [nextLessonDateKey]
    },
    nextTwo.length >= 2
      ? {
          description: `${formatLongDate(nextTwo[0])} + ${formatLongDate(nextTwo[1])}`,
          id: 'next-2-lessons',
          label: 'Next 2 lessons',
          targetDateKeys: nextTwo
        }
      : null,
    restOfWeek.length > 0
      ? {
          description: `${restOfWeek.length} lesson${restOfWeek.length === 1 ? '' : 's'}`,
          id: 'rest-of-week',
          label: 'Rest of this week',
          targetDateKeys: restOfWeek
        }
      : null,
    {
      description: formatLongDate(sameDayNextWeek),
      id: 'same-day-next-week',
      label: 'Same day next week',
      targetDateKeys: [sameDayNextWeek]
    }
  ];

  return choices.filter((choice): choice is PlannerCopyForwardChoice => choice !== null);
}

/** Cleaned attachment label: extension stripped, dashes to spaces, ~40 chars. */
export function getPlannerDocumentDisplayName(document: PlannerDocument) {
  if (isPlannerLinkDocument(document)) {
    return document.name;
  }

  const withoutExtension = document.name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const cleaned = withoutExtension.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || document.name;

  return cleaned.length > 40 ? `${cleaned.slice(0, 39).trimEnd()}…` : cleaned;
}

/** Secondary attachment text: parent folder (or hostname for links), never the full path. */
export function getPlannerDocumentSecondaryLabel(document: PlannerDocument) {
  if (isPlannerLinkDocument(document)) {
    try {
      return new URL(document.path).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  const segments = document.path.split(/[\\/]/).filter(Boolean);
  return segments.length > 1 ? segments[segments.length - 2] : '';
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
  classLists: ClassList[],
  slotId: string | null = null
) {
  const normalizedDate = normalizeDateKey(dateKey);

  if (!normalizedDate) {
    return snapshot;
  }

  const entry = getPlannerEntryAtKey(snapshot, classListId, normalizedDate, slotId);
  if (!entry) {
    return snapshot;
  }

  return {
    ...setPlannerEntryForClassDate(snapshot, classListId, normalizedDate, null, slotId),
    deletedEntries: capDeletedLessonPlanEntries([
      ...snapshot.deletedEntries,
      createDeletedLessonPlanEntry(entry, classListId, normalizedDate, classLists, 'deleted', slotId)
    ])
  };
}

export function restoreDeletedPlannerLessonEntry(
  snapshot: PlannerSnapshot,
  deletedEntryId: string,
  restoreDateKey: string,
  classLists: ClassList[],
  slotId: string | null = null
) {
  const restoreDate = normalizeDateKey(restoreDateKey);
  const deletedEntry = snapshot.deletedEntries.find((entry) => entry.id === deletedEntryId);

  if (!restoreDate || !deletedEntry) {
    return snapshot;
  }

  const existingEntry = getPlannerEntryAtKey(snapshot, deletedEntry.classListId, restoreDate, slotId);
  const deletedEntries = snapshot.deletedEntries.filter((entry) => entry.id !== deletedEntryId);
  const nextDeletedEntries = existingEntry
    ? capDeletedLessonPlanEntries([
        ...deletedEntries,
        createDeletedLessonPlanEntry(
          existingEntry,
          deletedEntry.classListId,
          restoreDate,
          classLists,
          'replaced',
          slotId
        )
      ])
    : deletedEntries;
  const withRestoredEntry = setPlannerEntryForClassDate(
    snapshot,
    deletedEntry.classListId,
    restoreDate,
    copyLessonPlanEntry(deletedEntry),
    slotId
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

export function buildPlannerWeekSelectorOptions(
  year: number,
  selectedWeekStart: string,
  terms: SchoolTermDefinition[] = getActiveSchoolTerms()
) {
  const groups =
    terms.length > 0
      ? terms
          .map((schoolTerm) => {
            const projected = projectSchoolTermToYear(schoolTerm, year);

            if (!projected) {
              return null;
            }

            const termDays = Math.max(
              getDaysUntilDateKey(projected.startDateKey, projected.endDateKey) + 1,
              1
            );
            const weekCount = Math.ceil(termDays / 7);

            return {
              label: `Term ${projected.number}`,
              options: Array.from({ length: weekCount }, (_value, index) => {
                const weekStartDate = getPlannerWeekStartDateKey(
                  shiftDateKey(projected.startDateKey, index * 7)
                );

                return {
                  label: `Week ${index + 1}: ${formatPlannerWeekSelectorRange(weekStartDate)}`,
                  value: weekStartDate
                };
              })
            };
          })
          .filter((group): group is { label: string; options: Array<{ label: string; value: string }> } => group !== null)
      : [buildPlannerPlainWeekSelectorGroup(year)];
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

/** Week list for a whole year, used when no school terms are configured. */
export function buildPlannerPlainWeekSelectorGroup(year: number) {
  const firstWeekStart = getPlannerWeekStartDateKey(formatDateKey(year, 0, 1));
  const options: Array<{ label: string; value: string }> = [];

  for (let index = 0; index < 54; index += 1) {
    const weekStartDate = shiftDateKey(firstWeekStart, index * 7);
    const weekYear = getPlannerWeekYear(weekStartDate);

    if (weekYear > year) {
      break;
    }

    if (weekYear < year) {
      continue;
    }

    options.push({
      label: `Week of ${formatPlannerWeekSelectorRange(weekStartDate)}`,
      value: weekStartDate
    });
  }

  return { label: 'Weeks', options };
}

export function buildPlannerWeekLessonBlocks({
  resolveEntryForClassDateSlot,
  weekDatesByDay,
  weekTimelineByDay
}: {
  resolveEntryForClassDateSlot: (
    classListId: string,
    dateKey: string,
    slotId: string | null
  ) => { entry: LessonPlanEntry | null; entrySlotId: string | null };
  weekDatesByDay: Record<BellScheduleDayKey, string>;
  weekTimelineByDay: Record<BellScheduleDayKey, BellTimelineEntry[]>;
}) {
  return BELL_SCHEDULE_DAY_KEYS.flatMap((dayKey) => {
    const dateKey = weekDatesByDay[dayKey];

    return weekTimelineByDay[dayKey]
      .filter((entry) => entry.status === 'teaching' && entry.classList)
      .map((entry) => {
        const classList = entry.classList as ClassList;
        const { entry: plannerEntry, entrySlotId } = resolveEntryForClassDateSlot(
          classList.id,
          dateKey,
          entry.definition.id
        );

        return {
          classListId: classList.id,
          className: classList.name,
          dateKey,
          dayKey,
          documentCount: plannerEntry?.documents.length ?? 0,
          endMinutes: entry.definition.endMinutes,
          entrySlotId: plannerEntry ? entrySlotId : null,
          hasContent: Boolean(plannerEntry?.plan.trim() || plannerEntry?.documents.length),
          id: `${dayKey}-${entry.definition.id}-${classList.id}`,
          plan: plannerEntry?.plan ?? '',
          slotId: entry.definition.id,
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

export function makePlannerEntryKey(dateKey: string, slotId: string | null = null) {
  return slotId ? `${dateKey}#${slotId}` : dateKey;
}

export function parsePlannerEntryKey(entryKey: string) {
  const separatorIndex = entryKey.indexOf('#');

  if (separatorIndex === -1) {
    return { dateKey: entryKey, slotId: null as string | null };
  }

  const slotId = entryKey.slice(separatorIndex + 1);
  return {
    dateKey: entryKey.slice(0, separatorIndex),
    slotId: slotId ? slotId : null
  };
}

/** Exact-key lookup: the date-level entry when slotId is null, else the slot entry only. */
export function getPlannerEntryAtKey(
  snapshot: PlannerSnapshot,
  listId: string | null,
  dateKey: string,
  slotId: string | null = null
) {
  const normalizedDate = normalizeDateKey(dateKey);
  if (!normalizedDate) {
    return null;
  }

  return (
    snapshot.entriesByListId[getDashboardLayoutKey(listId)]?.[
      makePlannerEntryKey(normalizedDate, slotId)
    ] ?? null
  );
}

export function getPlannerEntry(snapshot: PlannerSnapshot, listId: string | null, dateKey: string) {
  return getPlannerEntryAtKey(snapshot, listId, dateKey, null);
}

/** Week-view resolution: prefer the slot-keyed entry, fall back to the date-level one. */
export function resolvePlannerEntryForSlot(
  snapshot: PlannerSnapshot,
  listId: string | null,
  dateKey: string,
  slotId: string | null
) {
  if (slotId) {
    const slotEntry = getPlannerEntryAtKey(snapshot, listId, dateKey, slotId);

    if (slotEntry) {
      return { entry: slotEntry, entrySlotId: slotId as string | null };
    }
  }

  return { entry: getPlannerEntryAtKey(snapshot, listId, dateKey, null), entrySlotId: null as string | null };
}

export function getPlannerEntriesForClassLists(snapshot: PlannerSnapshot, classLists: ClassList[]): LessonPlansPdfEntry[] {
  return classLists
    .flatMap((classList) => {
      const entriesForList = snapshot.entriesByListId[getDashboardLayoutKey(classList.id)] ?? {};

      return Object.entries(entriesForList).map(([entryKey, entry]) => {
        const { dateKey } = parsePlannerEntryKey(entryKey);
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

  // Editing a plan must never move the class's current-date pointer — only
  // explicit navigation (setSelectedDate / move / restore) does that.
  return {
    ...snapshot,
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
    schoolTerms?: unknown;
    schoolTermsEnabled?: unknown;
    templates?: unknown[];
  };
  const activeDateByListId: Record<string, string> = {};
  const entriesByListId: Record<string, Record<string, LessonPlanEntry>> = {};
  const deletedEntries = capDeletedLessonPlanEntries(
    Array.isArray(nextRaw.deletedEntries)
      ? nextRaw.deletedEntries
          .map((entry) => normalizeDeletedLessonPlanEntry(entry))
          .filter((entry): entry is DeletedLessonPlanEntry => entry !== null)
      : []
  );

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

      for (const [entryKeyRaw, entryRaw] of Object.entries(entriesRaw)) {
        const { dateKey, slotId } = parsePlannerEntryKey(entryKeyRaw);
        const normalizedDate = normalizeDateKey(dateKey);
        const normalizedEntry = normalizeLessonPlanEntry(entryRaw);

        if (normalizedDate && normalizedEntry) {
          nextEntriesForList[makePlannerEntryKey(normalizedDate, slotId)] = normalizedEntry;
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
    schoolTerms: normalizeSchoolTermList(nextRaw.schoolTerms) ?? initialValue.schoolTerms,
    schoolTermsEnabled:
      typeof nextRaw.schoolTermsEnabled === 'boolean'
        ? nextRaw.schoolTermsEnabled
        : initialValue.schoolTermsEnabled,
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
    slotId?: unknown;
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
    reason: nextRaw.reason === 'replaced' ? 'replaced' : 'deleted',
    slotId:
      typeof nextRaw.slotId === 'string' && nextRaw.slotId.trim() && !nextRaw.slotId.includes('#')
        ? nextRaw.slotId.trim()
        : null
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
