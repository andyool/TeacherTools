import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import { useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { announce, showUndoToast, WidgetDialog } from '../shared/uiKit';
import { clampNumber, createStickyNoteId, dedupeNames, isString, shuffleNames } from '../shared/utils';
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
  StudentCombobox,
  useGroupRulesState
} from './groupRules';
import type { StickyNote } from './notes';
import { normalizeStickyNotes } from './notes';
import type { PickerSnapshot } from './picker';
import { filterAbsentStudents, getAbsentStudentsForList, usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';
import { applyGroupsToSeatingClassState, updateSeatingChartForList, useSeatingChartState } from './seating';

export type GroupingMode = 'count' | 'size';

export type SavedGroupSet = {
  createdAt: number;
  groupNames: string[];
  groups: string[][];
  id: string;
  name: string;
};

export type GroupMakerSnapshot = {
  groupCount: number;
  groupNames: string[];
  groupSize: number;
  groupingMode: GroupingMode;
  groups: string[][];
  lastCompositionByListId: Record<string, string[][]>;
  listId: string | null;
  savedSetsByListId: Record<string, SavedGroupSet[]>;
  sourceStudents: string[];
};

export const GROUP_SIZE_MIN = 2;

export const GROUP_SIZE_MAX = 15;

export const GROUP_COUNT_MIN = 2;

export const GROUP_COUNT_MAX = 15;

export const GROUP_BUILD_ATTEMPTS = 24;

export const GROUP_REPEAT_AVOID_ATTEMPTS = 15;

export const SAVED_GROUP_SET_LIMIT = 12;

export const GROUP_STATUS_TIMEOUT_MS = 5000;

export const GROUP_GRID_GAP = 8;

export const GROUP_GRID_MIN_COLUMNS = 2;

export const GROUP_GRID_MAX_COLUMNS = 4;

export const GROUP_GRID_MIN_COLUMN_WIDTH = 136;

export const DEFAULT_GROUP_MAKER: GroupMakerSnapshot = {
  groupCount: 4,
  groupNames: [],
  groupSize: 4,
  groupingMode: 'size',
  groups: [],
  lastCompositionByListId: {},
  listId: null,
  savedSetsByListId: {},
  sourceStudents: []
};

export function getGroupLabel(groupNames: string[], groupIndex: number) {
  return groupNames[groupIndex]?.trim() || `Group ${groupIndex + 1}`;
}

export function GroupMakerWidgetContent({ controller }: { controller: GroupMakerWidgetController }) {
  const groupGridRef = useRef<HTMLDivElement | null>(null);
  const [groupColumnCount, setGroupColumnCount] = useState(GROUP_GRID_MIN_COLUMNS);
  const [isRulesDialogOpen, setIsRulesDialogOpen] = useState(false);
  const [isSetsDialogOpen, setIsSetsDialogOpen] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const [draggedStudent, setDraggedStudent] = useState<string | null>(null);
  const [dragOverGroupIndex, setDragOverGroupIndex] = useState<number | null>(null);
  const [editingGroupIndex, setEditingGroupIndex] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const {
    absentStudents,
    activeGroups,
    adjustedGroupCount,
    emptyCopy,
    groupMaker,
    groupMakerHint,
    presentStudents,
    rules,
    statusMessage
  } = controller;
  const absentStudentSet = new Set(absentStudents.map((name) => name.toLowerCase()));
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

  const commitGroupRename = () => {
    if (editingGroupIndex === null) {
      return;
    }

    controller.renameGroup(editingGroupIndex, editingGroupName);
    setEditingGroupIndex(null);
  };

  const handleMemberKeyDown = (
    event: ReactKeyboardEvent<HTMLSpanElement>,
    name: string,
    groupIndex: number
  ) => {
    if (!event.altKey) {
      return;
    }

    const delta =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : 0;

    if (delta === 0) {
      return;
    }

    const targetIndex = groupIndex + delta;

    if (targetIndex < 0 || targetIndex >= activeGroups.length) {
      return;
    }

    event.preventDefault();
    controller.moveStudent(name, targetIndex);
    window.requestAnimationFrame(() => {
      groupGridRef.current
        ?.querySelector<HTMLElement>(`[data-student-chip="${CSS.escape(name)}"]`)
        ?.focus();
    });
  };

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
            <div
              className="stepper"
              data-tooltip-content={
                groupingMode === 'size' ? 'Students per group' : 'Number of groups'
              }
            >
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

          {adjustedGroupCount !== null ? (
            <span className="group-maker__adjusted-chip">
              adjusted to {adjustedGroupCount} groups
            </span>
          ) : null}
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
            aria-haspopup="dialog"
            aria-label="Saved group sets"
            className="secondary-link button-tone--utility"
            data-compact-icon="▤"
            data-tooltip-content="Save or load a set of groups"
            disabled={!controller.selectedList}
            onClick={() => setIsSetsDialogOpen(true)}
            type="button"
          >
            Sets
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
            {activeGroups.map((group, index) => {
              const groupLabel = getGroupLabel(groupMaker.groupNames, index);

              return (
                <article
                  className={`group-card${
                    dragOverGroupIndex === index && draggedStudent !== null
                      ? ' group-card--drag-over'
                      : ''
                  }`}
                  key={`group-${index + 1}`}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                      setDragOverGroupIndex((current) => (current === index ? null : current));
                    }
                  }}
                  onDragOver={(event) => {
                    if (draggedStudent === null) {
                      return;
                    }

                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDragOverGroupIndex((current) => (current === index ? current : index));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const studentName = draggedStudent ?? event.dataTransfer.getData('text/plain');
                    setDraggedStudent(null);
                    setDragOverGroupIndex(null);

                    if (studentName) {
                      controller.moveStudent(studentName, index);
                    }
                  }}
                >
                  <div className="group-card__header">
                    {editingGroupIndex === index ? (
                      <input
                        aria-label={`Group ${index + 1} name`}
                        autoFocus
                        className="text-field group-card__title-input"
                        maxLength={40}
                        onBlur={commitGroupRename}
                        onChange={(event) => setEditingGroupName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitGroupRename();
                          } else if (event.key === 'Escape') {
                            event.stopPropagation();
                            setEditingGroupIndex(null);
                          }
                        }}
                        value={editingGroupName}
                      />
                    ) : (
                      <button
                        aria-label={`Rename ${groupLabel}`}
                        className="group-card__title group-card__title-button"
                        data-tooltip-content="Rename this group"
                        onClick={() => {
                          setEditingGroupIndex(index);
                          setEditingGroupName(groupMaker.groupNames[index]?.trim() ?? '');
                        }}
                        type="button"
                      >
                        {groupLabel}
                      </button>
                    )}
                    <span className="group-card__count">{group.length}</span>
                    <button
                      aria-label={`Reshuffle ${groupLabel}`}
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
                    {group.map((name) => {
                      const isAway = absentStudentSet.has(name.toLowerCase());

                      return (
                        <span
                          aria-label={`${name}${isAway ? ', away' : ''}, ${groupLabel}. Alt plus arrow keys moves groups.`}
                          className={`group-member-list__item${
                            isAway ? ' group-member-list__item--away' : ''
                          }`}
                          data-student-chip={name}
                          draggable
                          key={`${index}-${name}`}
                          onDragEnd={() => {
                            setDraggedStudent(null);
                            setDragOverGroupIndex(null);
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', name);
                            setDraggedStudent(name);
                          }}
                          onKeyDown={(event) => handleMemberKeyDown(event, name, index)}
                          tabIndex={0}
                        >
                          {name}
                          {isAway ? (
                            <span aria-hidden="true" className="group-member-list__away-tag">
                              away
                            </span>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="action-row group-maker__share-row">
            <button
              aria-label="Present groups to the class"
              className="secondary-link button-tone--utility"
              data-compact-icon="⛶"
              data-tooltip-content="Show the groups full-window for the class"
              onClick={() => setIsPresenting(true)}
              type="button"
            >
              Present
            </button>
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

      {isSetsDialogOpen && controller.selectedList ? (
        <GroupSetsDialog controller={controller} onClose={() => setIsSetsDialogOpen(false)} />
      ) : null}

      {isPresenting && activeGroups.length > 0 && controller.selectedList ? (
        <GroupPresentDisplay
          absentStudents={absentStudents}
          className={controller.selectedList.name}
          groupNames={groupMaker.groupNames}
          groups={activeGroups}
          onClose={() => setIsPresenting(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Full-window "class display" for projecting the groups. Escape or any click
 * closes it.
 */
export function GroupPresentDisplay({
  absentStudents,
  className,
  groupNames,
  groups,
  onClose
}: {
  absentStudents: string[];
  className: string;
  groupNames: string[];
  groups: string[][];
  onClose: () => void;
}) {
  const { theme } = useColorModeAppearance();
  const absentStudentSet = new Set(absentStudents.map((name) => name.toLowerCase()));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      aria-label={`${className} groups`}
      aria-modal="true"
      className="group-present"
      data-theme={theme}
      onMouseDown={onClose}
      role="dialog"
    >
      <header className="group-present__top">
        <span className="group-present__kicker">{className}</span>
        <button
          aria-label="Exit group display"
          className="widget-icon-button widget-icon-button--close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>
      <div className="group-present__grid">
        {groups.map((group, index) => (
          <section className="group-present__card" key={`present-group-${index + 1}`}>
            <h2 className="group-present__title">{getGroupLabel(groupNames, index)}</h2>
            <ul className="group-present__members">
              {group.map((name) => (
                <li
                  className={`group-present__member${
                    absentStudentSet.has(name.toLowerCase()) ? ' group-present__member--away' : ''
                  }`}
                  key={name}
                >
                  {name}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>,
    document.body
  );
}

export function GroupSetsDialog({
  controller,
  onClose
}: {
  controller: GroupMakerWidgetController;
  onClose: () => void;
}) {
  const { theme } = useColorModeAppearance();
  const [setName, setSetName] = useState('');
  const canSaveSet = controller.activeGroups.length > 0;

  const saveCurrentSet = () => {
    if (!canSaveSet) {
      return;
    }

    controller.saveGroupSet(setName);
    setSetName('');
  };

  return (
    <WidgetDialog
      className="group-sets-dialog"
      kicker={controller.selectedList?.name}
      onClose={onClose}
      theme={theme}
      title="Group sets"
    >
      <div className="group-sets__save-row">
        <input
          aria-label="Name for the saved set"
          className="text-field"
          data-autofocus
          disabled={!canSaveSet}
          maxLength={60}
          onChange={(event) => setSetName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              saveCurrentSet();
            }
          }}
          placeholder={canSaveSet ? 'Set name' : 'Shuffle groups first'}
          type="text"
          value={setName}
        />
        <button
          className="primary-link"
          disabled={!canSaveSet}
          onClick={saveCurrentSet}
          type="button"
        >
          Save set
        </button>
      </div>

      {controller.savedSets.length > 0 ? (
        <ul className="group-sets__list">
          {[...controller.savedSets].reverse().map((set) => (
            <li className="group-sets__item" key={set.id}>
              <div className="group-sets__meta">
                <span className="group-sets__name">{set.name}</span>
                <span className="group-sets__detail">
                  {set.groups.length} groups ·{' '}
                  {set.groups.reduce((total, group) => total + group.length, 0)} students
                </span>
              </div>
              <div className="group-sets__actions">
                <button
                  aria-label={`Load set ${set.name}`}
                  className="secondary-link"
                  onClick={() => {
                    controller.loadGroupSet(set.id);
                    onClose();
                  }}
                  type="button"
                >
                  Load
                </button>
                <button
                  aria-label={`Delete set ${set.name}`}
                  className="group-rules__chip-remove"
                  onClick={() => controller.deleteGroupSet(set.id)}
                  type="button"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">No saved sets yet.</p>
      )}
    </WidgetDialog>
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

  const addDefaultRule = () => {
    if (canAddRule) {
      controller.addRule('apart', firstStudent, secondStudent);
    }
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
            <StudentCombobox
              label="Student"
              onSelect={setFirstStudent}
              onSubmit={addDefaultRule}
              selected={firstStudent}
              students={students}
            />
            <StudentCombobox
              label="Student"
              onSelect={setSecondStudent}
              onSubmit={addDefaultRule}
              selected={secondStudent}
              students={students}
            />
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
  const statusTimeoutRef = useRef<number | null>(null);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const selectedStudents = selectedList?.students ?? [];
  const absentStudents = getAbsentStudentsForList(picker, selectedList);
  const presentStudents = filterAbsentStudents(selectedStudents, absentStudents);
  const rules = getGroupRulesForList(groupRules, selectedList?.id ?? null, selectedStudents);
  // Groups stay visible while every grouped student is still on the roster, so
  // marking someone absent dims their chip instead of wiping the shuffle.
  const rosterNameSet = new Set(selectedStudents.map((name) => name.toLowerCase()));
  const groupsMatchRoster =
    groupMaker.sourceStudents.length > 0 &&
    groupMaker.sourceStudents.every((name) => rosterNameSet.has(name.toLowerCase()));
  const activeGroups =
    selectedList && groupMaker.listId === selectedList.id && groupsMatchRoster
      ? groupMaker.groups
      : [];
  const groupCount = activeGroups.length;
  const apartViolations = countApartViolationsInGroups(activeGroups, rules.apart);
  const togetherSatisfied = groupsSatisfyTogetherRules(activeGroups, rules.together);
  const savedSets = selectedList ? groupMaker.savedSetsByListId[selectedList.id] ?? [] : [];
  const requestedGroupCount =
    groupMaker.groupingMode === 'count'
      ? groupMaker.groupCount
      : presentStudents.length > 0
        ? Math.ceil(
            presentStudents.length / clampNumber(groupMaker.groupSize, GROUP_SIZE_MIN, GROUP_SIZE_MAX)
          )
        : 0;
  const effectiveGroupCount = getStudentGroupCount(presentStudents.length, groupMaker);
  const adjustedGroupCount =
    presentStudents.length >= 2 && effectiveGroupCount > 0 && effectiveGroupCount < requestedGroupCount
      ? effectiveGroupCount
      : null;

  const hideStatus = () => {
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }

    setStatusMessage(null);
  };

  const showStatus = (message: string) => {
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
    }

    setStatusMessage(message);
    announce(message);
    statusTimeoutRef.current = window.setTimeout(() => {
      statusTimeoutRef.current = null;
      setStatusMessage(null);
    }, GROUP_STATUS_TIMEOUT_MS);
  };

  useEffect(() => {
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }

    setStatusMessage(null);
  }, [selectedList?.id]);

  useEffect(
    () => () => {
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
      }
    },
    []
  );

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
    const previous = {
      groups: groupMaker.groups,
      listId: groupMaker.listId,
      sourceStudents: groupMaker.sourceStudents
    };

    hideStatus();
    setGroupMaker((current) => ({
      ...current,
      groups: [],
      listId: null,
      sourceStudents: []
    }));
    showUndoToast('Cleared groups', () => {
      setGroupMaker((current) => ({ ...current, ...previous }));
    });
  };

  const makeGroups = () => {
    if (!selectedList || presentStudents.length < 2) {
      return;
    }

    const buildOptions = {
      groupCount: groupMaker.groupCount,
      groupSize: groupMaker.groupSize,
      groupingMode: groupMaker.groupingMode,
      rules
    };
    const previousPairKeys = collectGroupPairKeys(
      groupMaker.lastCompositionByListId[selectedList.id] ?? []
    );
    let bestGroups = buildStudentGroupsWithRules(presentStudents, buildOptions);

    if (previousPairKeys.size > 0) {
      let bestScore = scoreGroupAttempt(bestGroups, rules, previousPairKeys);

      for (let attempt = 1; attempt < GROUP_REPEAT_AVOID_ATTEMPTS && bestScore > 0; attempt += 1) {
        const candidate = buildStudentGroupsWithRules(presentStudents, buildOptions);
        const score = scoreGroupAttempt(candidate, rules, previousPairKeys);

        if (score < bestScore) {
          bestGroups = candidate;
          bestScore = score;
        }
      }
    }

    hideStatus();
    setGroupMaker((current) => ({
      ...current,
      groups: bestGroups,
      lastCompositionByListId: {
        ...current.lastCompositionByListId,
        [selectedList.id]: bestGroups.map((group) => [...group])
      },
      listId: selectedList.id,
      sourceStudents: [...presentStudents]
    }));
  };

  const reshuffleGroup = (groupIndex: number) => {
    if (activeGroups.length < 2) {
      return;
    }

    const groupLabel = getGroupLabel(groupMaker.groupNames, groupIndex);
    const nextGroups = reshuffleSingleGroup(activeGroups, groupIndex, rules);

    if (!nextGroups) {
      showStatus(`No rule-friendly swaps were available for ${groupLabel}. Try a full shuffle.`);
      return;
    }

    showStatus(`Reshuffled ${groupLabel} without touching the other groups.`);
    setGroupMaker((current) => ({
      ...current,
      groups: nextGroups
    }));
  };

  const moveStudent = (studentName: string, targetGroupIndex: number) => {
    const fromIndex = activeGroups.findIndex((group) =>
      group.some((name) => name.toLowerCase() === studentName.toLowerCase())
    );

    if (
      fromIndex === -1 ||
      fromIndex === targetGroupIndex ||
      targetGroupIndex < 0 ||
      targetGroupIndex >= activeGroups.length
    ) {
      return;
    }

    setGroupMaker((current) => {
      const groups = current.groups.map((group) => [...group]);

      if (!groups[fromIndex] || !groups[targetGroupIndex]) {
        return current;
      }

      const moved = groups[fromIndex].find(
        (name) => name.toLowerCase() === studentName.toLowerCase()
      );

      if (!moved) {
        return current;
      }

      groups[fromIndex] = groups[fromIndex].filter(
        (name) => name.toLowerCase() !== studentName.toLowerCase()
      );
      groups[targetGroupIndex] = [...groups[targetGroupIndex], moved];
      return { ...current, groups };
    });
    announce(`Moved ${studentName} to ${getGroupLabel(groupMaker.groupNames, targetGroupIndex)}`);
  };

  const renameGroup = (groupIndex: number, name: string) => {
    setGroupMaker((current) => {
      const groupNames = [...current.groupNames];

      while (groupNames.length <= groupIndex) {
        groupNames.push('');
      }

      groupNames[groupIndex] = name.trim();
      return { ...current, groupNames };
    });
  };

  const saveGroupSet = (name: string) => {
    if (!selectedList || activeGroups.length === 0) {
      return;
    }

    const dateLabel = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short'
    }).format(new Date());
    const setName = name.trim() || `Groups ${dateLabel}`;
    const nextSet: SavedGroupSet = {
      createdAt: Date.now(),
      groupNames: [...groupMaker.groupNames],
      groups: activeGroups.map((group) => [...group]),
      id: createStickyNoteId(),
      name: setName
    };

    setGroupMaker((current) => ({
      ...current,
      savedSetsByListId: {
        ...current.savedSetsByListId,
        [selectedList.id]: [
          ...(current.savedSetsByListId[selectedList.id] ?? []),
          nextSet
        ].slice(-SAVED_GROUP_SET_LIMIT)
      }
    }));
    showStatus(`Saved "${setName}".`);
  };

  const loadGroupSet = (setId: string) => {
    if (!selectedList) {
      return;
    }

    const set = (groupMaker.savedSetsByListId[selectedList.id] ?? []).find(
      (candidate) => candidate.id === setId
    );

    if (!set) {
      return;
    }

    const entries = set.groups
      .map((group, index) => ({
        members: group.filter((name) => rosterNameSet.has(name.toLowerCase())),
        name: set.groupNames[index] ?? ''
      }))
      .filter((entry) => entry.members.length > 0);

    if (entries.length === 0) {
      showStatus('None of the saved students are on this class list anymore.');
      return;
    }

    setGroupMaker((current) => ({
      ...current,
      groupNames: entries.map((entry) => entry.name),
      groups: entries.map((entry) => entry.members),
      listId: selectedList.id,
      sourceStudents: entries.flatMap((entry) => entry.members)
    }));
    showStatus(`Loaded "${set.name}".`);
  };

  const deleteGroupSet = (setId: string) => {
    if (!selectedList) {
      return;
    }

    const listId = selectedList.id;
    const currentSets = groupMaker.savedSetsByListId[listId] ?? [];
    const set = currentSets.find((candidate) => candidate.id === setId);

    if (!set) {
      return;
    }

    setGroupMaker((current) => ({
      ...current,
      savedSetsByListId: {
        ...current.savedSetsByListId,
        [listId]: (current.savedSetsByListId[listId] ?? []).filter(
          (candidate) => candidate.id !== setId
        )
      }
    }));
    showUndoToast(`Deleted "${set.name}"`, () => {
      setGroupMaker((current) => ({
        ...current,
        savedSetsByListId: { ...current.savedSetsByListId, [listId]: currentSets }
      }));
    });
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
      await navigator.clipboard.writeText(
        formatGroupsAsText(activeGroups, selectedList.name, groupMaker.groupNames)
      );
      showStatus('Copied the groups as text.');
    } catch {
      showStatus('Copying failed. Try again after clicking inside the app.');
    }
  };

  const sendGroupsToNote = () => {
    if (activeGroups.length === 0 || !selectedList) {
      return;
    }

    const noteText = formatGroupsAsText(activeGroups, selectedList.name, groupMaker.groupNames);

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
    showStatus('Saved the groups to a sticky note, so the shuffle is safe to clear.');
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
    showStatus(
      seatedEveryone
        ? 'Placed each group onto neighbouring seats in the active layout.'
        : 'Placed the groups, but the layout needs more seats to fit everyone.'
    );
  };

  return {
    absentStudents,
    activeGroups,
    addRule,
    adjustedGroupCount,
    clearGroups,
    copyGroupsToClipboard,
    deleteGroupSet,
    emptyCopy: selectedList ? 'Shuffle to make groups.' : 'Choose a class to make groups.',
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
    loadGroupSet,
    makeGroups,
    moveStudent,
    presentStudents,
    removeRule,
    renameGroup,
    reshuffleGroup,
    rules,
    saveGroupSet,
    savedSets,
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
    groupNames?: unknown[];
    groupSize?: unknown;
    groupingMode?: unknown;
    groups?: unknown[];
    lastCompositionByListId?: unknown;
    listId?: unknown;
    savedSetsByListId?: unknown;
    sourceStudents?: unknown[];
  };
  const lastCompositionByListId: Record<string, string[][]> = {};

  if (nextRaw.lastCompositionByListId && typeof nextRaw.lastCompositionByListId === 'object') {
    for (const [listId, groupsRaw] of Object.entries(
      nextRaw.lastCompositionByListId as Record<string, unknown>
    )) {
      const groups = normalizeStringGroups(groupsRaw).filter((group) => group.length > 0);

      if (groups.length > 0) {
        lastCompositionByListId[listId] = groups;
      }
    }
  }

  const savedSetsByListId: Record<string, SavedGroupSet[]> = {};

  if (nextRaw.savedSetsByListId && typeof nextRaw.savedSetsByListId === 'object') {
    for (const [listId, setsRaw] of Object.entries(
      nextRaw.savedSetsByListId as Record<string, unknown>
    )) {
      if (!Array.isArray(setsRaw)) {
        continue;
      }

      const sets = setsRaw
        .map(normalizeSavedGroupSet)
        .filter((set): set is SavedGroupSet => set !== null)
        .slice(-SAVED_GROUP_SET_LIMIT);

      if (sets.length > 0) {
        savedSetsByListId[listId] = sets;
      }
    }
  }

  return {
    groupCount:
      typeof nextRaw.groupCount === 'number' && Number.isFinite(nextRaw.groupCount)
        ? clampNumber(Math.round(nextRaw.groupCount), GROUP_COUNT_MIN, GROUP_COUNT_MAX)
        : initialValue.groupCount,
    groupNames: Array.isArray(nextRaw.groupNames)
      ? nextRaw.groupNames.map((name) => (isString(name) ? name : ''))
      : initialValue.groupNames,
    groupSize:
      typeof nextRaw.groupSize === 'number' && Number.isFinite(nextRaw.groupSize)
        ? clampNumber(Math.round(nextRaw.groupSize), GROUP_SIZE_MIN, GROUP_SIZE_MAX)
        : initialValue.groupSize,
    groupingMode: nextRaw.groupingMode === 'count' ? 'count' : 'size',
    // Empty groups are kept so manual moves never shift custom names off their
    // cards.
    groups: Array.isArray(nextRaw.groups)
      ? normalizeStringGroups(nextRaw.groups)
      : initialValue.groups,
    lastCompositionByListId,
    listId: typeof nextRaw.listId === 'string' ? nextRaw.listId : null,
    savedSetsByListId,
    sourceStudents: Array.isArray(nextRaw.sourceStudents)
      ? dedupeNames(nextRaw.sourceStudents.filter(isString))
      : initialValue.sourceStudents
  };
}

export function normalizeStringGroups(raw: unknown): string[][] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((group) =>
    Array.isArray(group) ? dedupeNames(group.filter(isString)).filter(Boolean) : []
  );
}

export function normalizeSavedGroupSet(raw: unknown): SavedGroupSet | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    createdAt?: unknown;
    groupNames?: unknown;
    groups?: unknown;
    id?: unknown;
    name?: unknown;
  };

  if (!isString(nextRaw.id) || !nextRaw.id || !isString(nextRaw.name) || !nextRaw.name.trim()) {
    return null;
  }

  const groups = normalizeStringGroups(nextRaw.groups).filter((group) => group.length > 0);

  if (groups.length === 0) {
    return null;
  }

  return {
    createdAt:
      typeof nextRaw.createdAt === 'number' && Number.isFinite(nextRaw.createdAt)
        ? nextRaw.createdAt
        : 0,
    groupNames: Array.isArray(nextRaw.groupNames)
      ? nextRaw.groupNames.map((name) => (isString(name) ? name : ''))
      : [],
    groups,
    id: nextRaw.id,
    name: nextRaw.name
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

/** Collects a `"a|b"` key for every pair of students sharing a group. */
export function collectGroupPairKeys(groups: string[][]) {
  const keys = new Set<string>();

  for (const group of groups) {
    const members = group.map((name) => name.toLowerCase()).sort();

    for (let first = 0; first < members.length; first += 1) {
      for (let second = first + 1; second < members.length; second += 1) {
        keys.add(`${members[first]}|${members[second]}`);
      }
    }
  }

  return keys;
}

export function countRepeatedPairKeys(groups: string[][], previousPairKeys: Set<string>) {
  if (previousPairKeys.size === 0) {
    return 0;
  }

  let repeats = 0;

  for (const key of collectGroupPairKeys(groups)) {
    if (previousPairKeys.has(key)) {
      repeats += 1;
    }
  }

  return repeats;
}

/**
 * Rule violations dominate; repeated pairmates from the previous shuffle only
 * break ties, so avoiding repeats never trades away a rule.
 */
export function scoreGroupAttempt(
  groups: string[][],
  rules: GroupRulesForList,
  previousPairKeys: Set<string>
) {
  return (
    countApartViolationsInGroups(groups, rules.apart) * 1000 +
    (groupsSatisfyTogetherRules(groups, rules.together) ? 0 : 500) +
    countRepeatedPairKeys(groups, previousPairKeys)
  );
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

export function formatGroupsAsText(groups: string[][], className: string, groupNames: string[] = []) {
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short'
  }).format(new Date());
  const lines = groups.map(
    (group, index) => `${getGroupLabel(groupNames, index)}: ${group.join(', ')}`
  );

  return [`${className} groups (${dateLabel})`, ...lines].join('\n');
}
