import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { clampNumber, createStickyNoteId, dedupeNames, haveSameStudents, isString, shuffleNames } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { WidgetSizeTier } from './dashboard';
import type { GroupPairRule, GroupRuleKind, GroupRulesForList } from './groupRules';
import {
  addGroupRule,
  buildTogetherUnits,
  countApartViolationsInGroup,
  countApartViolationsInGroups,
  countGroupRules,
  getGroupRulesForList,
  groupsSatisfyTogetherRules,
  removeGroupRule,
  useGroupRulesState
} from './groupRules';
import type { StickyNote } from './notes';
import { normalizeStickyNotes } from './notes';
import type { PickerSnapshot } from './picker';
import { filterAbsentStudents, getAbsentStudentsForList, usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';
import { applyGroupsToSeatingClassState, updateSeatingChartForList, useSeatingChartState } from './seating';

export type GroupingMode = 'count' | 'size';

export type GroupMakerSnapshot = {
  groupCount: number;
  groupSize: number;
  groupingMode: GroupingMode;
  groups: string[][];
  listId: string | null;
  sourceStudents: string[];
};

export const GROUP_SIZE_MIN = 2;

export const GROUP_SIZE_MAX = 8;

export const GROUP_COUNT_MIN = 2;

export const GROUP_COUNT_MAX = 10;

export const GROUP_BUILD_ATTEMPTS = 24;

export const GROUP_GRID_GAP = 8;

export const GROUP_GRID_MIN_COLUMNS = 2;

export const GROUP_GRID_MAX_COLUMNS = 4;

export const GROUP_GRID_MIN_COLUMN_WIDTH = 136;

export const DEFAULT_GROUP_MAKER: GroupMakerSnapshot = {
  groupCount: 4,
  groupSize: 4,
  groupingMode: 'size',
  groups: [],
  listId: null,
  sourceStudents: []
};

export function GroupMakerWidgetContent({ controller }: { controller: GroupMakerWidgetController }) {
  const groupGridRef = useRef<HTMLDivElement | null>(null);
  const [groupColumnCount, setGroupColumnCount] = useState(GROUP_GRID_MIN_COLUMNS);
  const [isRulesDialogOpen, setIsRulesDialogOpen] = useState(false);
  const {
    activeGroups,
    emptyCopy,
    groupMaker,
    groupMakerHint,
    presentStudents,
    rules,
    statusMessage
  } = controller;
  const groupingMode = groupMaker.groupingMode;
  const stepperValue = groupingMode === 'size' ? groupMaker.groupSize : groupMaker.groupCount;
  const stepperMin = groupingMode === 'size' ? GROUP_SIZE_MIN : GROUP_COUNT_MIN;
  const stepperMax = groupingMode === 'size' ? GROUP_SIZE_MAX : GROUP_COUNT_MAX;
  const ruleCount = countGroupRules(rules);

  useLayoutEffect(() => {
    const groupGrid = groupGridRef.current;

    if (!groupGrid) {
      return;
    }

    let frameId = 0;

    const updateColumnCount = () => {
      const nextColumnCount = clampNumber(
        Math.floor(
          (groupGrid.clientWidth + GROUP_GRID_GAP) / (GROUP_GRID_MIN_COLUMN_WIDTH + GROUP_GRID_GAP)
        ),
        GROUP_GRID_MIN_COLUMNS,
        GROUP_GRID_MAX_COLUMNS
      );

      setGroupColumnCount((current) => (current === nextColumnCount ? current : nextColumnCount));
    };

    updateColumnCount();

    if (typeof ResizeObserver !== 'function') {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateColumnCount);
    });

    resizeObserver.observe(groupGrid);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [activeGroups.length]);

  return (
    <>
      <div className="widget-top-controls group-maker__top-controls">
        <div className="group-maker__controls">
          <div className="segmented-row group-maker__mode-row">
            <button
              aria-pressed={groupingMode === 'size'}
              className={`text-toggle button-tone--utility ${
                groupingMode === 'size' ? 'text-toggle--active' : ''
              }`}
              data-tooltip-content="Choose how many students sit in each group"
              onClick={() => controller.updateGroupingMode('size')}
              type="button"
            >
              Groups of {groupMaker.groupSize}
            </button>
            <button
              aria-pressed={groupingMode === 'count'}
              className={`text-toggle button-tone--utility ${
                groupingMode === 'count' ? 'text-toggle--active' : ''
              }`}
              data-tooltip-content="Choose how many groups to split the class into"
              onClick={() => controller.updateGroupingMode('count')}
              type="button"
            >
              {groupMaker.groupCount} groups
            </button>
          </div>

          <div className="custom-row">
            <span className="helper-text">
              {groupingMode === 'size' ? 'Students per group' : 'Number of groups'}
            </span>
            <div className="stepper">
              <button
                aria-label={
                  groupingMode === 'size' ? 'Decrease preferred group size' : 'Decrease group count'
                }
                className="stepper__button"
                disabled={stepperValue === stepperMin}
                onClick={() => controller.updateStepperValue(stepperValue - 1)}
                type="button"
              >
                −
              </button>
              <span className="stepper__value stepper__value--active">{stepperValue}</span>
              <button
                aria-label={
                  groupingMode === 'size' ? 'Increase preferred group size' : 'Increase group count'
                }
                className="stepper__button"
                disabled={stepperValue === stepperMax}
                onClick={() => controller.updateStepperValue(stepperValue + 1)}
                type="button"
              >
                +
              </button>
            </div>
          </div>

          {groupMakerHint ? <p className="helper-text">{groupMakerHint}</p> : null}
          {statusMessage ? <p className="helper-text helper-text--accent">{statusMessage}</p> : null}
        </div>

        <div className="action-row widget-primary-actions">
          <button
            aria-label="Shuffle groups"
            className="primary-link"
            data-compact-icon="↻"
            disabled={presentStudents.length < 2}
            onClick={controller.makeGroups}
            type="button"
          >
            Shuffle groups
          </button>
          <button
            aria-haspopup="dialog"
            aria-label="Edit keep-apart and keep-together rules"
            className="secondary-link button-tone--utility"
            data-compact-icon="⚑"
            data-tooltip-content="Pin students who must or must not share a group"
            disabled={!controller.selectedList}
            onClick={() => setIsRulesDialogOpen(true)}
            type="button"
          >
            {ruleCount > 0 ? `Rules (${ruleCount})` : 'Rules'}
          </button>
          <button
            aria-label="Clear saved groups"
            className="secondary-link"
            data-compact-icon="×"
            disabled={groupMaker.groups.length === 0}
            onClick={controller.clearGroups}
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      {activeGroups.length > 0 ? (
        <>
          <div
            className="group-grid"
            ref={groupGridRef}
            style={{ gridTemplateColumns: `repeat(${groupColumnCount}, minmax(0, 1fr))` }}
          >
            {activeGroups.map((group, index) => (
              <article className="group-card" key={`group-${index + 1}`}>
                <div className="group-card__header">
                  <span className="group-card__title">Group {index + 1}</span>
                  <span className="group-card__count">{group.length}</span>
                  <button
                    aria-label={`Reshuffle group ${index + 1}`}
                    className="group-card__reshuffle"
                    data-tooltip-content="Swap this group's members with other groups"
                    disabled={activeGroups.length < 2}
                    onClick={() => controller.reshuffleGroup(index)}
                    type="button"
                  >
                    ↻
                  </button>
                </div>
                <div className="group-member-list">
                  {group.map((name) => (
                    <span className="group-member-list__item" key={`${index}-${name}`}>
                      {name}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="action-row group-maker__share-row">
            <button
              aria-label="Copy groups as text"
              className="secondary-link button-tone--utility"
              data-compact-icon="⧉"
              onClick={() => void controller.copyGroupsToClipboard()}
              type="button"
            >
              Copy
            </button>
            <button
              aria-label="Send groups to a sticky note"
              className="secondary-link button-tone--utility"
              data-compact-icon="✎"
              onClick={controller.sendGroupsToNote}
              type="button"
            >
              To note
            </button>
            <button
              aria-label="Seat these groups on the seating chart"
              className="secondary-link"
              data-compact-icon="▦"
              data-tooltip-content="Place each group onto neighbouring seats in the active layout"
              onClick={controller.sendGroupsToSeating}
              type="button"
            >
              To seating
            </button>
          </div>
        </>
      ) : (
        <div className="group-maker__empty">
          <p className="empty-copy">{emptyCopy}</p>
        </div>
      )}

      {isRulesDialogOpen && controller.selectedList ? (
        <GroupRulesDialog controller={controller} onClose={() => setIsRulesDialogOpen(false)} />
      ) : null}
    </>
  );
}

export function GroupRulesDialog({
  controller,
  onClose
}: {
  controller: GroupMakerWidgetController;
  onClose: () => void;
}) {
  const { theme } = useColorModeAppearance();
  const students = controller.selectedStudents;
  const [firstStudent, setFirstStudent] = useState(students[0] ?? '');
  const [secondStudent, setSecondStudent] = useState(students[1] ?? '');
  const canAddRule =
    Boolean(firstStudent && secondStudent) &&
    firstStudent.toLowerCase() !== secondStudent.toLowerCase();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const renderRuleList = (kind: GroupRuleKind, pairs: GroupPairRule[], emptyCopy: string) => (
    <div className="group-rules__section">
      <span className="field-label">{kind === 'apart' ? 'Keep apart' : 'Keep together'}</span>
      {pairs.length > 0 ? (
        <div className="group-rules__list">
          {pairs.map((pair) => (
            <span className="group-rules__chip" key={`${kind}-${pair[0]}-${pair[1]}`}>
              {pair[0]} {kind === 'apart' ? '×' : '+'} {pair[1]}
              <button
                aria-label={`Remove ${kind === 'apart' ? 'keep-apart' : 'keep-together'} rule for ${pair[0]} and ${pair[1]}`}
                className="group-rules__chip-remove"
                onClick={() => controller.removeRule(kind, pair)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="empty-copy">{emptyCopy}</p>
      )}
    </div>
  );

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
        aria-labelledby="group-rules-title"
        aria-modal="true"
        className="panel planner-week-dialog group-rules-dialog"
        data-theme={theme}
        role="dialog"
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content planner-week-dialog__content group-rules-dialog__content">
          <header className="planner-week-dialog__header">
            <div>
              <span className="panel-kicker">{controller.selectedList?.name}</span>
              <h2 id="group-rules-title">Grouping rules</h2>
              <p className="helper-text">
                Rules apply to every shuffle, and the seating chart randomizer keeps
                keep-apart pairs off neighbouring seats.
              </p>
            </div>
            <button
              aria-label="Close grouping rules"
              className="widget-icon-button widget-icon-button--close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="group-rules__builder">
            <label className="field-stack">
              <span className="field-label">Student</span>
              <select
                className="text-field"
                onChange={(event) => setFirstStudent(event.target.value)}
                value={firstStudent}
              >
                {students.map((student) => (
                  <option key={student} value={student}>
                    {student}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Student</span>
              <select
                className="text-field"
                onChange={(event) => setSecondStudent(event.target.value)}
                value={secondStudent}
              >
                {students.map((student) => (
                  <option key={student} value={student}>
                    {student}
                  </option>
                ))}
              </select>
            </label>
            <div className="group-rules__builder-actions">
              <button
                className="secondary-link"
                disabled={!canAddRule}
                onClick={() => controller.addRule('apart', firstStudent, secondStudent)}
                type="button"
              >
                Keep apart
              </button>
              <button
                className="secondary-link button-tone--utility"
                disabled={!canAddRule}
                onClick={() => controller.addRule('together', firstStudent, secondStudent)}
                type="button"
              >
                Keep together
              </button>
            </div>
          </div>

          {renderRuleList('apart', controller.rules.apart, 'No keep-apart pairs yet.')}
          {renderRuleList('together', controller.rules.together, 'No keep-together pairs yet.')}
        </div>
      </section>
    </div>,
    document.body
  );
}

export function GroupMakerWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const groupMaker = useGroupMakerWidgetState();

  return (
    <WidgetCard
      badge={groupMaker.groupBadgeLabel}
      collapsed={false}
      description={
        groupMaker.selectedList
          ? `Using ${groupMaker.selectedList.name}`
          : 'Choose a class from the main dashboard.'
      }
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['group-maker'].title}
          widgetId="group-maker"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['group-maker'].title}
      widgetId="group-maker"
    >
      <GroupMakerWidgetContent controller={groupMaker} />
    </WidgetCard>
  );
}

export function useGroupMakerWidgetState(pickerSnapshot?: PickerSnapshot) {
  const [internalPicker] = usePickerState();
  const picker = pickerSnapshot ?? internalPicker;
  const [groupMaker, setGroupMaker] = usePersistentState<GroupMakerSnapshot>(
    'teacher-tools.group-maker',
    DEFAULT_GROUP_MAKER,
    {
      normalize: normalizeGroupMakerSnapshot
    }
  );
  const [groupRules, setGroupRules] = useGroupRulesState();
  const [, setSeatingChart] = useSeatingChartState();
  const [, setStickyNotes] = usePersistentState<StickyNote[]>('teacher-tools.note-items', [], {
    normalize: normalizeStickyNotes
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const selectedStudents = selectedList?.students ?? [];
  const absentStudents = getAbsentStudentsForList(picker, selectedList);
  const presentStudents = filterAbsentStudents(selectedStudents, absentStudents);
  const rules = getGroupRulesForList(groupRules, selectedList?.id ?? null, selectedStudents);
  const activeGroups =
    selectedList &&
    groupMaker.listId === selectedList.id &&
    haveSameStudents(groupMaker.sourceStudents, presentStudents)
      ? groupMaker.groups
      : [];
  const groupCount = activeGroups.length;
  const apartViolations = countApartViolationsInGroups(activeGroups, rules.apart);
  const togetherSatisfied = groupsSatisfyTogetherRules(activeGroups, rules.together);

  useEffect(() => {
    setStatusMessage(null);
  }, [selectedList?.id]);

  const updateGroupingMode = (groupingMode: GroupingMode) => {
    setGroupMaker((current) =>
      current.groupingMode === groupingMode ? current : { ...current, groupingMode }
    );
  };

  const updateStepperValue = (nextValue: number) => {
    setGroupMaker((current) => {
      if (current.groupingMode === 'size') {
        const clampedSize = clampNumber(nextValue, GROUP_SIZE_MIN, GROUP_SIZE_MAX);
        return current.groupSize === clampedSize ? current : { ...current, groupSize: clampedSize };
      }

      const clampedCount = clampNumber(nextValue, GROUP_COUNT_MIN, GROUP_COUNT_MAX);
      return current.groupCount === clampedCount ? current : { ...current, groupCount: clampedCount };
    });
  };

  const clearGroups = () => {
    setStatusMessage(null);
    setGroupMaker((current) => ({
      ...current,
      groups: [],
      listId: null,
      sourceStudents: []
    }));
  };

  const makeGroups = () => {
    if (!selectedList || presentStudents.length < 2) {
      return;
    }

    setStatusMessage(null);
    setGroupMaker((current) => ({
      ...current,
      groups: buildStudentGroupsWithRules(presentStudents, {
        groupCount: current.groupCount,
        groupSize: current.groupSize,
        groupingMode: current.groupingMode,
        rules
      }),
      listId: selectedList.id,
      sourceStudents: [...presentStudents]
    }));
  };

  const reshuffleGroup = (groupIndex: number) => {
    if (activeGroups.length < 2) {
      return;
    }

    const nextGroups = reshuffleSingleGroup(activeGroups, groupIndex, rules);

    if (!nextGroups) {
      setStatusMessage(
        `No rule-friendly swaps were available for group ${groupIndex + 1}. Try a full shuffle.`
      );
      return;
    }

    setStatusMessage(`Reshuffled group ${groupIndex + 1} without touching the other groups.`);
    setGroupMaker((current) => ({
      ...current,
      groups: nextGroups
    }));
  };

  const addRule = (kind: GroupRuleKind, first: string, second: string) => {
    if (!selectedList) {
      return;
    }

    setGroupRules((current) => addGroupRule(current, selectedList.id, kind, first, second));
  };

  const removeRule = (kind: GroupRuleKind, pair: GroupPairRule) => {
    if (!selectedList) {
      return;
    }

    setGroupRules((current) => removeGroupRule(current, selectedList.id, kind, pair));
  };

  const copyGroupsToClipboard = async () => {
    if (activeGroups.length === 0 || !selectedList) {
      return;
    }

    try {
      await navigator.clipboard.writeText(formatGroupsAsText(activeGroups, selectedList.name));
      setStatusMessage('Copied the groups as text.');
    } catch {
      setStatusMessage('Copying failed. Try again after clicking inside the app.');
    }
  };

  const sendGroupsToNote = () => {
    if (activeGroups.length === 0 || !selectedList) {
      return;
    }

    const noteText = formatGroupsAsText(activeGroups, selectedList.name);

    setStickyNotes((current) => [
      {
        id: createStickyNoteId(),
        text: noteText,
        createdAt: Date.now(),
        color: 'blue',
        pinned: false,
        isTask: false,
        done: false,
        listId: selectedList.id
      },
      ...current
    ]);
    setStatusMessage('Saved the groups to a sticky note, so the shuffle is safe to clear.');
  };

  const sendGroupsToSeating = () => {
    if (activeGroups.length === 0 || !selectedList) {
      return;
    }

    let seatedEveryone = true;

    setSeatingChart((current) =>
      updateSeatingChartForList(current, selectedList.id, selectedStudents.length, (classState) => {
        const result = applyGroupsToSeatingClassState(classState, activeGroups);
        seatedEveryone = result.seatedEveryone;
        return result.classState;
      })
    );
    setStatusMessage(
      seatedEveryone
        ? 'Placed each group onto neighbouring seats in the active layout.'
        : 'Placed the groups, but the layout needs more seats to fit everyone.'
    );
  };

  return {
    activeGroups,
    addRule,
    clearGroups,
    copyGroupsToClipboard,
    emptyCopy: selectedList
      ? 'Groups will show up here after you shuffle the current list.'
      : 'Choose a class in the main dashboard to start making groups.',
    groupBadgeLabel:
      groupCount > 0
        ? `${groupCount} group${groupCount === 1 ? '' : 's'}`
        : groupMaker.groupingMode === 'size'
          ? `${groupMaker.groupSize}/group`
          : `${groupMaker.groupCount} groups`,
    groupMaker,
    groupMakerHint: !selectedList
      ? 'Choose a class list to start grouping.'
      : presentStudents.length < 2
        ? absentStudents.length > 0
          ? 'Not enough present students to make groups.'
          : 'Add at least two students to make groups.'
        : groupCount > 0
          ? `${presentStudents.length} student${presentStudents.length === 1 ? '' : 's'}${
              absentStudents.length > 0 ? ` (${absentStudents.length} away)` : ''
            } in ${groupCount} group${groupCount === 1 ? '' : 's'}${
              apartViolations > 0
                ? ` · ${apartViolations} keep-apart rule${apartViolations === 1 ? '' : 's'} unmet`
                : !togetherSatisfied
                  ? ' · a keep-together rule is unmet'
                  : ''
            }.`
          : null,
    makeGroups,
    presentStudents,
    removeRule,
    reshuffleGroup,
    rules,
    selectedList,
    selectedStudents,
    sendGroupsToNote,
    sendGroupsToSeating,
    statusMessage,
    updateGroupingMode,
    updateStepperValue
  };
}

export type GroupMakerWidgetController = ReturnType<typeof useGroupMakerWidgetState>;

export function normalizeGroupMakerSnapshot(
  raw: unknown,
  initialValue: GroupMakerSnapshot
): GroupMakerSnapshot {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    groupCount?: unknown;
    groupSize?: unknown;
    groupingMode?: unknown;
    groups?: unknown[];
    listId?: unknown;
    sourceStudents?: unknown[];
  };

  return {
    groupCount:
      typeof nextRaw.groupCount === 'number' && Number.isFinite(nextRaw.groupCount)
        ? clampNumber(Math.round(nextRaw.groupCount), GROUP_COUNT_MIN, GROUP_COUNT_MAX)
        : initialValue.groupCount,
    groupSize:
      typeof nextRaw.groupSize === 'number' && Number.isFinite(nextRaw.groupSize)
        ? clampNumber(Math.round(nextRaw.groupSize), GROUP_SIZE_MIN, GROUP_SIZE_MAX)
        : initialValue.groupSize,
    groupingMode: nextRaw.groupingMode === 'count' ? 'count' : 'size',
    groups: Array.isArray(nextRaw.groups)
      ? nextRaw.groups
          .map((group) =>
            Array.isArray(group) ? dedupeNames(group.filter(isString)).filter(Boolean) : []
          )
          .filter((group) => group.length > 0)
      : initialValue.groups,
    listId: typeof nextRaw.listId === 'string' ? nextRaw.listId : null,
    sourceStudents: Array.isArray(nextRaw.sourceStudents)
      ? dedupeNames(nextRaw.sourceStudents.filter(isString))
      : initialValue.sourceStudents
  };
}

export function getStudentGroupCount(
  studentCount: number,
  options: Pick<GroupMakerSnapshot, 'groupCount' | 'groupSize' | 'groupingMode'>
) {
  if (studentCount === 0) {
    return 0;
  }

  if (options.groupingMode === 'count') {
    return clampNumber(options.groupCount, 1, studentCount);
  }

  const clampedSize = clampNumber(options.groupSize, GROUP_SIZE_MIN, GROUP_SIZE_MAX);

  if (studentCount <= clampedSize) {
    return 1;
  }

  let groupCount = Math.ceil(studentCount / clampedSize);

  if (studentCount % clampedSize === 1 && groupCount > 1) {
    groupCount -= 1;
  }

  return groupCount;
}

export function buildStudentGroups(students: string[], preferredSize: number) {
  return buildStudentGroupsWithRules(students, {
    groupCount: DEFAULT_GROUP_MAKER.groupCount,
    groupSize: preferredSize,
    groupingMode: 'size',
    rules: { apart: [], together: [] }
  });
}

export function buildStudentGroupsWithRules(
  students: string[],
  options: Pick<GroupMakerSnapshot, 'groupCount' | 'groupSize' | 'groupingMode'> & {
    rules: GroupRulesForList;
  }
) {
  const groupCount = getStudentGroupCount(students.length, options);

  if (groupCount === 0) {
    return [];
  }

  if (groupCount === 1) {
    return [shuffleNames(students)];
  }

  const hasRules = options.rules.apart.length > 0 || options.rules.together.length > 0;
  const attemptLimit = hasRules ? GROUP_BUILD_ATTEMPTS : 1;
  let bestGroups: string[][] | null = null;
  let bestViolations = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const groups = dealUnitsIntoGroups(
      buildTogetherUnits(shuffleNames(students), options.rules.together),
      groupCount,
      students.length,
      options.rules.apart
    );
    const violations = countApartViolationsInGroups(groups, options.rules.apart);

    if (violations < bestViolations) {
      bestGroups = groups;
      bestViolations = violations;
    }

    if (bestViolations === 0) {
      break;
    }
  }

  return (bestGroups ?? []).filter((group) => group.length > 0);
}

export function dealUnitsIntoGroups(
  units: string[][],
  groupCount: number,
  studentCount: number,
  apartPairs: GroupPairRule[]
) {
  const baseSize = Math.floor(studentCount / groupCount);
  const remainder = studentCount % groupCount;
  const targetSizes = Array.from(
    { length: groupCount },
    (_value, index) => baseSize + (index < remainder ? 1 : 0)
  );
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  const orderedUnits = [...units].sort((left, right) => right.length - left.length);

  for (const unit of orderedUnits) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < groupCount; index += 1) {
      const violationDelta =
        countApartViolationsInGroup([...groups[index], ...unit], apartPairs) -
        countApartViolationsInGroup(groups[index], apartPairs);
      const remainingCapacity = targetSizes[index] - groups[index].length - unit.length;
      // Violations dominate; otherwise prefer the group with the most room left.
      const score = violationDelta * 1000 - remainingCapacity;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    groups[bestIndex] = [...groups[bestIndex], ...unit];
  }

  return groups;
}

/**
 * Swaps members of one group with random members of the other groups while
 * keeping rule violations from getting worse. Keep-together partners move as a
 * unit. Returns null when no compatible swap exists.
 */
export function reshuffleSingleGroup(
  groups: string[][],
  groupIndex: number,
  rules: GroupRulesForList
): string[][] | null {
  if (groupIndex < 0 || groupIndex >= groups.length || groups.length < 2) {
    return null;
  }

  const nextGroups = groups.map((group) => [...group]);
  const targetUnits = shuffleUnits(buildTogetherUnits(nextGroups[groupIndex], rules.together));
  let didSwap = false;

  for (const unit of targetUnits) {
    const otherIndexes = shuffleNames(
      groups.map((_group, index) => String(index)).filter((index) => Number(index) !== groupIndex)
    ).map(Number);

    let swapped = false;

    for (const otherIndex of otherIndexes) {
      const otherUnits = shuffleUnits(
        buildTogetherUnits(nextGroups[otherIndex], rules.together)
      ).filter((otherUnit) => otherUnit.length === unit.length);

      for (const otherUnit of otherUnits) {
        const candidateTarget = swapUnitMembers(nextGroups[groupIndex], unit, otherUnit);
        const candidateOther = swapUnitMembers(nextGroups[otherIndex], otherUnit, unit);
        const currentViolations =
          countApartViolationsInGroup(nextGroups[groupIndex], rules.apart) +
          countApartViolationsInGroup(nextGroups[otherIndex], rules.apart);
        const candidateViolations =
          countApartViolationsInGroup(candidateTarget, rules.apart) +
          countApartViolationsInGroup(candidateOther, rules.apart);

        if (candidateViolations > currentViolations) {
          continue;
        }

        nextGroups[groupIndex] = candidateTarget;
        nextGroups[otherIndex] = candidateOther;
        swapped = true;
        didSwap = true;
        break;
      }

      if (swapped) {
        break;
      }
    }
  }

  return didSwap ? nextGroups : null;
}

export function swapUnitMembers(group: string[], outgoing: string[], incoming: string[]) {
  const outgoingSet = new Set(outgoing.map((name) => name.toLowerCase()));

  return [...group.filter((name) => !outgoingSet.has(name.toLowerCase())), ...incoming];
}

export function shuffleUnits(units: string[][]) {
  const nextUnits = [...units];

  for (let index = nextUnits.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextUnits[index], nextUnits[swapIndex]] = [nextUnits[swapIndex], nextUnits[index]];
  }

  return nextUnits;
}

export function formatGroupsAsText(groups: string[][], className: string) {
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short'
  }).format(new Date());
  const lines = groups.map((group, index) => `Group ${index + 1}: ${group.join(', ')}`);

  return [`${className} groups (${dateLabel})`, ...lines].join('\n');
}
