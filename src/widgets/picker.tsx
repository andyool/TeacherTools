import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { getTodayDateKey, parseDateKey } from '../shared/dates';
import { usePersistentState } from '../shared/persistence';
import { announce, showUndoToast, useToday } from '../shared/uiKit';
import { clampNumber, dedupeNames, isString } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import { DEFAULT_CLASS_LIST, normalizeClassList, syncPoolWithRoster } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import { WIDGET_DETAILS } from './registry';

export type PickerHistoryEntry = {
  at: number;
  names: string[];
  purpose: string;
};

export type PickerAbsenceRecord = {
  dateKey: string;
  names: string[];
};

export type PickerSnapshot = {
  lists: ClassList[];
  selectedListId: string | null;
  pool: string[];
  currentPick: string | null;
  recentPicks: string[];
  removePickedStudents: boolean;
  absentByListId: Record<string, PickerAbsenceRecord>;
  historyByListId: Record<string, PickerHistoryEntry[]>;
  lastPickedNames: string[];
  pickCount: number;
  pickPurpose: string;
  weightedPicks: boolean;
};

export type PickerSpinnerView = {
  items: Array<{
    isActive: boolean;
    isAdjacent: boolean;
    key: string;
    name: string;
  }>;
  translatePercent: number;
};

export type LegacyPickerSnapshot = {
  roster?: string[];
  pool?: string[];
  currentPick?: string | null;
  recentPicks?: string[];
};

type PickerLastPickUndo = {
  entryAt: number;
  listId: string;
  pickedNames: string[];
  previousCurrentPick: string | null;
  previousLastPickedNames: string[];
  previousPool: string[];
  previousRecentPicks: string[];
};

export const PICKER_SPINNER_WINDOW_SIZE = 5;

export const PICKER_SPINNER_VISIBLE_SIZE = 3;

export const PICKER_SPINNER_CENTER_INDEX = Math.floor(PICKER_SPINNER_WINDOW_SIZE / 2);

export const PICKER_SPIN_MIN_STEPS = 24;

export const PICKER_SPIN_MIN_DURATION_MS = 4800;

export const PICKER_SPIN_MAX_DURATION_MS = 5400;

export const PICKER_SPIN_STEP_DURATION_MS = 150;

export const PICKER_PICK_COUNT_MIN = 1;

export const PICKER_PICK_COUNT_MAX = 12;

export const PICKER_HISTORY_LIMIT = 400;

export const DEFAULT_PICKER: PickerSnapshot = {
  lists: [DEFAULT_CLASS_LIST],
  selectedListId: DEFAULT_CLASS_LIST.id,
  pool: [...DEFAULT_CLASS_LIST.students],
  currentPick: null,
  recentPicks: [],
  removePickedStudents: true,
  absentByListId: {},
  historyByListId: {},
  lastPickedNames: [],
  pickCount: 1,
  pickPurpose: '',
  weightedPicks: false
};

export function PickerWidgetContent({ controller }: { controller: PickerWidgetController }) {
  const [isStudentsDialogOpen, setIsStudentsDialogOpen] = useState(false);
  const {
    absentStudents,
    canUndoPick,
    isPickerSpinning,
    lastPickedNames,
    pickCount,
    pickStudent,
    pickableStudentCount,
    pickerSpinnerView,
    recentPicks,
    selectedList,
    selectedStudents,
    setWeightedPicks,
    skipSpin,
    spinnerTrackRef,
    undoLastPick,
    updatePickCount
  } = controller;
  const removePickedStudents = controller.picker.removePickedStudents;
  const weightedPicks = controller.picker.weightedPicks;
  const pickerModeLabel = removePickedStudents ? 'Remove after pick' : 'Keep in list';
  const pickerSpinnerStyle = {
    '--picker-spinner-translate': `${pickerSpinnerView.translatePercent}%`
  } as CSSProperties;
  const effectivePickCount = Math.min(pickCount, Math.max(pickableStudentCount, 1));
  const pickButtonLabel = isPickerSpinning
    ? 'Skip'
    : effectivePickCount > 1
      ? `Pick ${effectivePickCount} students`
      : 'Pick student';
  const presentStudentCount = filterAbsentStudents(selectedStudents, absentStudents).length;
  const showEmptyPoolReset =
    !isPickerSpinning && pickableStudentCount === 0 && presentStudentCount > 0;
  const showUndoPick = !isPickerSpinning && canUndoPick;

  return (
    <>
      <div className="widget-top-controls picker-widget__top-controls">
        <div className="helper-row picker-controls-row">
          <button
            aria-label={removePickedStudents ? 'Reset picker cycle' : 'Clear recent picks'}
            className="secondary-link"
            data-compact-icon="↻"
            data-tooltip-content={
              removePickedStudents
                ? 'Return every picked student to the cycle'
                : 'Clear the recent picks list'
            }
            disabled={selectedStudents.length === 0}
            onClick={controller.resetCurrentListCycle}
            type="button"
          >
            {removePickedStudents ? 'Reset cycle' : 'Clear picks'}
          </button>
          <button
            aria-label={pickerModeLabel}
            aria-pressed={removePickedStudents}
            className="text-toggle picker-mode-toggle button-tone--utility"
            data-compact-icon={removePickedStudents ? '⊖' : '≡'}
            data-tooltip-content={
              removePickedStudents
                ? 'Picked students leave the list until you reset'
                : 'Picked students stay in the list'
            }
            onClick={() => controller.toggleRemovePickedStudents(!removePickedStudents)}
            type="button"
          >
            {pickerModeLabel}
          </button>
          <button
            aria-haspopup="dialog"
            aria-label="Open students, fairness, and pick history"
            className="secondary-link button-tone--utility"
            data-compact-icon="☰"
            data-tooltip-content="Absences, fairness counts, and the pick log"
            disabled={selectedStudents.length === 0}
            onClick={() => setIsStudentsDialogOpen(true)}
            type="button"
          >
            {absentStudents.length > 0 ? `Students (${absentStudents.length} away)` : 'Students'}
          </button>
        </div>
      </div>

      {selectedStudents.length > 0 && (
        <div className="picker-status-row">
          {absentStudents.length > 0 && (
            <button
              aria-haspopup="dialog"
              aria-label={`${absentStudents.length} student${absentStudents.length === 1 ? '' : 's'} away — open the students dialog`}
              className="picker-status-chip"
              data-tooltip-content="Open absences"
              onClick={() => setIsStudentsDialogOpen(true)}
              type="button"
            >
              {absentStudents.length} away
            </button>
          )}
          <button
            aria-pressed={weightedPicks}
            className={`picker-status-chip${weightedPicks ? ' picker-status-chip--active' : ''}`}
            data-tooltip-content="Prefer least-picked students"
            onClick={() => setWeightedPicks(!weightedPicks)}
            type="button"
          >
            Fair
          </button>
        </div>
      )}

      <div className="picker-stack">
        <div
          className={`picker-spinner ${isPickerSpinning ? 'picker-spinner--running' : ''}`}
          onClick={isPickerSpinning ? skipSpin : undefined}
        >
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
        {(showUndoPick || showEmptyPoolReset) && (
          <div className="picker-stage-actions">
            {showUndoPick && (
              <button
                className="secondary-link"
                data-tooltip-content="Return the last pick to the cycle and restore the previous result"
                onClick={undoLastPick}
                type="button"
              >
                Undo pick
              </button>
            )}
            {showEmptyPoolReset && (
              <button
                className="secondary-link"
                data-tooltip-content="Return every picked student to the cycle"
                onClick={controller.resetCurrentListCycle}
                type="button"
              >
                Reset cycle
              </button>
            )}
          </div>
        )}
      </div>

      <div className="action-row widget-primary-actions picker-pick-row">
        <div className="stepper picker-pick-count" data-tooltip-content="How many students to pick at once">
          <button
            aria-label="Pick fewer students at once"
            className="stepper__button"
            disabled={pickCount <= PICKER_PICK_COUNT_MIN || isPickerSpinning}
            onClick={() => updatePickCount(pickCount - 1)}
            type="button"
          >
            −
          </button>
          <span className="stepper__value stepper__value--active">{pickCount}</span>
          <button
            aria-label="Pick more students at once"
            className="stepper__button"
            disabled={pickCount >= PICKER_PICK_COUNT_MAX || isPickerSpinning}
            onClick={() => updatePickCount(pickCount + 1)}
            type="button"
          >
            +
          </button>
        </div>
        <button
          aria-label={isPickerSpinning ? 'Skip to the result' : `Pick ${effectivePickCount} student${effectivePickCount === 1 ? '' : 's'}`}
          className="primary-link picker-pick-button"
          data-tooltip-content={isPickerSpinning ? 'Land on the result now' : undefined}
          disabled={!isPickerSpinning && pickableStudentCount === 0}
          onClick={isPickerSpinning ? skipSpin : pickStudent}
          type="button"
        >
          {pickButtonLabel}
        </button>
      </div>

      {!isPickerSpinning && lastPickedNames.length > 1 && (
        <div className="picker-multi-result" aria-label="Students picked together">
          {lastPickedNames.map((name) => (
            <span className="picker-multi-result__name" key={name}>
              {name}
            </span>
          ))}
        </div>
      )}

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

      {isStudentsDialogOpen && selectedList ? (
        <PickerStudentsDialog controller={controller} onClose={() => setIsStudentsDialogOpen(false)} />
      ) : null}
    </>
  );
}

export function PickerStudentsDialog({
  controller,
  onClose
}: {
  controller: PickerWidgetController;
  onClose: () => void;
}) {
  const { theme } = useColorModeAppearance();
  const todayKey = useToday();
  const {
    absentStudents,
    clearHistory,
    copyHistory,
    history,
    pickCounts,
    selectedList,
    selectedStudents,
    setPickPurpose,
    setWeightedPicks,
    toggleAbsentStudent
  } = controller;
  const absentSet = new Set(absentStudents.map((name) => name.toLowerCase()));
  const todayParts = parseDateKey(todayKey);
  const todayStartMs = todayParts
    ? new Date(todayParts.year, todayParts.monthIndex, todayParts.day).getTime()
    : Date.now();
  const todayCounts = getPickCountsFromHistory(history, todayStartMs);

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
        aria-labelledby="picker-students-title"
        aria-modal="true"
        className="panel planner-week-dialog picker-students-dialog"
        data-theme={theme}
        role="dialog"
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content planner-week-dialog__content picker-students-dialog__content">
          <header className="planner-week-dialog__header">
            <div>
              <span className="panel-kicker">{selectedList?.name ?? 'Students'}</span>
              <h2 id="picker-students-title">Students &amp; pick history</h2>
              <p className="helper-text">
                Mark who is away today, watch fairness counts, and review the pick log.
              </p>
            </div>
            <button
              aria-label="Close students dialog"
              className="widget-icon-button widget-icon-button--close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="picker-students-dialog__options">
            <label className="lesson-plan-export-dialog__toggle">
              <input
                checked={controller.picker.weightedPicks}
                onChange={(event) => setWeightedPicks(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Prefer least-picked students</span>
            </label>
            <label className="field-stack picker-students-dialog__purpose">
              <span className="field-label">Log picks as (optional)</span>
              <input
                className="text-field"
                onChange={(event) => setPickPurpose(event.target.value)}
                placeholder="e.g. Reading aloud, Question 3"
                type="text"
                value={controller.picker.pickPurpose}
              />
            </label>
          </div>

          <div className="picker-students-dialog__roster">
            {selectedStudents.map((name) => {
              const isAbsent = absentSet.has(name.toLowerCase());
              const totalPicks = pickCounts[name.toLowerCase()] ?? 0;
              const todayPicks = todayCounts[name.toLowerCase()] ?? 0;

              return (
                <div
                  className={`picker-students-dialog__row ${
                    isAbsent ? 'picker-students-dialog__row--absent' : ''
                  }`}
                  key={name}
                >
                  <span className="picker-students-dialog__name">{name}</span>
                  <span
                    className="badge"
                    data-tooltip-content={`Picked ${totalPicks} time${totalPicks === 1 ? '' : 's'} since the log was last cleared`}
                  >
                    {todayPicks > 0 ? `${totalPicks} · today ${todayPicks}` : `${totalPicks}`}
                  </span>
                  <button
                    aria-label={isAbsent ? `Mark ${name} present` : `Mark ${name} absent`}
                    aria-pressed={isAbsent}
                    className={`text-toggle button-tone--utility ${isAbsent ? 'text-toggle--active' : ''}`}
                    onClick={() => toggleAbsentStudent(name)}
                    type="button"
                  >
                    {isAbsent ? 'Absent' : 'Present'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="picker-students-dialog__history">
            <div className="picker-students-dialog__history-head">
              <span className="field-label">Pick log</span>
              <div className="picker-students-dialog__history-actions">
                <button
                  className="secondary-link"
                  data-tooltip-content="Copy every pick as “Name — date time” lines"
                  disabled={history.length === 0}
                  onClick={() => void copyHistory()}
                  type="button"
                >
                  Copy log
                </button>
                <button
                  className="danger-link"
                  disabled={history.length === 0}
                  onClick={clearHistory}
                  type="button"
                >
                  Clear log
                </button>
              </div>
            </div>
            {history.length > 0 ? (
              <div className="picker-students-dialog__history-list">
                {history.slice(0, 60).map((entry) => (
                  <div className="picker-students-dialog__history-row" key={entry.at}>
                    <span className="picker-students-dialog__history-time">
                      {formatPickerHistoryTimestamp(entry.at)}
                    </span>
                    <span className="picker-students-dialog__history-names">
                      {entry.names.join(', ')}
                    </span>
                    {entry.purpose ? (
                      <span className="picker-students-dialog__history-purpose">{entry.purpose}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No picks logged yet. Every pick lands here with its date.</p>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function formatPickerHistoryTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short'
  }).format(new Date(timestamp));
}

export function PickerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const picker = usePickerWidgetState();
  const absentCount = picker.absentStudents.length;

  return (
    <WidgetCard
      badge={absentCount > 0 ? `${picker.rosterCount} · ${absentCount} away` : `${picker.rosterCount}`}
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
      <PickerWidgetContent controller={picker} />
    </WidgetCard>
  );
}

export function usePickerState() {
  return usePersistentState<PickerSnapshot>('teacher-tools.picker', DEFAULT_PICKER, {
    normalize: normalizePickerSnapshot
  });
}

export function usePickerWidgetState() {
  const pickerSpinAnimationFrameRef = useRef<number | null>(null);
  const pickerSpinFinishRef = useRef<(() => void) | null>(null);
  const pickerSpinnerTrackRef = useRef<HTMLDivElement | null>(null);
  const pickerRenderedPositionRef = useRef(0);
  const [picker, setPicker] = usePickerState();
  const [isPickerSpinning, setIsPickerSpinning] = useState(false);
  const [spinnerPosition, setSpinnerPosition] = useState(0);
  const [lastPickUndo, setLastPickUndo] = useState<PickerLastPickUndo | null>(null);
  const todayKey = useToday();
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const selectedStudents = selectedList?.students ?? [];
  const selectedStudentSet = new Set(selectedStudents.map((name) => name.toLowerCase()));
  const absentStudents = getAbsentStudentsForList(picker, selectedList);
  const history = selectedList ? picker.historyByListId[selectedList.id] ?? [] : [];
  const pickCounts = getPickCountsFromHistory(history);
  const canUndoPick =
    lastPickUndo !== null &&
    lastPickUndo.listId === selectedList?.id &&
    history.some((entry) => entry.at === lastPickUndo.entryAt);
  const pickableStudents = filterAbsentStudents(
    getPickerSelectionPool(selectedStudents, picker.pool, picker.removePickedStudents),
    absentStudents
  );

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
      pickerSpinFinishRef.current = null;
    };
  }, []);

  const resetCurrentListCycle = () => {
    if (!selectedList) {
      return;
    }

    setLastPickUndo(null);
    setPicker((current) => ({
      ...current,
      pool: [...selectedList.students],
      currentPick: null,
      lastPickedNames: [],
      recentPicks: []
    }));
  };

  const toggleRemovePickedStudents = (removePickedStudents: boolean) => {
    setLastPickUndo(null);
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

    const readyPool = filterAbsentStudents(
      getPickerSelectionPool(selectedStudents, picker.pool, picker.removePickedStudents),
      absentStudents
    );
    if (!readyPool.length) {
      setPicker((current) =>
        current.selectedListId === selectedList.id ? { ...current, currentPick: null } : current
      );
      return;
    }

    const pickedNames = drawPickerNames(readyPool, picker.pickCount, {
      pickCounts: picker.weightedPicks ? pickCounts : null
    });
    const pickedName = pickedNames[0];
    const pickedSet = new Set(pickedNames);
    const remainingPool = picker.removePickedStudents
      ? syncPoolWithRoster(selectedStudents, picker.pool, true).filter(
          (entry) => !pickedSet.has(entry)
        )
      : [...selectedStudents];
    const finalIndex = readyPool.indexOf(pickedName);
    const normalizedSpinnerIndex = readyPool.length
      ? getNormalizedPickerIndex(spinnerPosition, readyPool.length)
      : 0;
    const totalSteps = getPickerSpinStepCount(
      readyPool.length,
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

    const finishSpin = () => {
      pickerSpinFinishRef.current = null;

      if (pickerSpinAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(pickerSpinAnimationFrameRef.current);
        pickerSpinAnimationFrameRef.current = null;
      }

      const pickedAt = Date.now();

      syncSpinnerPosition(finalIndex, true);
      setIsPickerSpinning(false);
      setPicker((current) => {
        if (current.selectedListId !== selectedListId) {
          return current;
        }

        const historyEntry: PickerHistoryEntry = {
          at: pickedAt,
          names: pickedNames,
          purpose: current.pickPurpose.trim()
        };

        return {
          ...current,
          pool: remainingPool,
          currentPick: pickedName,
          lastPickedNames: pickedNames,
          recentPicks: [
            ...pickedNames,
            ...current.recentPicks.filter((entry) => !pickedSet.has(entry))
          ].slice(0, 5),
          historyByListId: {
            ...current.historyByListId,
            [selectedListId]: [
              historyEntry,
              ...(current.historyByListId[selectedListId] ?? [])
            ].slice(0, PICKER_HISTORY_LIMIT)
          }
        };
      });
      setLastPickUndo({
        entryAt: pickedAt,
        listId: selectedListId,
        pickedNames,
        previousCurrentPick: picker.currentPick,
        previousLastPickedNames: [...picker.lastPickedNames],
        previousPool: [...picker.pool],
        previousRecentPicks: [...picker.recentPicks]
      });
      announce(`Picked ${pickedNames.join(', ')}`);
    };

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
      finishSpin();
    };

    pickerSpinFinishRef.current = finishSpin;
    pickerSpinAnimationFrameRef.current = window.requestAnimationFrame(animatePickerSpin);
  };

  const skipSpin = () => {
    pickerSpinFinishRef.current?.();
  };

  const undoLastPick = () => {
    if (!canUndoPick || !lastPickUndo || isPickerSpinning) {
      return;
    }

    const undo = lastPickUndo;

    setLastPickUndo(null);
    setPicker((current) => {
      if (current.selectedListId !== undo.listId) {
        return current;
      }

      const remainingEntries = (current.historyByListId[undo.listId] ?? []).filter(
        (entry) => entry.at !== undo.entryAt
      );
      const nextHistoryByListId = { ...current.historyByListId };

      if (remainingEntries.length > 0) {
        nextHistoryByListId[undo.listId] = remainingEntries;
      } else {
        delete nextHistoryByListId[undo.listId];
      }

      return {
        ...current,
        pool: undo.previousPool,
        currentPick: undo.previousCurrentPick,
        lastPickedNames: undo.previousLastPickedNames,
        recentPicks: undo.previousRecentPicks,
        historyByListId: nextHistoryByListId
      };
    });
    announce(`Undid pick: ${undo.pickedNames.join(', ')}`);
  };

  const updatePickCount = (nextCount: number) => {
    const clampedCount = clampNumber(
      Math.round(nextCount),
      PICKER_PICK_COUNT_MIN,
      PICKER_PICK_COUNT_MAX
    );

    setPicker((current) =>
      current.pickCount === clampedCount ? current : { ...current, pickCount: clampedCount }
    );
  };

  const toggleAbsentStudent = (studentName: string) => {
    if (!selectedList) {
      return;
    }

    const listId = selectedList.id;

    setPicker((current) => {
      const currentRecord = current.absentByListId[listId];
      const currentAbsent =
        currentRecord && currentRecord.dateKey === todayKey ? currentRecord.names : [];
      const isAbsent = currentAbsent.some(
        (entry) => entry.toLowerCase() === studentName.toLowerCase()
      );
      const nextAbsent = isAbsent
        ? currentAbsent.filter((entry) => entry.toLowerCase() !== studentName.toLowerCase())
        : [...currentAbsent, studentName];
      const nextAbsentByListId = { ...current.absentByListId };

      if (nextAbsent.length > 0) {
        nextAbsentByListId[listId] = { dateKey: todayKey, names: nextAbsent };
      } else {
        delete nextAbsentByListId[listId];
      }

      return {
        ...current,
        absentByListId: nextAbsentByListId
      };
    });
  };

  const setWeightedPicks = (weightedPicks: boolean) => {
    setPicker((current) =>
      current.weightedPicks === weightedPicks ? current : { ...current, weightedPicks }
    );
  };

  const setPickPurpose = (pickPurpose: string) => {
    setPicker((current) => ({ ...current, pickPurpose }));
  };

  const clearHistory = () => {
    if (!selectedList || history.length === 0) {
      return;
    }

    const listId = selectedList.id;
    const clearedEntries = [...history];

    setLastPickUndo(null);
    setPicker((current) => {
      const nextHistoryByListId = { ...current.historyByListId };
      delete nextHistoryByListId[listId];

      return {
        ...current,
        historyByListId: nextHistoryByListId
      };
    });
    showUndoToast('Cleared pick log', () => {
      setPicker((current) => ({
        ...current,
        historyByListId: {
          ...current.historyByListId,
          [listId]: clearedEntries
        }
      }));
    });
  };

  const copyHistory = async () => {
    if (history.length === 0) {
      return;
    }

    const lines = history.flatMap((entry) =>
      entry.names.map((name) => `${name} — ${formatPickerHistoryTimestamp(entry.at)}`)
    );

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      announce('Pick log copied');
    } catch {
      announce('Could not copy the pick log');
    }
  };

  return {
    absentStudents,
    canUndoPick,
    clearHistory,
    copyHistory,
    history,
    isPickerSpinning,
    lastPickedNames: picker.lastPickedNames.filter((name) =>
      selectedStudentSet.has(name.toLowerCase())
    ),
    pickCount: picker.pickCount,
    pickCounts,
    pickStudent,
    picker,
    pickerSpinnerView: buildPickerSpinnerView({
      currentPick: picker.currentPick,
      emptyLabel: selectedStudents.length
        ? pickableStudents.length
          ? 'Ready to pick'
          : 'No more names'
        : 'No list selected',
      isSpinning: isPickerSpinning,
      names: pickableStudents,
      spinnerPosition
    }),
    pickableStudentCount: pickableStudents.length,
    recentPicks: picker.recentPicks.slice(0, 4),
    resetCurrentListCycle,
    rosterCount: selectedStudents.length,
    selectedList,
    selectedStudents,
    setPickPurpose,
    setPicker,
    setWeightedPicks,
    skipSpin,
    spinnerTrackRef: pickerSpinnerTrackRef,
    toggleAbsentStudent,
    toggleRemovePickedStudents,
    undoLastPick,
    updatePickCount
  };
}

export type PickerWidgetController = ReturnType<typeof usePickerWidgetState>;

export function getAbsentStudentsForList(snapshot: PickerSnapshot, list: ClassList | null) {
  if (!list) {
    return [];
  }

  const record = snapshot.absentByListId[list.id];

  // Absences are date-scoped: records from a previous day have expired.
  if (!record || record.dateKey !== getTodayDateKey()) {
    return [];
  }

  const rosterSet = new Set(list.students.map((name) => name.toLowerCase()));

  return record.names.filter((name) => rosterSet.has(name.toLowerCase()));
}

export function filterAbsentStudents(names: string[], absentStudents: string[]) {
  if (absentStudents.length === 0) {
    return names;
  }

  const absentSet = new Set(absentStudents.map((name) => name.toLowerCase()));

  return names.filter((name) => !absentSet.has(name.toLowerCase()));
}

export function getPickCountsFromHistory(history: PickerHistoryEntry[], sinceMs?: number) {
  const counts: Record<string, number> = {};

  for (const entry of history) {
    if (sinceMs !== undefined && entry.at < sinceMs) {
      continue;
    }

    for (const name of entry.names) {
      const key = name.toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return counts;
}

/**
 * Draws up to `count` distinct names. With pick counts provided, students who
 * have been picked less often get proportionally higher odds.
 */
export function drawPickerNames(
  pool: string[],
  count: number,
  options: { pickCounts: Record<string, number> | null }
) {
  const remaining = [...pool];
  const drawCount = clampNumber(Math.round(count), 1, remaining.length);
  const drawn: string[] = [];

  while (drawn.length < drawCount && remaining.length > 0) {
    const index = options.pickCounts
      ? drawWeightedPickerIndex(remaining, options.pickCounts)
      : Math.floor(Math.random() * remaining.length);

    drawn.push(remaining[index]);
    remaining.splice(index, 1);
  }

  return drawn;
}

export function drawWeightedPickerIndex(names: string[], pickCounts: Record<string, number>) {
  const counts = names.map((name) => pickCounts[name.toLowerCase()] ?? 0);
  const maxCount = Math.max(...counts);
  const weights = counts.map((count) => maxCount - count + 1);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let target = Math.random() * totalWeight;

  for (let index = 0; index < weights.length; index += 1) {
    target -= weights[index];
    if (target < 0) {
      return index;
    }
  }

  return names.length - 1;
}

export function normalizePickerSnapshot(raw: unknown, initialValue: PickerSnapshot) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    absentByListId?: Record<string, unknown>;
    currentPick?: unknown;
    historyByListId?: Record<string, unknown>;
    lastPickedNames?: unknown[];
    lists?: unknown[];
    pickCount?: unknown;
    pickPurpose?: unknown;
    pool?: unknown;
    recentPicks?: unknown[];
    removePickedStudents?: unknown;
    selectedListId?: unknown;
    weightedPicks?: unknown;
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
    const savedPool = Array.isArray(nextRaw.pool) ? nextRaw.pool : null;
    const poolSource = savedPool ? savedPool.filter(isString) : [];
    const removePickedStudents =
      typeof nextRaw.removePickedStudents === 'boolean'
        ? nextRaw.removePickedStudents
        : initialValue.removePickedStudents;
    const currentPick =
      typeof nextRaw.currentPick === 'string' && selectedList?.students.includes(nextRaw.currentPick)
        ? nextRaw.currentPick
        : null;
    const recentPicks = Array.isArray(nextRaw.recentPicks)
      ? nextRaw.recentPicks
          .filter(isString)
          .filter((name: string) => selectedList?.students.includes(name))
      : [];
    const listIds = new Set(fallbackLists.map((list) => list.id));

    return {
      lists: fallbackLists,
      selectedListId,
      pool: selectedList
        ? syncPoolWithRoster(selectedList.students, poolSource, removePickedStudents && savedPool !== null)
        : [],
      currentPick,
      recentPicks,
      removePickedStudents,
      absentByListId: normalizePickerAbsentMap(nextRaw.absentByListId, listIds),
      historyByListId: normalizePickerHistoryMap(nextRaw.historyByListId, listIds),
      lastPickedNames: Array.isArray(nextRaw.lastPickedNames)
        ? nextRaw.lastPickedNames
            .filter(isString)
            .filter((name) => selectedList?.students.includes(name))
        : [],
      pickCount:
        typeof nextRaw.pickCount === 'number' && Number.isFinite(nextRaw.pickCount)
          ? clampNumber(Math.round(nextRaw.pickCount), PICKER_PICK_COUNT_MIN, PICKER_PICK_COUNT_MAX)
          : initialValue.pickCount,
      pickPurpose: typeof nextRaw.pickPurpose === 'string' ? nextRaw.pickPurpose : '',
      weightedPicks:
        typeof nextRaw.weightedPicks === 'boolean'
          ? nextRaw.weightedPicks
          : initialValue.weightedPicks
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
    removePickedStudents: initialValue.removePickedStudents,
    absentByListId: {},
    historyByListId: {},
    lastPickedNames: [],
    pickCount: initialValue.pickCount,
    pickPurpose: '',
    weightedPicks: initialValue.weightedPicks
  };
}

export function normalizePickerAbsentMap(
  raw: Record<string, unknown> | undefined,
  listIds: Set<string>
) {
  const absentByListId: Record<string, PickerAbsenceRecord> = {};

  if (!raw || typeof raw !== 'object') {
    return absentByListId;
  }

  const todayKey = getTodayDateKey();

  for (const [listId, recordRaw] of Object.entries(raw)) {
    if (!listIds.has(listId)) {
      continue;
    }

    // Legacy plain-array absences become today's absences once.
    if (Array.isArray(recordRaw)) {
      const names = dedupeNames(recordRaw.filter(isString));
      if (names.length > 0) {
        absentByListId[listId] = { dateKey: todayKey, names };
      }
      continue;
    }

    if (!recordRaw || typeof recordRaw !== 'object') {
      continue;
    }

    const candidate = recordRaw as { dateKey?: unknown; names?: unknown };
    if (typeof candidate.dateKey !== 'string' || !Array.isArray(candidate.names)) {
      continue;
    }

    // Date-scoped absences expire on a new day, so drop stale records here.
    const names = dedupeNames(candidate.names.filter(isString));
    if (names.length > 0 && candidate.dateKey === todayKey) {
      absentByListId[listId] = { dateKey: candidate.dateKey, names };
    }
  }

  return absentByListId;
}

export function normalizePickerHistoryMap(
  raw: Record<string, unknown> | undefined,
  listIds: Set<string>
) {
  const historyByListId: Record<string, PickerHistoryEntry[]> = {};

  if (!raw || typeof raw !== 'object') {
    return historyByListId;
  }

  for (const [listId, entriesRaw] of Object.entries(raw)) {
    if (!listIds.has(listId) || !Array.isArray(entriesRaw)) {
      continue;
    }

    const entries: PickerHistoryEntry[] = [];

    for (const entryRaw of entriesRaw) {
      if (!entryRaw || typeof entryRaw !== 'object') {
        continue;
      }

      const candidate = entryRaw as { at?: unknown; names?: unknown[]; purpose?: unknown };
      const names = Array.isArray(candidate.names) ? candidate.names.filter(isString) : [];

      if (names.length === 0 || typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) {
        continue;
      }

      entries.push({
        at: candidate.at,
        names,
        purpose: typeof candidate.purpose === 'string' ? candidate.purpose : ''
      });
    }

    if (entries.length > 0) {
      historyByListId[listId] = entries.slice(0, PICKER_HISTORY_LIMIT);
    }
  }

  return historyByListId;
}

export function removeClassListFromPicker(snapshot: PickerSnapshot, listId: string) {
  const nextLists = snapshot.lists.filter((list) => list.id !== listId);
  const absentByListId = { ...snapshot.absentByListId };
  const historyByListId = { ...snapshot.historyByListId };
  delete absentByListId[listId];
  delete historyByListId[listId];

  if (nextLists.length === 0) {
    return {
      ...snapshot,
      lists: [],
      selectedListId: null,
      pool: [],
      currentPick: null,
      recentPicks: [],
      absentByListId,
      historyByListId,
      lastPickedNames: []
    };
  }

  if (snapshot.selectedListId && snapshot.selectedListId !== listId) {
    const selectedList = nextLists.find((list) => list.id === snapshot.selectedListId);
    if (selectedList) {
      return {
        ...snapshot,
        lists: nextLists,
        pool: syncPoolWithRoster(
          selectedList.students,
          snapshot.pool,
          snapshot.removePickedStudents
        ),
        currentPick:
          snapshot.currentPick && selectedList.students.includes(snapshot.currentPick)
            ? snapshot.currentPick
            : null,
        recentPicks: snapshot.recentPicks.filter((name) => selectedList.students.includes(name)),
        absentByListId,
        historyByListId
      };
    }
  }

  const fallbackList = nextLists[0];
  return {
    ...snapshot,
    lists: nextLists,
    selectedListId: fallbackList.id,
    pool: [...fallbackList.students],
    currentPick: null,
    recentPicks: [],
    absentByListId,
    historyByListId,
    lastPickedNames: []
  };
}

export function buildPickerSpinnerView({
  currentPick,
  emptyLabel = 'No list selected',
  isSpinning,
  names,
  spinnerPosition
}: {
  currentPick: string | null;
  emptyLabel?: string;
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
      items: restingItems(emptyLabel),
      translatePercent: getPickerSpinnerTranslatePercent(0)
    };
  }

  if (!isSpinning) {
    return {
      items: restingItems(currentPick ?? 'Ready to pick'),
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

export function getNormalizedPickerIndex(index: number, itemCount: number) {
  const normalizedItemCount = Math.max(0, itemCount);

  if (normalizedItemCount === 0) {
    return 0;
  }

  const roundedIndex = Math.round(index);

  return ((roundedIndex % normalizedItemCount) + normalizedItemCount) % normalizedItemCount;
}

export function getPickerSpinnerTranslatePercent(offset: number) {
  const leadingHiddenRows = (PICKER_SPINNER_WINDOW_SIZE - PICKER_SPINNER_VISIBLE_SIZE) / 2;

  return ((leadingHiddenRows + offset) * -100) / PICKER_SPINNER_WINDOW_SIZE;
}

export function getPickerSpinDuration(totalSteps: number) {
  return Math.min(
    PICKER_SPIN_MAX_DURATION_MS,
    Math.max(PICKER_SPIN_MIN_DURATION_MS, totalSteps * PICKER_SPIN_STEP_DURATION_MS)
  );
}

export function easeOutPickerSpin(progress: number) {
  return 1 - Math.pow(1 - progress, 5);
}

export function getPickerSpinStepCount(studentCount: number, currentIndex: number, finalIndex: number) {
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

export function getPickerSelectionPool(roster: string[], pool: string[], removePickedStudents: boolean) {
  return removePickedStudents ? syncPoolWithRoster(roster, pool, true) : [...roster];
}

export function getPickerRemainingPool(
  roster: string[],
  currentPool: string[],
  pickedName: string,
  removePickedStudents: boolean
) {
  return removePickedStudents ? currentPool.filter((entry) => entry !== pickedName) : [...roster];
}
