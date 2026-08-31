import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react';
import { useColorModeAppearance } from '../app/colorMode';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { WidgetDialog, announce, requestConfirm, showUndoToast } from '../shared/uiKit';
import { clampNumber, createStickyNoteId, formatStudentInitials, isString, shuffleNames } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import type { GroupPairRule, GroupRuleKind } from './groupRules';
import {
  StudentCombobox,
  addGroupRule,
  getGroupRulesForList,
  removeGroupRule,
  useGroupRulesState
} from './groupRules';
import { filterAbsentStudents, getAbsentStudentsForList, usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';

export type SeatingChartItemKind = 'seat' | 'teacher-desk' | 'board' | 'door' | 'storage';

export type SeatingChartSeatStyle = 'desk' | 'round';

export type SeatingChartLayoutItem = {
  assignedStudent: string | null;
  color: string;
  id: string;
  kind: SeatingChartItemKind;
  label: string;
  locked: boolean;
  seatStyle: SeatingChartSeatStyle;
  x: number;
  y: number;
};

export type SeatingChartLayout = {
  id: string;
  items: SeatingChartLayoutItem[];
  name: string;
  updatedAt: number;
};

export type SeatingChartClassState = {
  activeLayoutId: string | null;
  layouts: SeatingChartLayout[];
};

export type SeatingChartSnapshot = {
  chartsByListId: Record<string, SeatingChartClassState>;
  generatorOptionsByListId: Record<string, SeatingGeneratorOptions>;
  placementsByListId: Record<string, Record<string, SeatingPlacementZone>>;
  studentNotesByListId: Record<string, Record<string, string>>;
};

/** Where a student should end up when the randomizer runs. */
export type SeatingPlacementZone =
  | 'alone'
  | 'back'
  | 'edge'
  | 'front'
  | 'near-board'
  | 'near-door'
  | 'near-teacher'
  | 'not-near-door';

export type SeatingApartDistance = 1 | 2;

export type SeatingEmptySeatPlacement = 'anywhere' | 'back' | 'spread';

export type SeatingTogetherStyle = 'adjacent' | 'side-by-side';

export type SeatingGeneratorOptions = {
  apartDistance: SeatingApartDistance;
  avoidRepeatNeighbours: boolean;
  emptySeatPlacement: SeatingEmptySeatPlacement;
  respectLockedSeats: boolean;
  togetherStyle: SeatingTogetherStyle;
};

export type SeatingShuffleReport = {
  totalRules: number;
  unmetApartPairs: GroupPairRule[];
  unmetPlacements: { student: string; zone: SeatingPlacementZone }[];
  unmetTogetherPairs: GroupPairRule[];
};

export type SeatingChartTool = 'select' | SeatingChartItemKind | 'erase' | 'rows';

export type SeatingChartDragPayload =
  | {
      itemId: string;
      type: 'item';
    }
  | {
      sourceSeatId: string | null;
      studentName: string;
      type: 'student';
    };

export const SEATING_CHART_GRID_ROWS = 10;

export const SEATING_CHART_GRID_COLUMNS = 12;

export const SEATING_CHART_MIN_SEATS = 12;

export const SEATING_CHART_DRAG_MIME = 'application/x-teachertools-seating';

export const SEATING_CHART_COLOR_SWATCHES = [
  '#5c7cfa',
  '#1d9d7f',
  '#e08a2f',
  '#d35f74',
  '#7b61d1',
  '#3f8ad8',
  '#69717d'
] as const;

export const SEATING_CHART_ITEM_DETAILS: Record<
  SeatingChartItemKind,
  {
    defaultColor: string;
    defaultLabel: string;
    title: string;
  }
> = {
  seat: {
    title: 'Seat',
    defaultLabel: 'Seat',
    defaultColor: '#5c7cfa'
  },
  'teacher-desk': {
    title: 'Teacher Desk',
    defaultLabel: 'Teacher',
    defaultColor: '#1d9d7f'
  },
  board: {
    title: 'Board',
    defaultLabel: 'Board',
    defaultColor: '#e08a2f'
  },
  door: {
    title: 'Door',
    defaultLabel: 'Door',
    defaultColor: '#d35f74'
  },
  storage: {
    title: 'Storage',
    defaultLabel: 'Storage',
    defaultColor: '#69717d'
  }
};

export const DEFAULT_SEATING_CHART: SeatingChartSnapshot = {
  chartsByListId: {},
  generatorOptionsByListId: {},
  placementsByListId: {},
  studentNotesByListId: {}
};

export const DEFAULT_SEATING_GENERATOR_OPTIONS: SeatingGeneratorOptions = {
  apartDistance: 1,
  avoidRepeatNeighbours: false,
  emptySeatPlacement: 'anywhere',
  respectLockedSeats: true,
  togetherStyle: 'adjacent'
};

export const SEATING_PLACEMENT_ZONES: SeatingPlacementZone[] = [
  'front',
  'back',
  'edge',
  'near-teacher',
  'near-board',
  'near-door',
  'not-near-door',
  'alone'
];

export const SEATING_PLACEMENT_ZONE_DETAILS: Record<SeatingPlacementZone, { label: string }> = {
  alone: { label: 'Space around them' },
  back: { label: 'Back rows' },
  edge: { label: 'Edge of a row' },
  front: { label: 'Front rows' },
  'near-board': { label: 'Near the board' },
  'near-door': { label: 'Near the door' },
  'near-teacher': { label: 'Near the teacher desk' },
  'not-near-door': { label: 'Away from the door' }
};

export const SEATING_GENERATOR_RESTARTS = 8;

/** Hard cap on scoring passes per shuffle so huge rooms stay responsive. */
export const SEATING_GENERATOR_MAX_EVALS = 20000;

export const SEATING_UNDO_STACK_LIMIT = 50;

export type SeatingChartTimetableLink = {
  enabled: boolean;
  liveClassName: string | null;
  onToggle: (enabled: boolean) => void;
};

export function SeatingChartWidgetContent({
  controller,
  mode,
  onOpenEditor,
  timetableLink
}: {
  controller: ReturnType<typeof useSeatingChartController>;
  mode: 'dashboard' | 'popout';
  onOpenEditor?: () => void;
  timetableLink?: SeatingChartTimetableLink;
}) {
  const activeLayout = controller.activeLayout;

  if (!controller.selectedList) {
    return (
      <div className="seating-chart seating-chart--empty">
        <div className="group-maker__empty">
          <p className="empty-copy">Choose a class list to start building a seating chart.</p>
        </div>
      </div>
    );
  }

  if (!activeLayout) {
    return (
      <div className="seating-chart seating-chart--empty">
        <div className="group-maker__empty">
          <p className="empty-copy">No layout is available for this class yet.</p>
        </div>
      </div>
    );
  }

  if (mode === 'dashboard') {
    return (
      <SeatingChartDashboardPreview
        activeLayout={activeLayout}
        onOpenEditor={onOpenEditor}
        selectedList={controller.selectedList}
        studentNotes={controller.studentNotes}
        timetableLink={timetableLink}
      />
    );
  }
  return (
    <SeatingChartEditorContent
      activeLayout={activeLayout}
      controller={controller}
      selectedList={controller.selectedList}
    />
  );
}

export function SeatingChartDashboardPreview({
  activeLayout,
  onOpenEditor,
  selectedList,
  studentNotes,
  timetableLink
}: {
  activeLayout: SeatingChartLayout;
  onOpenEditor?: () => void;
  selectedList: ClassList;
  studentNotes: Record<string, string>;
  timetableLink?: SeatingChartTimetableLink;
}) {
  const itemsByCell = new Map(activeLayout.items.map((item) => [getSeatingChartCellKey(item.x, item.y), item]));

  return (
    <div className="seating-chart seating-chart--dashboard-preview">
      {onOpenEditor ? (
        <div className="seating-chart__preview-actions widget-top-controls">
          <button
            aria-label="Open seating chart editor"
            className="primary-link window-spawn-button"
            data-compact-icon="✎"
            onClick={onOpenEditor}
            type="button"
          >
            Open editor
          </button>
        </div>
      ) : null}

      <div className="seating-chart__preview-card">
        <div className="seating-chart__preview-grid" aria-label={`${selectedList.name} seating plan preview`}>
          {Array.from({ length: SEATING_CHART_GRID_ROWS * SEATING_CHART_GRID_COLUMNS }, (_value, index) => {
            const x = index % SEATING_CHART_GRID_COLUMNS;
            const y = Math.floor(index / SEATING_CHART_GRID_COLUMNS);
            const item = itemsByCell.get(getSeatingChartCellKey(x, y)) ?? null;
            const isSeat = item?.kind === 'seat';
            const studentNote = getSeatingStudentNote(item, studentNotes);

            return (
              <div
                className={`seating-chart__preview-cell ${
                  item ? 'seating-chart__preview-cell--occupied' : ''
                }`}
                key={`${x}-${y}`}
              >
                {item ? (
                  <div
                    aria-label={buildSeatingChartItemTitle(item)}
                    className={`seating-chart__preview-item seating-chart__preview-item--${item.kind} ${
                      isSeat ? `seating-chart__preview-item--seat-${item.seatStyle}` : ''
                    } ${item.assignedStudent ? 'seating-chart__preview-item--assigned' : ''}`}
                    data-tooltip-content={
                      studentNote
                        ? `${getSeatingChartPreviewTooltip(item)} — ${studentNote}`
                        : getSeatingChartPreviewTooltip(item)
                    }
                    role="img"
                    style={
                      {
                        ['--seat-colour' as string]: item.color
                      } as CSSProperties
                    }
                  >
                    <span className="seating-chart__preview-token">
                      {getSeatingChartPreviewToken(item)}
                    </span>
                    {studentNote ? (
                      <span aria-hidden="true" className="seating-chart__note-flag seating-chart__note-flag--preview" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="seating-chart__preview-footer">
        {timetableLink ? (
          <label className="seating-chart__follow-toggle">
            <input
              checked={timetableLink.enabled}
              onChange={(event) => timetableLink.onToggle(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>
              Follow timetable
              {timetableLink.enabled && timetableLink.liveClassName
                ? ` (live: ${timetableLink.liveClassName})`
                : ''}
            </span>
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function SeatingChartEditorContent({
  activeLayout,
  controller,
  selectedList
}: {
  activeLayout: SeatingChartLayout;
  controller: ReturnType<typeof useSeatingChartController>;
  selectedList: ClassList;
}) {
  const [editorTab, setEditorTab] = useState<'arrange' | 'assign'>('arrange');
  const [selectedTool, setSelectedTool] = useState<SeatingChartTool>('seat');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedStudentName, setSelectedStudentName] = useState<string | null>(null);
  const [layoutNameDraft, setLayoutNameDraft] = useState(activeLayout.name);
  const [flipView, setFlipView] = useState(false);
  const [rowSeatCount, setRowSeatCount] = useState(6);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [lastShuffleReport, setLastShuffleReport] = useState<SeatingShuffleReport | null>(null);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const copyMenuRef = useRef<HTMLDivElement | null>(null);
  const [draggingSeatAssignmentId, setDraggingSeatAssignmentId] = useState<string | null>(null);
  const [draggingStudentName, setDraggingStudentName] = useState<string | null>(null);
  const [assignmentTargetSeatId, setAssignmentTargetSeatId] = useState<string | null>(null);
  const assignmentGridRef = useRef<HTMLDivElement | null>(null);
  const unseatedDropWellRef = useRef<HTMLDivElement | null>(null);
  const studentPointerDragRef = useRef<{
    originX: number;
    originY: number;
    pointerId: number;
    started: boolean;
    targetSeatId: string | null;
  } & (
    | {
        sourceSeatId: string;
        type: 'seat';
      }
    | {
        sourceSeatId: string | null;
        studentName: string;
        type: 'student';
      }
  ) | null>(null);
  const studentPointerCleanupRef = useRef<(() => void) | null>(null);
  const suppressStudentClickRef = useRef(false);
  const activeItem =
    activeLayout.items.find((item) => item.id === selectedItemId) ?? null;
  const activeSeat = activeItem?.kind === 'seat' ? activeItem : null;
  const showArrangeWorkspace = editorTab === 'arrange';

  // In-memory undo/redo over the active layout. Cleared on layout switch.
  const activeLayoutRef = useRef(activeLayout);
  activeLayoutRef.current = activeLayout;
  const undoStackRef = useRef<SeatingChartLayout[]>([]);
  const redoStackRef = useRef<SeatingChartLayout[]>([]);
  const [, setHistoryVersion] = useState(0);
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  const recordUndoSnapshot = () => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(SEATING_UNDO_STACK_LIMIT - 1)),
      activeLayoutRef.current
    ];
    redoStackRef.current = [];
    setHistoryVersion((version) => version + 1);
  };

  const undoLayoutChange = () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) {
      return;
    }

    const previous = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, activeLayoutRef.current];
    controller.restoreLayout(previous);
    setHistoryVersion((version) => version + 1);
    announce('Undo');
  };

  const redoLayoutChange = () => {
    const stack = redoStackRef.current;
    if (stack.length === 0) {
      return;
    }

    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, activeLayoutRef.current];
    controller.restoreLayout(next);
    setHistoryVersion((version) => version + 1);
    announce('Redo');
  };

  const withHistory =
    <Args extends unknown[]>(action: (...args: Args) => void) =>
    (...args: Args) => {
      recordUndoSnapshot();
      action(...args);
    };

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((version) => version + 1);
    setFlipView(false);
    setLastShuffleReport(null);
  }, [activeLayout.id]);

  useEffect(() => {
    setLayoutNameDraft(activeLayoutRef.current.name);
  }, [activeLayout.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        redoLayoutChange();
      } else {
        undoLayoutChange();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  useEffect(() => {
    if (!copyMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        copyMenuRef.current &&
        event.target instanceof Node &&
        !copyMenuRef.current.contains(event.target)
      ) {
        setCopyMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [copyMenuOpen]);

  useEffect(() => {
    if (!selectedItemId) {
      return;
    }

    if (!activeLayout.items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [activeLayout, selectedItemId]);

  useEffect(() => {
    if (!selectedStudentName) {
      return;
    }

    if (!controller.selectedStudents.includes(selectedStudentName)) {
      setSelectedStudentName(null);
    }
  }, [controller.selectedStudents, selectedStudentName]);

  useEffect(() => {
    if (showArrangeWorkspace) {
      setSelectedStudentName(null);
      setDraggingSeatAssignmentId(null);
      setDraggingStudentName(null);
      setAssignmentTargetSeatId(null);
      studentPointerCleanupRef.current?.();
      studentPointerCleanupRef.current = null;
      studentPointerDragRef.current = null;
    }
  }, [showArrangeWorkspace]);

  useEffect(() => {
    return () => {
      studentPointerCleanupRef.current?.();
      studentPointerCleanupRef.current = null;
      studentPointerDragRef.current = null;
    };
  }, []);

  const handleGridToolAction = (x: number, y: number, itemId: string | null) => {
    if (selectedTool === 'select') {
      setSelectedItemId(itemId);
      return;
    }

    if (selectedTool === 'erase') {
      if (itemId) {
        recordUndoSnapshot();
        controller.removeItem(itemId);
      }
      setSelectedItemId(null);
      return;
    }

    if (selectedTool === 'rows') {
      if (!itemId) {
        recordUndoSnapshot();
        controller.setItemAtCell('seat', x, y);
      }
      return;
    }

    recordUndoSnapshot();
    controller.setItemAtCell(selectedTool, x, y);
    const nextItem =
      getSeatingChartCellItem(
        activeLayout.items.map((item) =>
          itemId && item.id === itemId
            ? resetSeatingChartItemKind(item, selectedTool, activeLayout.items)
            : item
        ),
        x,
        y
      ) ?? null;
    setSelectedItemId(nextItem?.id ?? itemId);
  };

  const handlePaintStart = () => {
    recordUndoSnapshot();
  };

  const handlePaintCell = (x: number, y: number) => {
    const item = getSeatingChartCellItem(activeLayoutRef.current.items, x, y);

    if (selectedTool === 'erase') {
      if (item) {
        controller.removeItem(item.id);
        setSelectedItemId(null);
      }
      return;
    }

    if (!item) {
      controller.setItemAtCell('seat', x, y);
    }
  };

  const assignStudentToSeatWithAnnounce = (
    studentName: string,
    targetSeatId: string,
    sourceSeatId: string | null = null
  ) => {
    recordUndoSnapshot();
    controller.assignStudentToSeat(studentName, targetSeatId, sourceSeatId);
    const seat = activeLayoutRef.current.items.find((item) => item.id === targetSeatId);
    announce(seat ? `${studentName} assigned to seat ${seat.label}` : `${studentName} assigned`);
  };

  const seatingRuleCount =
    controller.apartPairs.length +
    controller.togetherPairs.length +
    Object.keys(controller.studentPlacements).length;

  const handleReshuffle = () => {
    recordUndoSnapshot();
    const report = controller.reshuffleAssignments();
    setLastShuffleReport(report);
    if (report) {
      announce(describeSeatingShuffleReport(report));
    }
  };

  const handleClearAssignments = () => {
    const previous = activeLayoutRef.current;
    recordUndoSnapshot();
    controller.clearAssignments();
    showUndoToast('Cleared seat assignments', () => {
      recordUndoSnapshot();
      controller.restoreLayout(previous);
    });
  };

  const handleDeleteLayout = async () => {
    const layout = activeLayoutRef.current;
    const layoutName = activeLayoutNameForSeatingChart(layout);
    const confirmed = await requestConfirm({
      confirmLabel: 'Delete',
      title: `Delete "${layoutName}"?`,
      tone: 'danger'
    });

    if (!confirmed) {
      return;
    }

    controller.deleteActiveLayout();
    showUndoToast(`Deleted "${layoutName}"`, () => controller.restoreDeletedLayout(layout));
  };

  const commitLayoutName = () => {
    if (layoutNameDraft !== activeLayoutRef.current.name) {
      controller.renameActiveLayout(layoutNameDraft);
    }
  };

  const handleCopyToList = (targetList: ClassList) => {
    controller.copyActiveLayoutToList(targetList);
    setCopyMenuOpen(false);
    showUndoToast(`Copied layout to ${targetList.name}`);
  };

  const handleDropToUnseated = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = readSeatingChartDragPayload(event.dataTransfer);

    if (payload?.type === 'student' && payload.sourceSeatId) {
      recordUndoSnapshot();
      controller.clearSeatAssignment(payload.sourceSeatId);
    }
  };

  const getSeatIdFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const seatElement = element?.closest<HTMLElement>('[data-seat-id]') ?? null;

    if (!seatElement || !assignmentGridRef.current || !assignmentGridRef.current.contains(seatElement)) {
      return null;
    }

    return seatElement.dataset.seatId ?? null;
  };

  const isPointInUnseatedDropWell = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const dropWell = element?.closest<HTMLElement>('[data-unseated-drop-zone="true"]') ?? null;

    return Boolean(
      dropWell &&
        unseatedDropWellRef.current &&
        unseatedDropWellRef.current.contains(dropWell)
    );
  };

  const finishStudentPointerDrag = (clientX?: number, clientY?: number) => {
    const activeDrag = studentPointerDragRef.current;
    studentPointerCleanupRef.current?.();
    studentPointerCleanupRef.current = null;

    if (!activeDrag) {
      return;
    }

    const targetSeatId =
      typeof clientX === 'number' && typeof clientY === 'number'
        ? getSeatIdFromPoint(clientX, clientY)
        : activeDrag.targetSeatId;

    if (activeDrag.started) {
      suppressStudentClickRef.current = true;
    }

    if (activeDrag.started && targetSeatId) {
      if (activeDrag.type === 'seat') {
        recordUndoSnapshot();
        controller.swapSeatAssignments(activeDrag.sourceSeatId, targetSeatId);
      } else {
        assignStudentToSeatWithAnnounce(activeDrag.studentName, targetSeatId, activeDrag.sourceSeatId);
      }
      setSelectedItemId(targetSeatId);
      setSelectedStudentName(null);
    } else if (
      activeDrag.started &&
      activeDrag.sourceSeatId &&
      typeof clientX === 'number' &&
      typeof clientY === 'number' &&
      isPointInUnseatedDropWell(clientX, clientY)
    ) {
      recordUndoSnapshot();
      controller.clearSeatAssignment(activeDrag.sourceSeatId);
      setSelectedItemId(activeDrag.sourceSeatId);
      setSelectedStudentName(null);
    }

    studentPointerDragRef.current = null;
    setDraggingSeatAssignmentId(null);
    setDraggingStudentName(null);
    setAssignmentTargetSeatId(null);
  };

  const cancelStudentPointerDrag = () => {
    studentPointerCleanupRef.current?.();
    studentPointerCleanupRef.current = null;
    studentPointerDragRef.current = null;
    setDraggingSeatAssignmentId(null);
    setDraggingStudentName(null);
    setAssignmentTargetSeatId(null);
  };

  const startAssignmentPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    payload:
      | {
          sourceSeatId: string;
          type: 'seat';
        }
      | {
          sourceSeatId: string | null;
          studentName: string;
          type: 'student';
        }
  ) => {
    if (showArrangeWorkspace) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    studentPointerDragRef.current = {
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
      started: false,
      targetSeatId: getSeatIdFromPoint(event.clientX, event.clientY),
      ...payload
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const activeDrag = studentPointerDragRef.current;

      if (!activeDrag || moveEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      const movedEnough =
        activeDrag.started ||
        Math.hypot(moveEvent.clientX - activeDrag.originX, moveEvent.clientY - activeDrag.originY) >= 4;

      if (!movedEnough) {
        return;
      }

      if (!activeDrag.started) {
        activeDrag.started = true;
        if (activeDrag.type === 'seat') {
          setDraggingSeatAssignmentId(activeDrag.sourceSeatId);
        } else {
          setDraggingStudentName(activeDrag.studentName);
        }
      }

      const targetSeatId = getSeatIdFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (activeDrag.targetSeatId !== targetSeatId) {
        activeDrag.targetSeatId = targetSeatId;
        setAssignmentTargetSeatId(targetSeatId);
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const activeDrag = studentPointerDragRef.current;

      if (!activeDrag || upEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      finishStudentPointerDrag(upEvent.clientX, upEvent.clientY);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      const activeDrag = studentPointerDragRef.current;

      if (!activeDrag || cancelEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      cancelStudentPointerDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    studentPointerCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  };

  const startStudentPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    studentName: string,
    sourceSeatId: string | null
  ) => {
    startAssignmentPointerDrag(event, {
      sourceSeatId,
      studentName,
      type: 'student'
    });
  };

  const startSeatAssignmentPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    sourceSeatId: string
  ) => {
    startAssignmentPointerDrag(event, {
      sourceSeatId,
      type: 'seat'
    });
  };

  const handleStudentPillClick = (studentName: string) => {
    if (suppressStudentClickRef.current) {
      suppressStudentClickRef.current = false;
      return;
    }

    setSelectedStudentName((current) => (current === studentName ? null : studentName));
  };

  const handleSeatActivate = (seatId: string) => {
    setSelectedItemId(seatId);

    if (!selectedStudentName) {
      return;
    }

    assignStudentToSeatWithAnnounce(selectedStudentName, seatId);
    setSelectedStudentName(null);
  };

  return (
    <div className="seating-chart seating-chart--popout">
      <div className="seating-chart__toolbar">
        <div className="field-stack seating-chart__layout-field">
          <label className="field-label" htmlFor="seating-chart-layout-editor">
            Layout
          </label>
          <select
            className="text-field seating-chart__layout-select"
            id="seating-chart-layout-editor"
            onChange={(event) => {
              controller.selectLayout(event.target.value);
              setSelectedItemId(null);
            }}
            value={activeLayout.id}
          >
            {controller.layoutOptions.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-stack seating-chart__layout-field seating-chart__layout-field--name">
          <label className="field-label" htmlFor="seating-chart-layout-name">
            Name
          </label>
          <input
            className="text-field"
            id="seating-chart-layout-name"
            onBlur={commitLayoutName}
            onChange={(event) => setLayoutNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            placeholder="Layout name"
            type="text"
            value={layoutNameDraft}
          />
        </div>

        <div className="seating-chart__toolbar-actions">
          <button
            aria-label="Undo"
            className="text-toggle button-tone--utility seating-chart__history-button"
            data-tooltip-content="Undo (⌘Z)"
            disabled={!canUndo}
            onClick={undoLayoutChange}
            type="button"
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            className="text-toggle button-tone--utility seating-chart__history-button"
            data-tooltip-content="Redo (⇧⌘Z)"
            disabled={!canRedo}
            onClick={redoLayoutChange}
            type="button"
          >
            ↷
          </button>
          <button
            className="primary-link"
            onClick={controller.addLayout}
            type="button"
          >
            New layout
          </button>
          <button
            className="secondary-link button-tone--utility"
            onClick={controller.duplicateActiveLayout}
            type="button"
          >
            Duplicate
          </button>
          <div className="seating-chart__copy-menu-wrap" ref={copyMenuRef}>
            <button
              aria-expanded={copyMenuOpen}
              aria-haspopup="menu"
              className="secondary-link button-tone--utility"
              disabled={controller.otherLists.length === 0}
              onClick={() => setCopyMenuOpen((open) => !open)}
              type="button"
            >
              Copy to class…
            </button>
            {copyMenuOpen ? (
              <div className="seating-chart__copy-menu" role="menu">
                {controller.otherLists.map((list) => (
                  <button
                    className="seating-chart__copy-menu-item"
                    key={list.id}
                    onClick={() => handleCopyToList(list)}
                    role="menuitem"
                    type="button"
                  >
                    {list.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className={`text-toggle button-tone--utility ${flipView ? 'text-toggle--active' : ''}`}
            data-tooltip-content="Rotate 180° for reading while facing the class"
            onClick={() => setFlipView((flipped) => !flipped)}
            type="button"
          >
            Flip view
          </button>
          <button
            aria-label="Export this layout as a PNG image"
            className="secondary-link button-tone--utility"
            data-tooltip-content="Save a printable image for a relief teacher"
            onClick={() => controller.exportActiveLayoutPng(flipView)}
            type="button"
          >
            Export PNG
          </button>
          <button
            aria-label="Copy this layout as a PNG image"
            className="secondary-link button-tone--utility"
            onClick={() => controller.copyActiveLayoutPng(flipView)}
            type="button"
          >
            Copy PNG
          </button>
          <button
            className="danger-link"
            disabled={!controller.canDeleteLayout}
            onClick={() => {
              void handleDeleteLayout();
            }}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="seating-chart__stats">
        <article className="seating-chart__stat">
          <span className="seating-chart__stat-label">Seated</span>
          <strong>
            {controller.assignedSeatCount}/{controller.selectedStudents.length}
          </strong>
        </article>
        <article className="seating-chart__stat">
          <span className="seating-chart__stat-label">Seats</span>
          <strong>{controller.seatCount}</strong>
        </article>
        <article className="seating-chart__stat">
          <span className="seating-chart__stat-label">Layouts</span>
          <strong>{controller.layoutCount}</strong>
        </article>
      </div>

      <div className="segmented-row seating-chart__mode-tabs">
        <button
          className={`text-toggle button-tone--utility ${
            editorTab === 'arrange' ? 'text-toggle--active' : ''
          }`}
          onClick={() => setEditorTab('arrange')}
          type="button"
        >
          Arrange room
        </button>
        <button
          className={`text-toggle button-tone--utility ${
            editorTab === 'assign' ? 'text-toggle--active' : ''
          }`}
          onClick={() => setEditorTab('assign')}
          type="button"
        >
          Assign students
        </button>
      </div>

      <div className={`seating-chart__workspace ${showArrangeWorkspace ? 'seating-chart__workspace--editor' : ''}`}>
        <div className="seating-chart__workspace-main">
          {showArrangeWorkspace ? (
            <div className="seating-chart__tool-row">
              {(['select', 'seat', 'rows', 'teacher-desk', 'board', 'door', 'storage', 'erase'] as const).map(
                (tool) => (
                  <button
                    className={`text-toggle ${getSeatingChartToolToneClass(tool)} ${
                      selectedTool === tool ? 'text-toggle--active' : ''
                    }`}
                    data-tooltip-content={
                      tool === 'rows'
                        ? 'Drag to paint seats'
                        : tool === 'erase'
                          ? 'Click or drag to erase'
                          : undefined
                    }
                    key={tool}
                    onClick={() => setSelectedTool(tool)}
                    type="button"
                  >
                    {tool === 'select'
                      ? 'Select'
                      : tool === 'erase'
                        ? 'Erase'
                        : tool === 'rows'
                          ? 'Rows'
                          : SEATING_CHART_ITEM_DETAILS[tool].title}
                  </button>
                )
              )}
            </div>
          ) : null}

          <SeatingChartGrid
            assignmentTargetSeatId={assignmentTargetSeatId}
            compact={false}
            flipped={flipView}
            onGridElementChange={(element) => {
              assignmentGridRef.current = element;
            }}
            layout={activeLayout}
            draggingSeatAssignmentId={draggingSeatAssignmentId}
            mode={showArrangeWorkspace ? 'arrange' : 'assign'}
            onGridToolAction={handleGridToolAction}
            onMoveItem={withHistory(controller.moveItem)}
            onPaintCell={handlePaintCell}
            onPaintStart={handlePaintStart}
            onSelectItem={setSelectedItemId}
            onSeatActivate={handleSeatActivate}
            onSeatAssignmentPointerDown={startSeatAssignmentPointerDrag}
            onStudentDrop={assignStudentToSeatWithAnnounce}
            onStudentTokenPointerDown={startStudentPointerDrag}
            selectedItemId={selectedItemId}
            selectedTool={selectedTool}
            studentNotes={controller.studentNotes}
          />

          <div className="action-row seating-chart__actions">
            <button
              className="secondary-link button-tone--utility"
              data-tooltip-content="Seat the class in roster order, filling from the front"
              disabled={controller.seatCount === 0 || controller.selectedStudents.length === 0}
              onClick={withHistory(controller.autofillAssignments)}
              type="button"
            >
              Fill from front
            </button>
            <button
              className="secondary-link button-tone--utility"
              data-tooltip-content="Seat the class alphabetically, filling from the front"
              disabled={controller.seatCount === 0 || controller.selectedStudents.length === 0}
              onClick={withHistory(controller.autofillAlphabetical)}
              type="button"
            >
              A–Z
            </button>
            <button
              className="secondary-link button-tone--utility"
              data-tooltip-content={
                seatingRuleCount > 0
                  ? `Random seats that try to satisfy all ${seatingRuleCount} rule${
                      seatingRuleCount === 1 ? '' : 's'
                    }`
                  : 'Shuffle everyone onto random seats'
              }
              disabled={controller.seatCount === 0 || controller.selectedStudents.length === 0}
              onClick={handleReshuffle}
              type="button"
            >
              Randomize
            </button>
            <button
              className="secondary-link button-tone--theme"
              data-tooltip-content="Keep-apart and keep-together pairs, seat preferences, and randomizer options"
              onClick={() => setRulesDialogOpen(true)}
              type="button"
            >
              Rules{seatingRuleCount > 0 ? ` (${seatingRuleCount})` : ''}
            </button>
            <button
              className="secondary-link"
              disabled={controller.assignedSeatCount === 0}
              onClick={handleClearAssignments}
              type="button"
            >
              Clear seats
            </button>
          </div>

          {lastShuffleReport && lastShuffleReport.totalRules > 0 ? (
            (() => {
              const unmetRules = listUnmetSeatingRules(lastShuffleReport);

              return unmetRules.length === 0 ? (
                <p className="helper-text seating-chart__shuffle-report">
                  All {lastShuffleReport.totalRules} rule
                  {lastShuffleReport.totalRules === 1 ? '' : 's'} satisfied.
                </p>
              ) : (
                <p className="helper-text seating-chart__shuffle-report seating-chart__shuffle-report--unmet">
                  Couldn&apos;t meet: {unmetRules.slice(0, 4).join(' · ')}
                  {unmetRules.length > 4 ? ` · +${unmetRules.length - 4} more` : ''}
                </p>
              );
            })()
          ) : null}

          {!controller.hasEnoughSeats ? (
            <div className="action-row seating-chart__missing-seats">
              <button
                className="secondary-link button-tone--action"
                onClick={withHistory(() =>
                  controller.appendSeats(controller.selectedStudents.length - controller.seatCount)
                )}
                type="button"
              >
                Add {controller.selectedStudents.length - controller.seatCount} seat
                {controller.selectedStudents.length - controller.seatCount === 1 ? '' : 's'}
              </button>
            </div>
          ) : null}
        </div>

        <aside className="seating-chart__sidebar">
          {!showArrangeWorkspace ? (
            <>
              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Unseated students</span>
                  <span className="badge">{controller.unseatedStudents.length}</span>
                </div>
                <div
                  className="seating-chart__drop-well"
                  data-unseated-drop-zone="true"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDropToUnseated}
                  ref={unseatedDropWellRef}
                >
                  {controller.unseatedStudents.length > 0 ? (
                    controller.unseatedStudents.map((student) => (
                      <button
                        className={`seating-chart__student-pill ${
                          selectedStudentName === student ? 'seating-chart__student-pill--active' : ''
                        } ${draggingStudentName === student ? 'seating-chart__student-pill--dragging' : ''}`}
                        draggable={false}
                        key={student}
                        onClick={() => handleStudentPillClick(student)}
                        onPointerDown={(event) => startStudentPointerDrag(event, student, null)}
                        type="button"
                      >
                        {student}
                      </button>
                    ))
                  ) : (
                    <p className="empty-copy">Everyone in {selectedList.name} is seated.</p>
                  )}
                </div>
              </div>

              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Selected seat</span>
                  {activeSeat?.assignedStudent ? <span className="badge">{activeSeat.assignedStudent}</span> : null}
                </div>
                {activeSeat ? (
                  <>
                    <select
                      className="text-field"
                      onChange={(event) => {
                        if (!event.target.value) {
                          recordUndoSnapshot();
                          controller.clearSeatAssignment(activeSeat.id);
                          return;
                        }

                        assignStudentToSeatWithAnnounce(event.target.value, activeSeat.id);
                      }}
                      value={activeSeat.assignedStudent ?? ''}
                    >
                      <option value="">Unassigned</option>
                      {controller.selectedStudents.map((student) => (
                        <option key={student} value={student}>
                          {student}
                        </option>
                      ))}
                    </select>
                    {activeSeat.assignedStudent ? (
                      <>
                        <label className="field-stack seating-chart__note-field">
                          <span className="field-label">Note for {activeSeat.assignedStudent}</span>
                          <input
                            className="text-field"
                            onChange={(event) =>
                              controller.setStudentNote(
                                activeSeat.assignedStudent ?? '',
                                event.target.value
                              )
                            }
                            placeholder="e.g. glasses, IEP"
                            type="text"
                            value={controller.studentNotes[activeSeat.assignedStudent] ?? ''}
                          />
                        </label>
                        <label className="field-stack seating-chart__note-field">
                          <span className="field-label">Seat preference</span>
                          <select
                            className="text-field"
                            onChange={(event) =>
                              controller.setStudentPlacement(
                                activeSeat.assignedStudent ?? '',
                                event.target.value ? (event.target.value as SeatingPlacementZone) : null
                              )
                            }
                            value={controller.studentPlacements[activeSeat.assignedStudent] ?? ''}
                          >
                            <option value="">No preference</option>
                            {SEATING_PLACEMENT_ZONES.map((zone) => (
                              <option key={zone} value={zone}>
                                {SEATING_PLACEMENT_ZONE_DETAILS[zone].label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    ) : null}
                    <label
                      className="seating-chart__front-toggle"
                      data-tooltip-content={
                        activeSeat.assignedStudent
                          ? 'Randomize keeps this student on this seat'
                          : 'Randomize keeps this seat empty'
                      }
                    >
                      <input
                        checked={activeSeat.locked}
                        onChange={(event) => {
                          const locked = event.currentTarget.checked;
                          recordUndoSnapshot();
                          controller.updateItem(activeSeat.id, (item) => ({
                            ...item,
                            locked
                          }));
                        }}
                        type="checkbox"
                      />
                      <span>Lock during shuffle</span>
                    </label>
                  </>
                ) : (
                  <p className="empty-copy">Select a seat to assign or clear a student.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Quick build</span>
                </div>
                <div className="seating-chart__row-builder">
                  <input
                    aria-label="Seats per row"
                    className="text-field seating-chart__row-count"
                    max={SEATING_CHART_GRID_COLUMNS}
                    min={1}
                    onChange={(event) =>
                      setRowSeatCount(
                        clampNumber(
                          Math.round(Number(event.target.value) || 1),
                          1,
                          SEATING_CHART_GRID_COLUMNS
                        )
                      )
                    }
                    type="number"
                    value={rowSeatCount}
                  />
                  <button
                    className="secondary-link button-tone--action"
                    onClick={withHistory(() => controller.addSeatRow(rowSeatCount))}
                    type="button"
                  >
                    Add row of {rowSeatCount}
                  </button>
                </div>
                <button
                  className="secondary-link button-tone--utility"
                  data-tooltip-content="Number seats top-to-bottom, left-to-right"
                  disabled={controller.seatCount === 0}
                  onClick={withHistory(controller.renumberSeats)}
                  type="button"
                >
                  Renumber seats
                </button>
              </div>

              <div className="seating-chart__sidebar-section">
                <div className="seating-chart__sidebar-head">
                  <span className="field-label">Selected item</span>
                  {activeItem ? (
                    <span className="badge">{SEATING_CHART_ITEM_DETAILS[activeItem.kind].title}</span>
                  ) : null}
                </div>
                {activeItem ? (
                  <>
                    {activeItem.kind !== 'seat' ? (
                      <input
                        className="text-field"
                        onChange={(event) =>
                          controller.updateItem(activeItem.id, (item) => ({
                            ...item,
                            label: event.target.value
                          }))
                        }
                        placeholder="Label"
                        type="text"
                        value={activeItem.label}
                      />
                    ) : null}

                    <div className="seating-chart__swatches">
                      {SEATING_CHART_COLOR_SWATCHES.map((color) => (
                        <button
                          aria-label={`Set item colour to ${color}`}
                          className={`seating-chart__swatch ${
                            activeItem.color === color ? 'seating-chart__swatch--active' : ''
                          }`}
                          key={color}
                          onClick={() => {
                            recordUndoSnapshot();
                            controller.updateItem(activeItem.id, (item) => ({
                              ...item,
                              color
                            }));
                          }}
                          style={{ backgroundColor: color }}
                          type="button"
                        />
                      ))}
                    </div>

                    {activeItem.kind === 'seat' ? (
                      <div className="segmented-row">
                        {(['desk', 'round'] as const).map((seatStyle) => (
                          <button
                            className={`text-toggle button-tone--utility ${
                              activeItem.seatStyle === seatStyle ? 'text-toggle--active' : ''
                            }`}
                            key={seatStyle}
                            onClick={() => {
                              recordUndoSnapshot();
                              controller.updateItem(activeItem.id, (item) => ({
                                ...item,
                                seatStyle
                              }));
                            }}
                            type="button"
                          >
                            {seatStyle === 'desk' ? 'Desk' : 'Round'}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {activeItem.kind === 'seat' ? (
                      <label
                        className="seating-chart__front-toggle"
                        data-tooltip-content="Randomize keeps this seat's student (or leaves it empty)"
                      >
                        <input
                          checked={activeItem.locked}
                          onChange={(event) => {
                            const locked = event.currentTarget.checked;
                            recordUndoSnapshot();
                            controller.updateItem(activeItem.id, (item) => ({
                              ...item,
                              locked
                            }));
                          }}
                          type="checkbox"
                        />
                        <span>Lock during shuffle</span>
                      </label>
                    ) : null}

                    <button
                      className="secondary-link"
                      onClick={() => {
                        recordUndoSnapshot();
                        controller.removeItem(activeItem.id);
                        setSelectedItemId(null);
                      }}
                      type="button"
                    >
                      Remove item
                    </button>
                  </>
                ) : (
                  <p className="empty-copy">Select an item to edit its label, colour, and style.</p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {rulesDialogOpen ? (
        <SeatingRulesDialog
          activeLayout={activeLayout}
          controller={controller}
          onClose={() => setRulesDialogOpen(false)}
          selectedList={selectedList}
        />
      ) : null}
    </div>
  );
}

/**
 * Rules & options for the randomizer. Pair rules are stored in the shared
 * group-rules snapshot so the Group Maker and seating chart stay in sync;
 * placements and generator options live in the seating snapshot per class.
 */
export function SeatingRulesDialog({
  activeLayout,
  controller,
  onClose,
  selectedList
}: {
  activeLayout: SeatingChartLayout;
  controller: ReturnType<typeof useSeatingChartController>;
  onClose: () => void;
  selectedList: ClassList;
}) {
  const { theme } = useColorModeAppearance();
  const [groupRules, setGroupRules] = useGroupRulesState();
  const students = controller.selectedStudents;
  const rules = getGroupRulesForList(groupRules, selectedList.id, students);
  const [firstStudent, setFirstStudent] = useState(students[0] ?? '');
  const [secondStudent, setSecondStudent] = useState(students[1] ?? '');
  const [placementStudent, setPlacementStudent] = useState(students[0] ?? '');
  const [placementZone, setPlacementZone] = useState<SeatingPlacementZone>('front');
  const canAddPair =
    Boolean(firstStudent && secondStudent) &&
    firstStudent.toLowerCase() !== secondStudent.toLowerCase();
  const options = controller.generatorOptions;
  const placements = controller.studentPlacements;
  const layoutKinds = new Set(activeLayout.items.map((item) => item.kind));
  const missingZoneTargets = Object.values(placements)
    .flatMap((zone) => {
      if ((zone === 'near-door' || zone === 'not-near-door') && !layoutKinds.has('door')) {
        return ['a door'];
      }
      if (zone === 'near-teacher' && !layoutKinds.has('teacher-desk')) {
        return ['a teacher desk'];
      }
      if (zone === 'near-board' && !layoutKinds.has('board')) {
        return ['a board'];
      }
      return [];
    })
    .filter((label, index, all) => all.indexOf(label) === index);
  const lockedSeatCount = activeLayout.items.filter(
    (item) => item.kind === 'seat' && item.locked
  ).length;

  const addPairRule = (kind: GroupRuleKind) => {
    if (canAddPair) {
      setGroupRules((current) =>
        addGroupRule(current, selectedList.id, kind, firstStudent, secondStudent)
      );
    }
  };

  const renderPairList = (kind: GroupRuleKind, pairs: GroupPairRule[], emptyCopy: string) => (
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
                onClick={() =>
                  setGroupRules((current) => removeGroupRule(current, selectedList.id, kind, pair))
                }
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

  const renderOptionToggle = <Value extends string | number>(
    label: string,
    choices: { label: string; value: Value }[],
    current: Value,
    onPick: (value: Value) => void
  ) => (
    <div className="seating-rules__option">
      <span className="field-label">{label}</span>
      <div className="segmented-row">
        {choices.map((choice) => (
          <button
            className={`text-toggle button-tone--utility ${
              current === choice.value ? 'text-toggle--active' : ''
            }`}
            key={String(choice.value)}
            onClick={() => onPick(choice.value)}
            type="button"
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <WidgetDialog
      className="seating-rules-dialog"
      kicker={selectedList.name}
      onClose={onClose}
      theme={theme}
      title="Seating rules & options"
      wide
    >
      <p className="helper-text">
        Randomize tries every rule below. Keep-apart pairs weigh heaviest, then
        keep-together pairs, then seat preferences. Pair rules are shared with the
        Group Maker.
      </p>

      <div className="group-rules__builder">
        <StudentCombobox
          label="Student"
          onSelect={setFirstStudent}
          onSubmit={() => addPairRule('apart')}
          selected={firstStudent}
          students={students}
        />
        <StudentCombobox
          label="Student"
          onSelect={setSecondStudent}
          onSubmit={() => addPairRule('apart')}
          selected={secondStudent}
          students={students}
        />
        <div className="group-rules__builder-actions">
          <button
            className="secondary-link"
            disabled={!canAddPair}
            onClick={() => addPairRule('apart')}
            type="button"
          >
            Keep apart
          </button>
          <button
            className="secondary-link button-tone--utility"
            disabled={!canAddPair}
            onClick={() => addPairRule('together')}
            type="button"
          >
            Keep together
          </button>
        </div>
      </div>

      {renderPairList('apart', rules.apart, 'No keep-apart pairs yet.')}
      {renderPairList('together', rules.together, 'No keep-together pairs yet.')}

      <div className="group-rules__section">
        <span className="field-label">Seat preferences</span>
        <div className="seating-rules__placement-builder">
          <StudentCombobox
            label="Student"
            onSelect={setPlacementStudent}
            selected={placementStudent}
            students={students}
          />
          <label className="field-stack">
            <span className="field-label">Should sit</span>
            <select
              className="text-field"
              onChange={(event) => setPlacementZone(event.target.value as SeatingPlacementZone)}
              value={placementZone}
            >
              {SEATING_PLACEMENT_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {SEATING_PLACEMENT_ZONE_DETAILS[zone].label}
                </option>
              ))}
            </select>
          </label>
          <div className="group-rules__builder-actions">
            <button
              className="secondary-link button-tone--action"
              disabled={!placementStudent}
              onClick={() => controller.setStudentPlacement(placementStudent, placementZone)}
              type="button"
            >
              Add preference
            </button>
          </div>
        </div>
        {Object.keys(placements).length > 0 ? (
          <div className="group-rules__list">
            {Object.entries(placements).map(([student, zone]) => (
              <span className="group-rules__chip" key={student}>
                {student} → {SEATING_PLACEMENT_ZONE_DETAILS[zone].label}
                <button
                  aria-label={`Remove seat preference for ${student}`}
                  className="group-rules__chip-remove"
                  onClick={() => controller.setStudentPlacement(student, null)}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="empty-copy">No seat preferences yet.</p>
        )}
        {missingZoneTargets.length > 0 ? (
          <p className="helper-text">
            This layout has no {missingZoneTargets.join(' or ')}, so those preferences are
            skipped until one is added in Arrange.
          </p>
        ) : null}
      </div>

      <div className="group-rules__section">
        <span className="field-label">Randomizer options</span>
        <div className="seating-rules__options">
          {renderOptionToggle(
            'Keep-apart distance',
            [
              { label: 'Not neighbours', value: 1 },
              { label: '2+ seats apart', value: 2 }
            ],
            options.apartDistance,
            (value) => controller.setGeneratorOptions({ apartDistance: value as SeatingApartDistance })
          )}
          {renderOptionToggle(
            'Keep-together means',
            [
              { label: 'Any neighbour', value: 'adjacent' },
              { label: 'Side by side', value: 'side-by-side' }
            ],
            options.togetherStyle,
            (value) =>
              controller.setGeneratorOptions({ togetherStyle: value as SeatingTogetherStyle })
          )}
          {renderOptionToggle(
            'Empty seats go',
            [
              { label: 'Anywhere', value: 'anywhere' },
              { label: 'To the back', value: 'back' },
              { label: 'Spread out', value: 'spread' }
            ],
            options.emptySeatPlacement,
            (value) =>
              controller.setGeneratorOptions({
                emptySeatPlacement: value as SeatingEmptySeatPlacement
              })
          )}
          <label className="seating-chart__front-toggle">
            <input
              checked={options.avoidRepeatNeighbours}
              onChange={(event) =>
                controller.setGeneratorOptions({ avoidRepeatNeighbours: event.currentTarget.checked })
              }
              type="checkbox"
            />
            <span>Avoid repeating current neighbours</span>
          </label>
          <label
            className="seating-chart__front-toggle"
            data-tooltip-content={
              lockedSeatCount > 0
                ? `${lockedSeatCount} seat${lockedSeatCount === 1 ? ' is' : 's are'} locked`
                : 'Lock seats from the sidebar to pin students or hold seats empty'
            }
          >
            <input
              checked={options.respectLockedSeats}
              onChange={(event) =>
                controller.setGeneratorOptions({ respectLockedSeats: event.currentTarget.checked })
              }
              type="checkbox"
            />
            <span>
              Keep locked seats in place
              {lockedSeatCount > 0 ? ` (${lockedSeatCount} locked)` : ''}
            </span>
          </label>
        </div>
      </div>
    </WidgetDialog>
  );
}

export function SeatingChartGrid({
  assignmentTargetSeatId,
  compact,
  draggingSeatAssignmentId,
  flipped = false,
  onGridElementChange,
  layout,
  mode,
  onGridToolAction,
  onMoveItem,
  onPaintCell,
  onPaintStart,
  onSelectItem,
  onSeatActivate,
  onSeatAssignmentPointerDown,
  onStudentDrop,
  onStudentTokenPointerDown,
  selectedItemId,
  selectedTool,
  studentNotes = {}
}: {
  assignmentTargetSeatId: string | null;
  compact: boolean;
  draggingSeatAssignmentId: string | null;
  flipped?: boolean;
  onGridElementChange: (element: HTMLDivElement | null) => void;
  layout: SeatingChartLayout;
  mode: 'arrange' | 'assign';
  onGridToolAction: (x: number, y: number, itemId: string | null) => void;
  onMoveItem: (itemId: string, x: number, y: number) => void;
  onPaintCell?: (x: number, y: number) => void;
  onPaintStart?: () => void;
  onSelectItem: (itemId: string | null) => void;
  onSeatActivate: (seatId: string) => void;
  onSeatAssignmentPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    sourceSeatId: string
  ) => void;
  onStudentDrop: (studentName: string, targetSeatId: string, sourceSeatId: string | null) => void;
  onStudentTokenPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    studentName: string,
    sourceSeatId: string | null
  ) => void;
  selectedItemId: string | null;
  selectedTool: SeatingChartTool;
  studentNotes?: Record<string, string>;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const itemsByCell = new Map(layout.items.map((item) => [getSeatingChartCellKey(item.x, item.y), item]));
  const pointerDragStateRef = useRef<{
    itemId: string;
    originX: number;
    originY: number;
    pointerId: number;
    started: boolean;
    targetCell: { x: number; y: number } | null;
  } | null>(null);
  const pointerDragCleanupRef = useRef<(() => void) | null>(null);
  const paintStateRef = useRef<{
    lastCellKey: string | null;
    pointerId: number;
  } | null>(null);
  const paintCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragTargetCellKey, setDragTargetCellKey] = useState<string | null>(null);
  const [focusCellKey, setFocusCellKey] = useState<string | null>(null);
  const selectedItemCell = selectedItemId
    ? layout.items.find((item) => item.id === selectedItemId) ?? null
    : null;
  const tabbableCellKey =
    focusCellKey ??
    (selectedItemCell
      ? getSeatingChartCellKey(selectedItemCell.x, selectedItemCell.y)
      : getSeatingChartCellKey(0, 0));

  useEffect(() => {
    return () => {
      pointerDragCleanupRef.current?.();
      pointerDragCleanupRef.current = null;
      pointerDragStateRef.current = null;
      paintCleanupRef.current?.();
      paintCleanupRef.current = null;
      paintStateRef.current = null;
    };
  }, []);

  const getCellFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest<HTMLElement>('[data-grid-x][data-grid-y]') ?? null;

    if (!cell || !gridRef.current || !gridRef.current.contains(cell)) {
      return null;
    }

    const x = Number(cell.dataset.gridX);
    const y = Number(cell.dataset.gridY);

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return null;
    }

    return { x, y };
  };

  const syncPointerDragTarget = (clientX: number, clientY: number) => {
    const activeDrag = pointerDragStateRef.current;
    if (!activeDrag) {
      return;
    }

    const targetCell = getCellFromPoint(clientX, clientY);
    const targetCellKey = targetCell ? getSeatingChartCellKey(targetCell.x, targetCell.y) : null;
    const currentCellKey = activeDrag.targetCell
      ? getSeatingChartCellKey(activeDrag.targetCell.x, activeDrag.targetCell.y)
      : null;

    if (targetCellKey === currentCellKey) {
      return;
    }

    activeDrag.targetCell = targetCell;
    setDragTargetCellKey(targetCellKey);
  };

  const finishPointerDrag = (clientX?: number, clientY?: number) => {
    const activeDrag = pointerDragStateRef.current;
    pointerDragCleanupRef.current?.();
    pointerDragCleanupRef.current = null;

    if (!activeDrag) {
      return;
    }

    const targetCell =
      typeof clientX === 'number' && typeof clientY === 'number'
        ? getCellFromPoint(clientX, clientY)
        : activeDrag.targetCell;

    if (activeDrag.started) {
      suppressClickRef.current = true;
    }

    if (activeDrag.started && targetCell) {
      onMoveItem(activeDrag.itemId, targetCell.x, targetCell.y);
      onSelectItem(activeDrag.itemId);
    }

    pointerDragStateRef.current = null;
    setDraggingItemId(null);
    setDragTargetCellKey(null);
  };

  const cancelPointerDrag = () => {
    pointerDragCleanupRef.current?.();
    pointerDragCleanupRef.current = null;
    pointerDragStateRef.current = null;
    setDraggingItemId(null);
    setDragTargetCellKey(null);
  };

  const endPaintSession = () => {
    paintCleanupRef.current?.();
    paintCleanupRef.current = null;
    paintStateRef.current = null;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const startPaintSession = (event: ReactPointerEvent<HTMLElement>, x: number, y: number) => {
    if (
      mode !== 'arrange' ||
      !onPaintCell ||
      (selectedTool !== 'rows' && selectedTool !== 'erase')
    ) {
      return;
    }

    event.preventDefault();
    paintCleanupRef.current?.();
    onPaintStart?.();
    paintStateRef.current = {
      lastCellKey: getSeatingChartCellKey(x, y),
      pointerId: event.pointerId
    };
    onPaintCell(x, y);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const paintState = paintStateRef.current;

      if (!paintState || moveEvent.pointerId !== paintState.pointerId) {
        return;
      }

      const cell = getCellFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!cell) {
        return;
      }

      const cellKey = getSeatingChartCellKey(cell.x, cell.y);
      if (cellKey === paintState.lastCellKey) {
        return;
      }

      paintState.lastCellKey = cellKey;
      onPaintCell(cell.x, cell.y);
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      const paintState = paintStateRef.current;

      if (!paintState || endEvent.pointerId !== paintState.pointerId) {
        return;
      }

      endPaintSession();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    paintCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  };

  const handleCellKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    x: number,
    y: number,
    item: SeatingChartLayoutItem | null
  ) => {
    let deltaX = 0;
    let deltaY = 0;

    if (event.key === 'ArrowLeft') {
      deltaX = -1;
    } else if (event.key === 'ArrowRight') {
      deltaX = 1;
    } else if (event.key === 'ArrowUp') {
      deltaY = -1;
    } else if (event.key === 'ArrowDown') {
      deltaY = 1;
    }

    if (deltaX !== 0 || deltaY !== 0) {
      event.preventDefault();

      if (flipped) {
        deltaX = -deltaX;
        deltaY = -deltaY;
      }

      const nextX = clampNumber(x + deltaX, 0, SEATING_CHART_GRID_COLUMNS - 1);
      const nextY = clampNumber(y + deltaY, 0, SEATING_CHART_GRID_ROWS - 1);
      setFocusCellKey(getSeatingChartCellKey(nextX, nextY));
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-grid-x="${nextX}"][data-grid-y="${nextY}"]`)
        ?.focus();
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();

    if (mode === 'arrange') {
      onGridToolAction(x, y, item?.id ?? null);
      return;
    }

    if (item?.kind === 'seat') {
      onSeatActivate(item.id);
      return;
    }

    onSelectItem(null);
  };

  const startPointerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    itemId: string
  ) => {
    if (mode !== 'arrange' || selectedTool !== 'select') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelectItem(itemId);

    pointerDragStateRef.current = {
      itemId,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
      started: false,
      targetCell: getCellFromPoint(event.clientX, event.clientY)
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const activeDrag = pointerDragStateRef.current;

      if (!activeDrag || moveEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      const movedEnough =
        activeDrag.started ||
        Math.hypot(moveEvent.clientX - activeDrag.originX, moveEvent.clientY - activeDrag.originY) >= 4;

      if (!movedEnough) {
        return;
      }

      if (!activeDrag.started) {
        activeDrag.started = true;
        setDraggingItemId(activeDrag.itemId);
      }

      syncPointerDragTarget(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const activeDrag = pointerDragStateRef.current;

      if (!activeDrag || upEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      finishPointerDrag(upEvent.clientX, upEvent.clientY);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      const activeDrag = pointerDragStateRef.current;

      if (!activeDrag || cancelEvent.pointerId !== activeDrag.pointerId) {
        return;
      }

      cancelPointerDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    pointerDragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  };

  const handleDrop = (
    event: ReactDragEvent<HTMLElement>,
    targetItem: SeatingChartLayoutItem | null,
    x: number,
    y: number
  ) => {
    event.preventDefault();
    const payload = readSeatingChartDragPayload(event.dataTransfer);

    if (!payload) {
      return;
    }

    if (payload.type === 'item' && mode === 'arrange') {
      onMoveItem(payload.itemId, x, y);
      onSelectItem(payload.itemId);
      return;
    }

    if (payload.type === 'student' && mode === 'assign' && targetItem?.kind === 'seat') {
      onStudentDrop(payload.studentName, targetItem.id, payload.sourceSeatId);
      onSelectItem(targetItem.id);
    }
  };

  return (
    <div className={`seating-chart__canvas ${compact ? 'seating-chart__canvas--compact' : ''}`}>
      <div
        aria-colcount={SEATING_CHART_GRID_COLUMNS}
        aria-label="Seating grid"
        aria-rowcount={SEATING_CHART_GRID_ROWS}
        className={`seating-chart__grid seating-chart__grid--${mode} ${
          compact ? 'seating-chart__grid--compact' : ''
        } ${flipped ? 'seating-chart__grid--flipped' : ''}`}
        ref={(element) => {
          gridRef.current = element;
          onGridElementChange(element);
        }}
        role="grid"
      >
        {Array.from({ length: SEATING_CHART_GRID_ROWS * SEATING_CHART_GRID_COLUMNS }, (_value, index) => {
          const x = index % SEATING_CHART_GRID_COLUMNS;
          const y = Math.floor(index / SEATING_CHART_GRID_COLUMNS);
          const key = getSeatingChartCellKey(x, y);
          const item = itemsByCell.get(key) ?? null;
          const isSeat = item?.kind === 'seat';
          const isSelected = item ? selectedItemId === item.id : false;
          const isDragTarget = dragTargetCellKey === key;
          const isAssignmentTarget = assignmentTargetSeatId !== null && item?.id === assignmentTargetSeatId;
          const isSeatAssignmentDragging =
            draggingSeatAssignmentId !== null && item?.id === draggingSeatAssignmentId;
          const studentNote = getSeatingStudentNote(item, studentNotes);

          return (
            <div
              aria-colindex={x + 1}
              aria-label={
                item ? buildSeatingChartItemTitle(item) : `Empty cell, row ${y + 1}, column ${x + 1}`
              }
              aria-rowindex={y + 1}
              aria-selected={isSelected}
              className={`seating-chart__cell ${
                item ? 'seating-chart__cell--occupied' : ''
              } ${isSelected ? 'seating-chart__cell--selected' : ''} ${
                isDragTarget ? 'seating-chart__cell--drag-target' : ''
              } ${isAssignmentTarget ? 'seating-chart__cell--assignment-target' : ''}`}
              data-grid-x={x}
              data-grid-y={y}
              key={key}
              onFocus={(event) => {
                if (event.target === event.currentTarget) {
                  setFocusCellKey(key);
                }
              }}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget) {
                  handleCellKeyDown(event, x, y, item);
                }
              }}
              onPointerDown={(event) => startPaintSession(event, x, y)}
              role="gridcell"
              tabIndex={key === tabbableCellKey ? 0 : -1}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }

                if (mode === 'arrange') {
                  onGridToolAction(x, y, item?.id ?? null);
                  return;
                }

                if (item?.kind === 'seat') {
                  onSeatActivate(item.id);
                  return;
                }

                onSelectItem(null);
              }}
              onDragOver={(event) => {
                const payloadIsSupported =
                  mode === 'arrange'
                    ? hasSeatingChartDragPayload(event.dataTransfer)
                    : hasSeatingChartDragPayload(event.dataTransfer) && item?.kind === 'seat';

                if (payloadIsSupported) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => handleDrop(event, item, x, y)}
            >
              {item ? (
                <button
                  aria-label={buildSeatingChartItemTitle(item)}
                  className={`seating-chart__item seating-chart__item--${item.kind} ${
                    isSelected ? 'seating-chart__item--selected' : ''
                  } ${isSeat ? `seating-chart__item--seat-${item.seatStyle}` : ''} ${
                    item.assignedStudent ? 'seating-chart__item--assigned' : ''
                  } ${compact ? 'seating-chart__item--compact' : ''} ${
                    mode === 'arrange' && selectedTool === 'select'
                      ? 'seating-chart__item--movable'
                      : ''
                  } ${
                    mode === 'assign' && isSeat
                      ? 'seating-chart__item--assignment-draggable'
                      : ''
                  } ${
                    draggingItemId === item.id || isSeatAssignmentDragging
                      ? 'seating-chart__item--dragging'
                      : ''
                  }`}
                  data-tooltip-content={
                    studentNote
                      ? `${buildSeatingChartItemTitle(item)} — ${studentNote}`
                      : compact
                        ? buildSeatingChartItemTitle(item)
                        : undefined
                  }
                  draggable={false}
                  onPointerDown={(event) => {
                    if (mode === 'assign' && isSeat) {
                      onSeatAssignmentPointerDown(event, item.id);
                      return;
                    }

                    startPointerDrag(event, item.id);
                  }}
                  style={
                    {
                      ['--seat-colour' as string]: item.color
                    } as CSSProperties
                  }
                  data-seat-id={isSeat ? item.id : undefined}
                  type="button"
                >
                  {isSeat ? null : <span className="seating-chart__item-label">{item.label}</span>}
                  {studentNote ? (
                    <span aria-hidden="true" className="seating-chart__note-flag" />
                  ) : null}
                  {isSeat && item.locked ? (
                    <span aria-hidden="true" className="seating-chart__lock-flag" />
                  ) : null}
                  {isSeat ? (
                    item.assignedStudent ? (
                      <span
                        className="seating-chart__student-token"
                        draggable={false}
                        onPointerDown={(event) =>
                          onStudentTokenPointerDown(event, item.assignedStudent ?? '', item.id)
                        }
                      >
                        {compact ? formatStudentInitials(item.assignedStudent) : item.assignedStudent}
                      </span>
                    ) : (
                      <span className="seating-chart__student-placeholder">
                        {compact ? '+' : 'Drop student'}
                      </span>
                    )
                  ) : (
                    <span className="seating-chart__item-meta">
                      {SEATING_CHART_ITEM_DETAILS[item.kind].title}
                    </span>
                  )}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="seating-chart__grid-axis seating-chart__grid-axis--columns">
        {Array.from({ length: SEATING_CHART_GRID_COLUMNS }, (_value, index) => (
          <span key={`column-${index + 1}`}>
            {flipped ? SEATING_CHART_GRID_COLUMNS - index : index + 1}
          </span>
        ))}
      </div>
      <div className="seating-chart__grid-axis seating-chart__grid-axis--rows">
        {Array.from({ length: SEATING_CHART_GRID_ROWS }, (_value, index) => (
          <span key={`row-${index + 1}`}>
            {flipped ? SEATING_CHART_GRID_ROWS - index : index + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SeatingChartWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const [picker] = usePickerState();
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const [groupRules] = useGroupRulesState();
  const listRules = getGroupRulesForList(
    groupRules,
    selectedList?.id ?? null,
    selectedList?.students ?? []
  );
  const seatingChart = useSeatingChartController(selectedList, {
    absentStudents: getAbsentStudentsForList(picker, selectedList),
    apartPairs: listRules.apart,
    lists: picker.lists,
    togetherPairs: listRules.together
  });

  return (
    <WidgetCard
      badge={selectedList ? `${seatingChart.assignedSeatCount}/${selectedList.students.length}` : null}
      collapsed={false}
      description={
        selectedList
          ? `${activeLayoutNameForSeatingChart(seatingChart.activeLayout)} · ${selectedList.name}`
          : 'Choose a class from the main dashboard.'
      }
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS['seating-chart'].title}
          widgetId="seating-chart"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      sizeTier={sizeTier}
      title={WIDGET_DETAILS['seating-chart'].title}
      widgetId="seating-chart"
    >
      <SeatingChartWidgetContent controller={seatingChart} mode="popout" />
    </WidgetCard>
  );
}

export function useSeatingChartState() {
  return usePersistentState<SeatingChartSnapshot>(
    'teacher-tools.seating-chart',
    DEFAULT_SEATING_CHART,
    {
      normalize: normalizeSeatingChartSnapshot
    }
  );
}

export function useSeatingChartController(
  selectedList: ClassList | null,
  options?: {
    absentStudents?: string[];
    apartPairs?: GroupPairRule[];
    lists?: ClassList[];
    togetherPairs?: GroupPairRule[];
  }
) {
  const [seatingChart, setSeatingChart] = useSeatingChartState();
  const apartPairs = options?.apartPairs ?? [];
  const togetherPairs = options?.togetherPairs ?? [];
  const absentStudents = options?.absentStudents ?? [];
  const otherLists = (options?.lists ?? []).filter((list) => list.id !== selectedList?.id);
  const selectedStudents = selectedList?.students ?? [];
  const presentStudents = filterAbsentStudents(selectedStudents, absentStudents);
  const studentNotes = selectedList
    ? getSeatingStudentNotesForList(seatingChart, selectedList)
    : {};
  const studentPlacements = selectedList
    ? getSeatingPlacementsForList(seatingChart, selectedList)
    : {};
  const generatorOptions = selectedList
    ? getSeatingGeneratorOptionsForList(seatingChart, selectedList.id)
    : DEFAULT_SEATING_GENERATOR_OPTIONS;
  const classState = selectedList
    ? getSeatingChartClassState(seatingChart, selectedList.id, selectedStudents.length)
    : null;
  const activeLayout = classState
    ? sanitizeSeatingChartLayout(
        getActiveSeatingChartLayout(classState, selectedStudents.length),
        selectedStudents
      )
    : null;
  const seatItems = activeLayout ? getSeatingChartSeatItems(activeLayout) : [];
  const assignedStudentNames = seatItems
    .map((item) => item.assignedStudent)
    .filter((student): student is string => Boolean(student));
  const assignedStudentSet = new Set(assignedStudentNames);
  const unseatedStudents = selectedStudents.filter((student) => !assignedStudentSet.has(student));
  const hasEnoughSeats = seatItems.length >= selectedStudents.length;

  const updateSelectedListChart = (
    updater: (classState: SeatingChartClassState) => SeatingChartClassState
  ) => {
    if (!selectedList) {
      return;
    }

    setSeatingChart((current) =>
      updateSeatingChartForList(current, selectedList.id, selectedStudents.length, updater)
    );
  };

  const updateActiveLayout = (
    updater: (layout: SeatingChartLayout) => SeatingChartLayout
  ) => {
    updateSelectedListChart((current) => ({
      ...current,
      layouts: current.layouts.map((layout) =>
        layout.id === current.activeLayoutId
          ? sanitizeSeatingChartLayout(updater(layout), selectedStudents)
          : layout
      )
    }));
  };

  return {
    activeLayout,
    apartPairs,
    assignedSeatCount: assignedStudentNames.length,
    canDeleteLayout: Boolean(classState && classState.layouts.length > 1),
    generatorOptions,
    hasEnoughSeats,
    layoutCount: classState?.layouts.length ?? 0,
    layoutOptions: classState?.layouts ?? [],
    otherLists,
    seatCount: seatItems.length,
    seatItems,
    selectedList,
    selectedStudents,
    seatingChart,
    studentNotes,
    studentPlacements,
    togetherPairs,
    unseatedStudents,
    addLayout: () =>
      updateSelectedListChart((current) => createEmptySeatingChartClassStateFromCurrent(current)),
    assignStudentToSeat: (studentName: string, targetSeatId: string, sourceSeatId: string | null = null) =>
      updateActiveLayout((layout) =>
        assignStudentToSeatInLayout(layout, studentName, targetSeatId, sourceSeatId)
      ),
    autofillAssignments: () =>
      updateActiveLayout((layout) =>
        autofillSeatingChartLayout(layout, selectedStudents)
      ),
    autofillAlphabetical: () =>
      updateActiveLayout((layout) =>
        applySeatingChartAssignments(
          layout,
          [...selectedStudents].sort((left, right) => left.localeCompare(right))
        )
      ),
    exportActiveLayoutPng: (flipped = false) => {
      if (activeLayout && selectedList) {
        exportSeatingChartPng(activeLayout, selectedList.name, studentNotes, flipped);
      }
    },
    copyActiveLayoutPng: (flipped = false) => {
      if (activeLayout && selectedList) {
        copySeatingChartPngToClipboard(activeLayout, selectedList.name, studentNotes, flipped);
      }
    },
    copyActiveLayoutToList: (targetList: ClassList) => {
      if (!activeLayout) {
        return;
      }

      setSeatingChart((current) =>
        updateSeatingChartForList(current, targetList.id, targetList.students.length, (targetState) =>
          copySeatingChartLayoutToClassState(targetState, activeLayout, targetList.students)
        )
      );
    },
    setGeneratorOptions: (updates: Partial<SeatingGeneratorOptions>) => {
      if (!selectedList) {
        return;
      }

      setSeatingChart((current) =>
        setSeatingGeneratorOptionsForList(current, selectedList.id, {
          ...getSeatingGeneratorOptionsForList(current, selectedList.id),
          ...updates
        })
      );
    },
    setStudentPlacement: (studentName: string, zone: SeatingPlacementZone | null) => {
      if (!selectedList) {
        return;
      }

      setSeatingChart((current) =>
        setSeatingStudentPlacement(current, selectedList.id, studentName, zone)
      );
    },
    setStudentNote: (studentName: string, note: string) => {
      if (!selectedList) {
        return;
      }

      setSeatingChart((current) =>
        setSeatingStudentNote(current, selectedList.id, studentName, note)
      );
    },
    clearAssignments: () =>
      updateActiveLayout((layout) => clearSeatingChartLayoutAssignments(layout)),
    clearSeatAssignment: (seatId: string) =>
      updateActiveLayout((layout) => clearSeatingChartSeatAssignment(layout, seatId)),
    swapSeatAssignments: (sourceSeatId: string, targetSeatId: string) =>
      updateActiveLayout((layout) =>
        swapSeatingChartSeatAssignments(layout, sourceSeatId, targetSeatId)
      ),
    deleteActiveLayout: () =>
      updateSelectedListChart((current) =>
        current.activeLayoutId
          ? deleteSeatingChartLayout(current, current.activeLayoutId)
          : current
      ),
    duplicateActiveLayout: () =>
      updateSelectedListChart((current) => duplicateActiveSeatingChartLayout(current, selectedStudents.length)),
    moveItem: (itemId: string, x: number, y: number) =>
      updateActiveLayout((layout) => moveSeatingChartLayoutItem(layout, itemId, x, y)),
    removeItem: (itemId: string) =>
      updateActiveLayout((layout) => removeSeatingChartLayoutItem(layout, itemId)),
    renameActiveLayout: (name: string) =>
      updateSelectedListChart((current) =>
        current.activeLayoutId
          ? renameSeatingChartLayout(current, current.activeLayoutId, name)
          : current
      ),
    renumberSeats: () =>
      updateActiveLayout((layout) => renumberSeatingChartSeats(layout)),
    reshuffleAssignments: (): SeatingShuffleReport | null => {
      if (!activeLayout) {
        return null;
      }

      const { layout: nextLayout, report } = reshuffleSeatingChartLayout(
        activeLayout,
        presentStudents,
        {
          apartPairs,
          options: generatorOptions,
          placements: studentPlacements,
          togetherPairs
        }
      );
      updateActiveLayout(() => nextLayout);
      return report;
    },
    restoreDeletedLayout: (layout: SeatingChartLayout) =>
      updateSelectedListChart((current) =>
        current.layouts.some((existing) => existing.id === layout.id)
          ? { ...current, activeLayoutId: layout.id }
          : {
              activeLayoutId: layout.id,
              layouts: [...current.layouts, layout]
            }
      ),
    restoreLayout: (layout: SeatingChartLayout) =>
      updateSelectedListChart((current) => ({
        ...current,
        layouts: current.layouts.map((existing) =>
          existing.id === layout.id
            ? sanitizeSeatingChartLayout({ ...layout, updatedAt: Date.now() }, selectedStudents)
            : existing
        )
      })),
    addSeatRow: (count: number) =>
      updateActiveLayout((layout) => addSeatingChartSeatRow(layout, count)),
    appendSeats: (count: number) =>
      updateActiveLayout((layout) => appendSeatingChartSeats(layout, count)),
    selectLayout: (layoutId: string) =>
      updateSelectedListChart((current) => selectSeatingChartLayout(current, layoutId)),
    setItemAtCell: (kind: SeatingChartItemKind, x: number, y: number) =>
      updateActiveLayout((layout) => setSeatingChartItemAtPosition(layout, kind, x, y)),
    updateItem: (
      itemId: string,
      updater: (item: SeatingChartLayoutItem) => SeatingChartLayoutItem
    ) =>
      updateActiveLayout((layout) => updateSeatingChartLayoutItem(layout, itemId, updater))
  };
}

export function normalizeSeatingChartSnapshot(
  raw: unknown,
  initialValue: SeatingChartSnapshot
) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as {
    chartsByListId?: Record<string, unknown>;
    frontRowByListId?: Record<string, unknown>;
    generatorOptionsByListId?: Record<string, unknown>;
    placementsByListId?: Record<string, unknown>;
    studentNotesByListId?: Record<string, unknown>;
  };
  const chartsByListId: Record<string, SeatingChartClassState> = {};
  const generatorOptionsByListId: Record<string, SeatingGeneratorOptions> = {};
  const placementsByListId: Record<string, Record<string, SeatingPlacementZone>> = {};
  const studentNotesByListId: Record<string, Record<string, string>> = {};

  if (nextRaw.chartsByListId && typeof nextRaw.chartsByListId === 'object') {
    for (const [listId, chartRaw] of Object.entries(nextRaw.chartsByListId)) {
      chartsByListId[listId] = normalizeSeatingChartClassState(chartRaw);
    }
  }

  if (nextRaw.placementsByListId && typeof nextRaw.placementsByListId === 'object') {
    for (const [listId, placementsRaw] of Object.entries(nextRaw.placementsByListId)) {
      if (!placementsRaw || typeof placementsRaw !== 'object') {
        continue;
      }

      const placements: Record<string, SeatingPlacementZone> = {};

      for (const [studentName, zoneRaw] of Object.entries(placementsRaw as Record<string, unknown>)) {
        if (studentName.trim() && isSeatingPlacementZone(zoneRaw)) {
          placements[studentName] = zoneRaw;
        }
      }

      if (Object.keys(placements).length > 0) {
        placementsByListId[listId] = placements;
      }
    }
  }

  // Migration: front-row flags predate placement zones. Fold them in unless a
  // newer placement already covers the student.
  if (nextRaw.frontRowByListId && typeof nextRaw.frontRowByListId === 'object') {
    for (const [listId, namesRaw] of Object.entries(nextRaw.frontRowByListId)) {
      if (!Array.isArray(namesRaw)) {
        continue;
      }

      const placements = { ...(placementsByListId[listId] ?? {}) };
      const placedLower = new Set(Object.keys(placements).map((name) => name.toLowerCase()));

      for (const name of namesRaw) {
        if (isString(name) && name.trim() && !placedLower.has(name.toLowerCase())) {
          placedLower.add(name.toLowerCase());
          placements[name] = 'front';
        }
      }

      if (Object.keys(placements).length > 0) {
        placementsByListId[listId] = placements;
      }
    }
  }

  if (nextRaw.generatorOptionsByListId && typeof nextRaw.generatorOptionsByListId === 'object') {
    for (const [listId, optionsRaw] of Object.entries(nextRaw.generatorOptionsByListId)) {
      generatorOptionsByListId[listId] = normalizeSeatingGeneratorOptions(optionsRaw);
    }
  }

  if (nextRaw.studentNotesByListId && typeof nextRaw.studentNotesByListId === 'object') {
    for (const [listId, notesRaw] of Object.entries(nextRaw.studentNotesByListId)) {
      if (!notesRaw || typeof notesRaw !== 'object') {
        continue;
      }

      const notes: Record<string, string> = {};

      for (const [studentName, noteRaw] of Object.entries(notesRaw as Record<string, unknown>)) {
        if (isString(noteRaw) && noteRaw.trim()) {
          notes[studentName] = noteRaw;
        }
      }

      if (Object.keys(notes).length > 0) {
        studentNotesByListId[listId] = notes;
      }
    }
  }

  return {
    chartsByListId,
    generatorOptionsByListId,
    placementsByListId,
    studentNotesByListId
  };
}

export function isSeatingPlacementZone(value: unknown): value is SeatingPlacementZone {
  return isString(value) && (SEATING_PLACEMENT_ZONES as string[]).includes(value);
}

export function normalizeSeatingGeneratorOptions(raw: unknown): SeatingGeneratorOptions {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SEATING_GENERATOR_OPTIONS;
  }

  const nextRaw = raw as Partial<Record<keyof SeatingGeneratorOptions, unknown>>;

  return {
    apartDistance: nextRaw.apartDistance === 2 ? 2 : 1,
    avoidRepeatNeighbours: nextRaw.avoidRepeatNeighbours === true,
    emptySeatPlacement:
      nextRaw.emptySeatPlacement === 'back' || nextRaw.emptySeatPlacement === 'spread'
        ? nextRaw.emptySeatPlacement
        : 'anywhere',
    respectLockedSeats: nextRaw.respectLockedSeats !== false,
    togetherStyle: nextRaw.togetherStyle === 'side-by-side' ? 'side-by-side' : 'adjacent'
  };
}

export function normalizeSeatingChartClassState(raw: unknown): SeatingChartClassState {
  if (!raw || typeof raw !== 'object') {
    return {
      activeLayoutId: null,
      layouts: []
    };
  }

  const nextRaw = raw as {
    activeLayoutId?: unknown;
    layouts?: unknown[];
  };
  const layouts = Array.isArray(nextRaw.layouts)
    ? nextRaw.layouts
        .map((layout) => normalizeSeatingChartLayout(layout))
        .filter((layout): layout is SeatingChartLayout => layout !== null)
    : [];
  const activeLayoutId =
    typeof nextRaw.activeLayoutId === 'string' &&
    layouts.some((layout) => layout.id === nextRaw.activeLayoutId)
      ? nextRaw.activeLayoutId
      : layouts[0]?.id ?? null;

  return {
    activeLayoutId,
    layouts
  };
}

export function normalizeSeatingChartLayout(raw: unknown): SeatingChartLayout | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    id?: unknown;
    items?: unknown[];
    name?: unknown;
    updatedAt?: unknown;
  };

  if (typeof nextRaw.id !== 'string' || !nextRaw.id.trim()) {
    return null;
  }

  const items = Array.isArray(nextRaw.items)
    ? normalizeSeatingChartItems(nextRaw.items)
    : [];

  return {
    id: nextRaw.id,
    items,
    name: typeof nextRaw.name === 'string' ? nextRaw.name : '',
    updatedAt:
      typeof nextRaw.updatedAt === 'number' && Number.isFinite(nextRaw.updatedAt)
        ? nextRaw.updatedAt
        : 0
  };
}

export function normalizeSeatingChartItems(rawItems: unknown[]) {
  const items: SeatingChartLayoutItem[] = [];
  const occupiedCells = new Set<string>();

  rawItems.forEach((itemRaw) => {
    const item = normalizeSeatingChartItem(itemRaw);
    if (!item) {
      return;
    }

    const key = getSeatingChartCellKey(item.x, item.y);
    if (occupiedCells.has(key)) {
      return;
    }

    occupiedCells.add(key);
    items.push(item);
  });

  return sortSeatingChartItems(items);
}

export function normalizeSeatingChartItem(raw: unknown): SeatingChartLayoutItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    assignedStudent?: unknown;
    color?: unknown;
    id?: unknown;
    kind?: unknown;
    label?: unknown;
    locked?: unknown;
    seatStyle?: unknown;
    x?: unknown;
    y?: unknown;
  };

  if (
    typeof nextRaw.id !== 'string' ||
    !isSeatingChartItemKind(nextRaw.kind) ||
    typeof nextRaw.x !== 'number' ||
    typeof nextRaw.y !== 'number'
  ) {
    return null;
  }

  const details = SEATING_CHART_ITEM_DETAILS[nextRaw.kind];

  return {
    assignedStudent:
      nextRaw.kind === 'seat' && typeof nextRaw.assignedStudent === 'string'
        ? nextRaw.assignedStudent
        : null,
    color: typeof nextRaw.color === 'string' && nextRaw.color.trim() ? nextRaw.color : details.defaultColor,
    id: nextRaw.id,
    kind: nextRaw.kind,
    label:
      typeof nextRaw.label === 'string' && nextRaw.label.trim()
        ? nextRaw.label
        : details.defaultLabel,
    locked: nextRaw.kind === 'seat' && nextRaw.locked === true,
    seatStyle: isSeatingChartSeatStyle(nextRaw.seatStyle) ? nextRaw.seatStyle : 'desk',
    x: clampNumber(Math.round(nextRaw.x), 0, SEATING_CHART_GRID_COLUMNS - 1),
    y: clampNumber(Math.round(nextRaw.y), 0, SEATING_CHART_GRID_ROWS - 1)
  };
}

export function getSeatingChartClassState(
  snapshot: SeatingChartSnapshot,
  listId: string,
  studentCount: number
) {
  const existing = snapshot.chartsByListId[listId];

  if (!existing || existing.layouts.length === 0) {
    return createDefaultSeatingChartClassState(studentCount);
  }

  return existing;
}

export function updateSeatingChartForList(
  snapshot: SeatingChartSnapshot,
  listId: string,
  studentCount: number,
  updater: (classState: SeatingChartClassState) => SeatingChartClassState
) {
  const current = getSeatingChartClassState(snapshot, listId, studentCount);
  const next = normalizeSeatingChartClassState(updater(current));

  return {
    ...snapshot,
    chartsByListId: {
      ...snapshot.chartsByListId,
      [listId]: next
    }
  };
}

export function createDefaultSeatingChartClassState(studentCount: number): SeatingChartClassState {
  const layout = createDefaultSeatingChartLayout(studentCount);

  return {
    activeLayoutId: layout.id,
    layouts: [layout]
  };
}

export function createDefaultSeatingChartLayout(studentCount: number): SeatingChartLayout {
  return {
    id: 'seating-layout-main',
    items: createDefaultSeatingChartItems(studentCount),
    name: 'Main layout',
    updatedAt: 0
  };
}

export function createEmptySeatingChartClassStateFromCurrent(current: SeatingChartClassState) {
  const nextLayout = createEmptySeatingChartLayout(current.layouts);

  return {
    activeLayoutId: nextLayout.id,
    layouts: [...current.layouts, nextLayout]
  };
}

export function createEmptySeatingChartLayout(existingLayouts: SeatingChartLayout[]) {
  return {
    id: createSeatingChartLayoutId(),
    items: createSeatingChartScaffoldItems(false),
    name: createSeatingChartLayoutName(existingLayouts, 'New layout'),
    updatedAt: Date.now()
  };
}

export function duplicateActiveSeatingChartLayout(
  classState: SeatingChartClassState,
  studentCount: number
) {
  const activeLayout = getActiveSeatingChartLayout(classState, studentCount);
  const duplicatedLayout: SeatingChartLayout = {
    id: createSeatingChartLayoutId(),
    items: activeLayout.items.map((item) => ({
      ...item,
      id: createSeatingChartLayoutItemId()
    })),
    name: createSeatingChartLayoutName(classState.layouts, activeLayoutNameForSeatingChart(activeLayout)),
    updatedAt: Date.now()
  };

  return {
    activeLayoutId: duplicatedLayout.id,
    layouts: [...classState.layouts, duplicatedLayout]
  };
}

export function selectSeatingChartLayout(classState: SeatingChartClassState, layoutId: string) {
  if (!classState.layouts.some((layout) => layout.id === layoutId)) {
    return classState;
  }

  return {
    ...classState,
    activeLayoutId: layoutId
  };
}

export function renameSeatingChartLayout(
  classState: SeatingChartClassState,
  layoutId: string,
  name: string
) {
  return {
    ...classState,
    layouts: classState.layouts.map((layout) =>
      layout.id === layoutId
        ? {
            ...layout,
            name,
            updatedAt: Date.now()
          }
        : layout
    )
  };
}

export function deleteSeatingChartLayout(classState: SeatingChartClassState, layoutId: string) {
  if (classState.layouts.length <= 1) {
    return classState;
  }

  const nextLayouts = classState.layouts.filter((layout) => layout.id !== layoutId);

  return {
    activeLayoutId:
      classState.activeLayoutId === layoutId ? nextLayouts[0]?.id ?? null : classState.activeLayoutId,
    layouts: nextLayouts
  };
}

export function getActiveSeatingChartLayout(
  classState: SeatingChartClassState,
  studentCount: number
) {
  return (
    classState.layouts.find((layout) => layout.id === classState.activeLayoutId) ??
    classState.layouts[0] ??
    createDefaultSeatingChartLayout(studentCount)
  );
}

export function activeLayoutNameForSeatingChart(layout: SeatingChartLayout | null) {
  return layout?.name.trim() || 'Main layout';
}

export function createDefaultSeatingChartItems(studentCount: number) {
  const items = createSeatingChartScaffoldItems(true);
  const occupied = new Set(items.map((item) => getSeatingChartCellKey(item.x, item.y)));
  const seatTarget = Math.max(studentCount, SEATING_CHART_MIN_SEATS);
  const seatColumns = [1, 2, 4, 5, 7, 8, 10, 11];
  let seatNumber = 1;

  for (let y = 2; y < SEATING_CHART_GRID_ROWS; y += 1) {
    for (const x of seatColumns) {
      const key = getSeatingChartCellKey(x, y);

      if (occupied.has(key)) {
        continue;
      }

      items.push({
        assignedStudent: null,
        color: SEATING_CHART_ITEM_DETAILS.seat.defaultColor,
        id: `seating-default-seat-${seatNumber}`,
        kind: 'seat',
        label: String(seatNumber),
        locked: false,
        seatStyle: 'desk',
        x,
        y
      });
      seatNumber += 1;

      if (seatNumber > seatTarget) {
        return items;
      }
    }
  }

  return items;
}

export function createSeatingChartScaffoldItems(deterministic: boolean) {
  return [
    createSeatingChartLayoutItem('board', 5, 0, [], {
      id: deterministic ? 'seating-default-board' : undefined
    }),
    createSeatingChartLayoutItem('teacher-desk', 5, 1, [], {
      id: deterministic ? 'seating-default-teacher-desk' : undefined
    }),
    createSeatingChartLayoutItem('door', 11, 9, [], {
      id: deterministic ? 'seating-default-door' : undefined
    })
  ];
}

export function createSeatingChartLayoutItem(
  kind: SeatingChartItemKind,
  x: number,
  y: number,
  items: SeatingChartLayoutItem[],
  options?: {
    id?: string;
  }
): SeatingChartLayoutItem {
  const details = SEATING_CHART_ITEM_DETAILS[kind];

  return {
    assignedStudent: null,
    color: details.defaultColor,
    id: options?.id ?? createSeatingChartLayoutItemId(),
    kind,
    label: kind === 'seat' ? String(getNextSeatLabelNumber(items)) : details.defaultLabel,
    locked: false,
    seatStyle: 'desk',
    x,
    y
  };
}

export function getNextSeatLabelNumber(items: SeatingChartLayoutItem[]) {
  const numericLabels = items
    .filter((item) => item.kind === 'seat')
    .map((item) => Number(item.label))
    .filter((value) => Number.isFinite(value));

  return (numericLabels.length ? Math.max(...numericLabels) : 0) + 1;
}

export function getSeatingChartSeatItems(layout: SeatingChartLayout) {
  return layout.items
    .filter((item) => item.kind === 'seat')
    .sort((left, right) => (left.y - right.y) || (left.x - right.x));
}

/** Relabels every seat 1..N in reading order (top-to-bottom, left-to-right). */
export function renumberSeatingChartSeats(layout: SeatingChartLayout) {
  const labelBySeatId = new Map(
    getSeatingChartSeatItems(layout).map((seat, index) => [seat.id, String(index + 1)])
  );

  return {
    ...layout,
    items: layout.items.map((item) =>
      item.kind === 'seat'
        ? {
            ...item,
            label: labelBySeatId.get(item.id) ?? item.label
          }
        : item
    ),
    updatedAt: Date.now()
  };
}

/** Appends a centered row of seats below the lowest existing seat row. */
export function addSeatingChartSeatRow(layout: SeatingChartLayout, count: number) {
  const seatCount = clampNumber(Math.round(count), 1, SEATING_CHART_GRID_COLUMNS);
  const seatYs = layout.items.filter((item) => item.kind === 'seat').map((item) => item.y);
  // Fresh layouts only hold the board/teacher scaffold, so start where the
  // default seat block starts.
  const targetY = seatYs.length > 0 ? Math.max(...seatYs) + 1 : 2;

  if (targetY >= SEATING_CHART_GRID_ROWS) {
    return layout;
  }

  const startX = Math.floor((SEATING_CHART_GRID_COLUMNS - seatCount) / 2);
  let items = [...layout.items];

  for (let offset = 0; offset < seatCount; offset += 1) {
    const x = startX + offset;

    if (getSeatingChartCellItem(items, x, targetY)) {
      continue;
    }

    items = [...items, createSeatingChartLayoutItem('seat', x, targetY, items)];
  }

  if (items.length === layout.items.length) {
    return layout;
  }

  return {
    ...layout,
    items: sortSeatingChartItems(items),
    updatedAt: Date.now()
  };
}

/**
 * Appends seats after the last seated row, following the default paired-column
 * pattern and falling back to any free cell once the lower rows are full.
 */
export function appendSeatingChartSeats(layout: SeatingChartLayout, count: number) {
  if (count <= 0) {
    return layout;
  }

  const seatYs = layout.items.filter((item) => item.kind === 'seat').map((item) => item.y);
  const startY = seatYs.length > 0 ? Math.max(...seatYs) + 1 : 2;
  const seatColumns = [1, 2, 4, 5, 7, 8, 10, 11];
  let items = [...layout.items];
  let remaining = count;

  const placeSeat = (x: number, y: number) => {
    if (remaining <= 0 || getSeatingChartCellItem(items, x, y)) {
      return;
    }

    items = [...items, createSeatingChartLayoutItem('seat', x, y, items)];
    remaining -= 1;
  };

  for (let y = startY; y < SEATING_CHART_GRID_ROWS && remaining > 0; y += 1) {
    for (const x of seatColumns) {
      placeSeat(x, y);
    }
  }

  for (let y = 0; y < SEATING_CHART_GRID_ROWS && remaining > 0; y += 1) {
    for (let x = 0; x < SEATING_CHART_GRID_COLUMNS; x += 1) {
      placeSeat(x, y);
    }
  }

  if (items.length === layout.items.length) {
    return layout;
  }

  return {
    ...layout,
    items: sortSeatingChartItems(items),
    updatedAt: Date.now()
  };
}

/**
 * Clones a layout into another class's chart state. Seat positions are kept;
 * assignments only carry over for students present in the target roster.
 */
export function copySeatingChartLayoutToClassState(
  classState: SeatingChartClassState,
  layout: SeatingChartLayout,
  targetRoster: string[]
): SeatingChartClassState {
  const canonicalByLowerName = new Map(targetRoster.map((name) => [name.toLowerCase(), name]));
  const clonedLayout: SeatingChartLayout = {
    id: createSeatingChartLayoutId(),
    items: layout.items.map((item) => ({
      ...item,
      assignedStudent:
        item.kind === 'seat' && item.assignedStudent
          ? canonicalByLowerName.get(item.assignedStudent.toLowerCase()) ?? null
          : null,
      id: createSeatingChartLayoutItemId()
    })),
    name: createSeatingChartLayoutName(classState.layouts, activeLayoutNameForSeatingChart(layout)),
    updatedAt: Date.now()
  };

  return {
    activeLayoutId: clonedLayout.id,
    layouts: [...classState.layouts, clonedLayout]
  };
}

export function sanitizeSeatingChartLayout(layout: SeatingChartLayout, roster: string[]) {
  // Case-insensitive match so a roster rename like "ava" → "Ava" keeps the
  // student seated; the stored name is rewritten to the roster's casing.
  const canonicalByLowerName = new Map(roster.map((name) => [name.toLowerCase(), name]));
  const occupied = new Set<string>();
  const items: SeatingChartLayoutItem[] = [];

  layout.items.forEach((item) => {
    const normalized = normalizeSeatingChartItem(item);
    if (!normalized) {
      return;
    }

    const key = getSeatingChartCellKey(normalized.x, normalized.y);
    if (occupied.has(key)) {
      return;
    }

    occupied.add(key);
    items.push({
      ...normalized,
      assignedStudent:
        normalized.kind === 'seat' && normalized.assignedStudent
          ? canonicalByLowerName.get(normalized.assignedStudent.toLowerCase()) ?? null
          : null
    });
  });

  return {
    ...layout,
    items: sortSeatingChartItems(items)
  };
}

export function sortSeatingChartItems(items: SeatingChartLayoutItem[]) {
  return [...items].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }

    if (left.x !== right.x) {
      return left.x - right.x;
    }

    return left.kind.localeCompare(right.kind);
  });
}

export function getSeatingChartCellKey(x: number, y: number) {
  return `${x}:${y}`;
}

export function getSeatingChartCellItem(items: SeatingChartLayoutItem[], x: number, y: number) {
  return items.find((item) => item.x === x && item.y === y) ?? null;
}

export function readSeatingChartGridCoordinatesFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  const cellElement = target.closest<HTMLElement>('[data-grid-x][data-grid-y]');
  if (!cellElement) {
    return null;
  }

  const x = Number(cellElement.dataset.gridX);
  const y = Number(cellElement.dataset.gridY);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x,
    y
  };
}

export function getSeatingChartGridCoordinatesFromPoint(
  gridElement: HTMLElement,
  clientX: number,
  clientY: number
) {
  const bounds = gridElement.getBoundingClientRect();
  const styles = window.getComputedStyle(gridElement);
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const columnGap = parseFloat(styles.columnGap || styles.gap) || 0;
  const rowGap = parseFloat(styles.rowGap || styles.gap) || 0;
  const usableWidth = bounds.width - paddingLeft - paddingRight;
  const usableHeight = bounds.height - paddingTop - paddingBottom;

  if (usableWidth <= 0 || usableHeight <= 0) {
    return null;
  }

  const cellWidth =
    (usableWidth - columnGap * (SEATING_CHART_GRID_COLUMNS - 1)) / SEATING_CHART_GRID_COLUMNS;
  const cellHeight =
    (usableHeight - rowGap * (SEATING_CHART_GRID_ROWS - 1)) / SEATING_CHART_GRID_ROWS;

  if (cellWidth <= 0 || cellHeight <= 0) {
    return null;
  }

  const relativeX = clampNumber(clientX - bounds.left - paddingLeft, 0, usableWidth - 1);
  const relativeY = clampNumber(clientY - bounds.top - paddingTop, 0, usableHeight - 1);
  const x = clampNumber(
    Math.floor(relativeX / (cellWidth + columnGap)),
    0,
    SEATING_CHART_GRID_COLUMNS - 1
  );
  const y = clampNumber(
    Math.floor(relativeY / (cellHeight + rowGap)),
    0,
    SEATING_CHART_GRID_ROWS - 1
  );

  return {
    x,
    y
  };
}

export function resolveSeatingChartGridCell(
  gridElement: HTMLDivElement | null,
  target: EventTarget | null,
  clientX: number,
  clientY: number
) {
  const targetCell = readSeatingChartGridCoordinatesFromTarget(target);
  if (targetCell) {
    return targetCell;
  }

  if (!gridElement) {
    return null;
  }

  return getSeatingChartGridCoordinatesFromPoint(gridElement, clientX, clientY);
}

export function setSeatingChartItemAtPosition(
  layout: SeatingChartLayout,
  kind: SeatingChartItemKind,
  x: number,
  y: number
) {
  const existingItem = getSeatingChartCellItem(layout.items, x, y);

  if (existingItem) {
    return {
      ...layout,
      items: sortSeatingChartItems(
        layout.items.map((item) =>
          item.id === existingItem.id ? resetSeatingChartItemKind(item, kind, layout.items) : item
        )
      ),
      updatedAt: Date.now()
    };
  }

  return {
    ...layout,
    items: sortSeatingChartItems([...layout.items, createSeatingChartLayoutItem(kind, x, y, layout.items)]),
    updatedAt: Date.now()
  };
}

export function resetSeatingChartItemKind(
  item: SeatingChartLayoutItem,
  kind: SeatingChartItemKind,
  items: SeatingChartLayoutItem[]
): SeatingChartLayoutItem {
  if (item.kind === kind) {
    return item;
  }

  const details = SEATING_CHART_ITEM_DETAILS[kind];

  return {
    ...item,
    assignedStudent: null,
    color: details.defaultColor,
    kind,
    label: kind === 'seat' ? String(getNextSeatLabelNumber(items.filter((entry) => entry.id !== item.id))) : details.defaultLabel,
    locked: false,
    seatStyle: 'desk'
  };
}

export function moveSeatingChartLayoutItem(
  layout: SeatingChartLayout,
  itemId: string,
  x: number,
  y: number
) {
  const nextX = clampNumber(Math.round(x), 0, SEATING_CHART_GRID_COLUMNS - 1);
  const nextY = clampNumber(Math.round(y), 0, SEATING_CHART_GRID_ROWS - 1);
  const movingItem = layout.items.find((item) => item.id === itemId);

  if (!movingItem || (movingItem.x === nextX && movingItem.y === nextY)) {
    return layout;
  }

  const targetItem = getSeatingChartCellItem(layout.items, nextX, nextY);

  return {
    ...layout,
    items: sortSeatingChartItems(
      layout.items.map((item) => {
        if (item.id === itemId) {
          return {
            ...item,
            x: nextX,
            y: nextY
          };
        }

        if (targetItem && item.id === targetItem.id) {
          return {
            ...item,
            x: movingItem.x,
            y: movingItem.y
          };
        }

        return item;
      })
    ),
    updatedAt: Date.now()
  };
}

export function updateSeatingChartLayoutItem(
  layout: SeatingChartLayout,
  itemId: string,
  updater: (item: SeatingChartLayoutItem) => SeatingChartLayoutItem
) {
  return {
    ...layout,
    items: sortSeatingChartItems(
      layout.items.map((item) =>
        item.id === itemId ? normalizeSeatingChartItem(updater(item)) ?? item : item
      )
    ),
    updatedAt: Date.now()
  };
}

export function removeSeatingChartLayoutItem(layout: SeatingChartLayout, itemId: string) {
  return {
    ...layout,
    items: layout.items.filter((item) => item.id !== itemId),
    updatedAt: Date.now()
  };
}

export function clearSeatingChartLayoutAssignments(layout: SeatingChartLayout) {
  return {
    ...layout,
    items: layout.items.map((item) =>
      item.kind === 'seat'
        ? {
            ...item,
            assignedStudent: null
          }
        : item
    ),
    updatedAt: Date.now()
  };
}

export function clearSeatingChartSeatAssignment(layout: SeatingChartLayout, seatId: string) {
  return {
    ...layout,
    items: layout.items.map((item) =>
      item.id === seatId && item.kind === 'seat'
        ? {
            ...item,
            assignedStudent: null
          }
        : item
    ),
    updatedAt: Date.now()
  };
}

export function swapSeatingChartSeatAssignments(
  layout: SeatingChartLayout,
  sourceSeatId: string,
  targetSeatId: string
) {
  if (sourceSeatId === targetSeatId) {
    return layout;
  }

  const sourceSeat = layout.items.find((item) => item.id === sourceSeatId && item.kind === 'seat');
  const targetSeat = layout.items.find((item) => item.id === targetSeatId && item.kind === 'seat');

  if (!sourceSeat || !targetSeat || sourceSeat.assignedStudent === targetSeat.assignedStudent) {
    return layout;
  }

  return {
    ...layout,
    items: layout.items.map((item) => {
      if (item.id === sourceSeatId && item.kind === 'seat') {
        return {
          ...item,
          assignedStudent: targetSeat.assignedStudent
        };
      }

      if (item.id === targetSeatId && item.kind === 'seat') {
        return {
          ...item,
          assignedStudent: sourceSeat.assignedStudent
        };
      }

      return item;
    }),
    updatedAt: Date.now()
  };
}

export function assignStudentToSeatInLayout(
  layout: SeatingChartLayout,
  studentName: string,
  targetSeatId: string,
  sourceSeatId: string | null
) {
  const targetSeat = layout.items.find((item) => item.id === targetSeatId && item.kind === 'seat');

  if (!targetSeat) {
    return layout;
  }

  const targetOccupant = targetSeat.assignedStudent;

  return {
    ...layout,
    items: layout.items.map((item) => {
      if (item.kind !== 'seat') {
        return item;
      }

      if (item.id === targetSeatId) {
        return {
          ...item,
          assignedStudent: studentName
        };
      }

      if (sourceSeatId && item.id === sourceSeatId) {
        return {
          ...item,
          assignedStudent: sourceSeatId === targetSeatId ? studentName : targetOccupant ?? null
        };
      }

      if (item.assignedStudent === studentName) {
        return {
          ...item,
          assignedStudent: null
        };
      }

      return item;
    }),
    updatedAt: Date.now()
  };
}

export function autofillSeatingChartLayout(layout: SeatingChartLayout, students: string[]) {
  return applySeatingChartAssignments(layout, students);
}

export type SeatingGeneratorContext = {
  apartPairs: GroupPairRule[];
  options: SeatingGeneratorOptions;
  placements: Record<string, SeatingPlacementZone>;
  togetherPairs: GroupPairRule[];
};

const SEATING_APART_WEIGHT = 120;
const SEATING_TOGETHER_WEIGHT = 60;
const SEATING_PLACEMENT_WEIGHT = 30;
const SEATING_EMPTY_WEIGHT = 4;
const SEATING_REPEAT_WEIGHT = 1;

/**
 * Random-restart local search: each attempt seeds a shuffled assignment
 * (zone-constrained students get first pick of a satisfying seat), then swaps
 * pairs of seats while any swap lowers the weighted violation score.
 * Keep-apart outweighs keep-together, which outweighs placement zones; empty
 * seat position and repeated neighbours only break ties.
 */
export function reshuffleSeatingChartLayout(
  layout: SeatingChartLayout,
  students: string[],
  context: SeatingGeneratorContext
): { layout: SeatingChartLayout; report: SeatingShuffleReport } {
  const seats = getSeatingChartSeatItems(layout);
  const { options } = context;
  const presentLower = new Set(students.map((name) => name.toLowerCase()));

  // Locked seats keep their occupant (or stay empty); everyone else re-enters
  // the pool.
  const fixedStudentBySeatIndex = new Map<number, string | null>();
  seats.forEach((seat, index) => {
    if (options.respectLockedSeats && seat.locked) {
      fixedStudentBySeatIndex.set(
        index,
        seat.assignedStudent && presentLower.has(seat.assignedStudent.toLowerCase())
          ? seat.assignedStudent
          : null
      );
    }
  });
  const fixedLower = new Set(
    [...fixedStudentBySeatIndex.values()]
      .filter((name): name is string => Boolean(name))
      .map((name) => name.toLowerCase())
  );
  const pool = students.filter((name) => !fixedLower.has(name.toLowerCase()));
  const freeSeatIndexes = seats
    .map((_seat, index) => index)
    .filter((index) => !fixedStudentBySeatIndex.has(index));
  const freeSeatSet = new Set(freeSeatIndexes);
  const emptyFreeSeatCount = Math.max(0, freeSeatIndexes.length - pool.length);

  const chebyshevBetween = (left: number, right: number) =>
    Math.max(
      Math.abs(seats[left].x - seats[right].x),
      Math.abs(seats[left].y - seats[right].y)
    );

  const neighboursByIndex = seats.map((_seat, index) =>
    seats
      .map((_other, otherIndex) => otherIndex)
      .filter((otherIndex) => otherIndex !== index && chebyshevBetween(index, otherIndex) <= 1)
  );

  // Front/back bands grow row by row until they can hold everyone who asked
  // for them, mirroring how a teacher would stretch "the front" on demand.
  const rowYs = [...new Set(seats.map((seat) => seat.y))].sort((left, right) => left - right);
  const rowRankByY = new Map(rowYs.map((y, rank) => [y, rank]));
  const seatCountByRank = rowYs.map((y) => seats.filter((seat) => seat.y === y).length);
  const zoneByLowerName = new Map(
    Object.entries(context.placements)
      .filter(([name]) => presentLower.has(name.toLowerCase()))
      .map(([name, zone]) => [name.toLowerCase(), zone])
  );
  const countZone = (zone: SeatingPlacementZone) =>
    [...zoneByLowerName.values()].filter((entry) => entry === zone).length;
  const expandBand = (demand: number, countsInOrder: number[]) => {
    let rows = 1;
    let capacity = countsInOrder[0] ?? 0;

    while (capacity < demand && rows < countsInOrder.length) {
      capacity += countsInOrder[rows];
      rows += 1;
    }

    return rows;
  };
  const frontRankLimit = expandBand(countZone('front'), seatCountByRank);
  const backRankStart = rowYs.length - expandBand(countZone('back'), [...seatCountByRank].reverse());
  const rowEdgeByY = new Map(
    rowYs.map((y) => {
      const xs = seats.filter((seat) => seat.y === y).map((seat) => seat.x);
      return [y, { max: Math.max(...xs), min: Math.min(...xs) }];
    })
  );
  const targetCoords: Record<'board' | 'door' | 'teacher-desk', { x: number; y: number }[]> = {
    board: [],
    door: [],
    'teacher-desk': []
  };
  layout.items.forEach((item) => {
    if (item.kind === 'board' || item.kind === 'door' || item.kind === 'teacher-desk') {
      targetCoords[item.kind].push({ x: item.x, y: item.y });
    }
  });
  const distanceToNearest = (index: number, kind: 'board' | 'door' | 'teacher-desk') => {
    const targets = targetCoords[kind];
    if (targets.length === 0) {
      return null;
    }

    return Math.min(
      ...targets.map((target) =>
        Math.max(Math.abs(seats[index].x - target.x), Math.abs(seats[index].y - target.y))
      )
    );
  };
  // Zones whose target is missing from the layout count as satisfied.
  const seatSatisfiesZone = (index: number, zone: SeatingPlacementZone): boolean => {
    const seat = seats[index];
    const rank = rowRankByY.get(seat.y) ?? 0;

    switch (zone) {
      case 'front':
        return rank < frontRankLimit;
      case 'back':
        return rank >= backRankStart;
      case 'edge': {
        const edge = rowEdgeByY.get(seat.y);
        return !edge || seat.x === edge.min || seat.x === edge.max;
      }
      case 'near-teacher': {
        const distance = distanceToNearest(index, 'teacher-desk');
        return distance === null || distance <= 2;
      }
      case 'near-board': {
        const distance = distanceToNearest(index, 'board');
        return distance === null || distance <= 2;
      }
      case 'near-door': {
        const distance = distanceToNearest(index, 'door');
        return distance === null || distance <= 2;
      }
      case 'not-near-door': {
        const distance = distanceToNearest(index, 'door');
        return distance === null || distance >= 3;
      }
      case 'alone':
        return true;
    }
  };

  const placementEntries = students
    .map((name) => ({ name, zone: zoneByLowerName.get(name.toLowerCase()) }))
    .filter((entry): entry is { name: string; zone: SeatingPlacementZone } => Boolean(entry.zone))
    .map((entry) => ({
      allowed: seats.map((_seat, index) =>
        entry.zone === 'alone' ? true : seatSatisfiesZone(index, entry.zone)
      ),
      lower: entry.name.toLowerCase(),
      name: entry.name,
      zone: entry.zone
    }));
  const placementEntryByLower = new Map(placementEntries.map((entry) => [entry.lower, entry]));
  const apartLowerPairs = context.apartPairs.map(
    (pair) => [pair[0].toLowerCase(), pair[1].toLowerCase()] as const
  );
  const togetherLowerPairs = context.togetherPairs.map(
    (pair) => [pair[0].toLowerCase(), pair[1].toLowerCase()] as const
  );
  const togetherSeatsOk = (left: number, right: number) =>
    options.togetherStyle === 'side-by-side'
      ? seats[left].y === seats[right].y && Math.abs(seats[left].x - seats[right].x) === 1
      : chebyshevBetween(left, right) <= 1;

  const previousNeighbourKeys = new Set<string>();
  if (options.avoidRepeatNeighbours) {
    const previous = seats.map((seat) => seat.assignedStudent?.toLowerCase() ?? null);
    seats.forEach((_seat, index) => {
      for (const neighbour of neighboursByIndex[index]) {
        const left = previous[index];
        const right = previous[neighbour];
        if (neighbour > index && left && right) {
          previousNeighbourKeys.add([left, right].sort().join('|'));
        }
      }
    });
  }

  const scoreOrder = (order: (string | null)[]) => {
    const seatIndexByLower = new Map<string, number>();
    order.forEach((name, index) => {
      if (name) {
        seatIndexByLower.set(name.toLowerCase(), index);
      }
    });

    let score = 0;

    for (const [left, right] of apartLowerPairs) {
      const leftIndex = seatIndexByLower.get(left);
      const rightIndex = seatIndexByLower.get(right);
      if (
        leftIndex !== undefined &&
        rightIndex !== undefined &&
        chebyshevBetween(leftIndex, rightIndex) <= options.apartDistance
      ) {
        score += SEATING_APART_WEIGHT;
      }
    }

    for (const [left, right] of togetherLowerPairs) {
      const leftIndex = seatIndexByLower.get(left);
      const rightIndex = seatIndexByLower.get(right);
      if (
        leftIndex !== undefined &&
        rightIndex !== undefined &&
        !togetherSeatsOk(leftIndex, rightIndex)
      ) {
        score += SEATING_TOGETHER_WEIGHT;
      }
    }

    for (const entry of placementEntries) {
      const index = seatIndexByLower.get(entry.lower);
      if (index === undefined) {
        continue;
      }

      if (entry.zone === 'alone') {
        if (neighboursByIndex[index].some((neighbour) => order[neighbour] !== null)) {
          score += SEATING_PLACEMENT_WEIGHT;
        }
      } else if (!entry.allowed[index]) {
        score += SEATING_PLACEMENT_WEIGHT;
      }
    }

    if (options.emptySeatPlacement === 'back' && emptyFreeSeatCount > 0) {
      const backStart = freeSeatIndexes.length - emptyFreeSeatCount;
      freeSeatIndexes.forEach((seatIndex, position) => {
        if (order[seatIndex] === null && position < backStart) {
          score += SEATING_EMPTY_WEIGHT;
        }
      });
    } else if (options.emptySeatPlacement === 'spread' && emptyFreeSeatCount > 1) {
      for (const seatIndex of freeSeatIndexes) {
        if (order[seatIndex] !== null) {
          continue;
        }

        for (const neighbour of neighboursByIndex[seatIndex]) {
          if (neighbour > seatIndex && freeSeatSet.has(neighbour) && order[neighbour] === null) {
            score += SEATING_EMPTY_WEIGHT;
          }
        }
      }
    }

    if (previousNeighbourKeys.size > 0) {
      seats.forEach((_seat, index) => {
        for (const neighbour of neighboursByIndex[index]) {
          const left = order[index]?.toLowerCase();
          const right = order[neighbour]?.toLowerCase();
          if (
            neighbour > index &&
            left &&
            right &&
            (freeSeatSet.has(index) || freeSeatSet.has(neighbour)) &&
            previousNeighbourKeys.has([left, right].sort().join('|'))
          ) {
            score += SEATING_REPEAT_WEIGHT;
          }
        }
      });
    }

    return score;
  };

  const buildSeedOrder = () => {
    const order: (string | null)[] = new Array(seats.length).fill(null);
    fixedStudentBySeatIndex.forEach((name, index) => {
      order[index] = name;
    });

    const seated = shuffleNames(pool).slice(0, freeSeatIndexes.length);
    const openSeats = new Set(freeSeatIndexes);
    const placedLower = new Set<string>();

    for (const name of seated) {
      const entry = placementEntryByLower.get(name.toLowerCase());
      if (!entry || entry.zone === 'alone') {
        continue;
      }

      const candidates = [...openSeats].filter((index) => entry.allowed[index]);
      if (candidates.length === 0) {
        continue;
      }

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      order[pick] = name;
      openSeats.delete(pick);
      placedLower.add(name.toLowerCase());
    }

    const rest = seated.filter((name) => !placedLower.has(name.toLowerCase()));
    // Remaining seats stay in reading order when empties belong at the back,
    // so the seed already pushes gaps toward the last rows.
    const shuffledOpenSeats = [...openSeats];
    for (let index = shuffledOpenSeats.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledOpenSeats[index], shuffledOpenSeats[swapIndex]] = [
        shuffledOpenSeats[swapIndex],
        shuffledOpenSeats[index]
      ];
    }
    const fillSeats =
      options.emptySeatPlacement === 'back' ? [...openSeats] : shuffledOpenSeats;
    rest.forEach((name, position) => {
      order[fillSeats[position]] = name;
    });

    return order;
  };

  let evals = 0;
  const repairOrder = (order: (string | null)[], startScore: number) => {
    let score = startScore;
    let improved = true;

    while (improved && score > 0 && evals < SEATING_GENERATOR_MAX_EVALS) {
      improved = false;

      for (const left of freeSeatIndexes) {
        for (const right of freeSeatIndexes) {
          if (right <= left || (order[left] === null && order[right] === null)) {
            continue;
          }

          [order[left], order[right]] = [order[right], order[left]];
          evals += 1;
          const nextScore = scoreOrder(order);

          if (nextScore < score) {
            score = nextScore;
            improved = true;
            if (score === 0) {
              return score;
            }
          } else {
            [order[left], order[right]] = [order[right], order[left]];
          }

          if (evals >= SEATING_GENERATOR_MAX_EVALS) {
            return score;
          }
        }
      }
    }

    return score;
  };

  let bestOrder: (string | null)[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < SEATING_GENERATOR_RESTARTS; attempt += 1) {
    const order = buildSeedOrder();
    evals += 1;
    const score = repairOrder(order, scoreOrder(order));

    if (score < bestScore) {
      bestScore = score;
      bestOrder = order;
    }

    if (bestScore === 0 || evals >= SEATING_GENERATOR_MAX_EVALS) {
      break;
    }
  }

  const finalOrder = bestOrder ?? buildSeedOrder();
  const seatIndexByLower = new Map<string, number>();
  finalOrder.forEach((name, index) => {
    if (name) {
      seatIndexByLower.set(name.toLowerCase(), index);
    }
  });
  const bothSeated = (pair: GroupPairRule) => {
    const leftIndex = seatIndexByLower.get(pair[0].toLowerCase());
    const rightIndex = seatIndexByLower.get(pair[1].toLowerCase());
    return leftIndex !== undefined && rightIndex !== undefined
      ? ([leftIndex, rightIndex] as const)
      : null;
  };
  const report: SeatingShuffleReport = {
    totalRules: context.apartPairs.length + context.togetherPairs.length + placementEntries.length,
    unmetApartPairs: context.apartPairs.filter((pair) => {
      const indexes = bothSeated(pair);
      return indexes !== null && chebyshevBetween(indexes[0], indexes[1]) <= options.apartDistance;
    }),
    unmetPlacements: placementEntries
      .filter((entry) => {
        const index = seatIndexByLower.get(entry.lower);
        if (index === undefined) {
          return false;
        }

        return entry.zone === 'alone'
          ? neighboursByIndex[index].some((neighbour) => finalOrder[neighbour] !== null)
          : !entry.allowed[index];
      })
      .map((entry) => ({ student: entry.name, zone: entry.zone })),
    unmetTogetherPairs: context.togetherPairs.filter((pair) => {
      const indexes = bothSeated(pair);
      return indexes !== null && !togetherSeatsOk(indexes[0], indexes[1]);
    })
  };

  return {
    layout: applySeatingChartAssignments(layout, finalOrder),
    report
  };
}

/** One-line summary of a shuffle result for toasts and the live region. */
export function describeSeatingShuffleReport(report: SeatingShuffleReport) {
  if (report.totalRules === 0) {
    return 'Shuffled seats.';
  }

  const unmetCount =
    report.unmetApartPairs.length +
    report.unmetPlacements.length +
    report.unmetTogetherPairs.length;

  if (unmetCount === 0) {
    return `Shuffled seats — all ${report.totalRules} rule${
      report.totalRules === 1 ? '' : 's'
    } satisfied.`;
  }

  return `Shuffled seats — ${unmetCount} of ${report.totalRules} rule${
    report.totalRules === 1 ? '' : 's'
  } could not be met.`;
}

/** Short labels for the unmet rules, e.g. "Ava × Ben" or "Cara → Front rows". */
export function listUnmetSeatingRules(report: SeatingShuffleReport) {
  return [
    ...report.unmetApartPairs.map((pair) => `${pair[0]} × ${pair[1]}`),
    ...report.unmetTogetherPairs.map((pair) => `${pair[0]} + ${pair[1]}`),
    ...report.unmetPlacements.map(
      (entry) => `${entry.student} → ${SEATING_PLACEMENT_ZONE_DETAILS[entry.zone].label}`
    )
  ];
}

/**
 * Seats groups one after another in reading order, so every group lands on a
 * cluster of neighbouring seats in the active layout.
 */
export function applyGroupsToSeatingClassState(
  classState: SeatingChartClassState,
  groups: string[][]
) {
  const activeLayout = classState.layouts.find(
    (layout) => layout.id === classState.activeLayoutId
  ) ?? classState.layouts[0];

  if (!activeLayout) {
    return { classState, seatedEveryone: false };
  }

  const orderedStudents = groups.flat();
  const seatedEveryone =
    getSeatingChartSeatItems(activeLayout).length >= orderedStudents.length;
  const nextLayout = applySeatingChartAssignments(activeLayout, orderedStudents);

  return {
    classState: {
      ...classState,
      layouts: classState.layouts.map((layout) =>
        layout.id === activeLayout.id ? nextLayout : layout
      )
    },
    seatedEveryone
  };
}

export function getSeatingStudentNotesForList(
  snapshot: SeatingChartSnapshot,
  list: ClassList
): Record<string, string> {
  const savedNotes = snapshot.studentNotesByListId[list.id] ?? {};
  const notes: Record<string, string> = {};

  for (const student of list.students) {
    const note = savedNotes[student];
    if (note && note.trim()) {
      notes[student] = note;
    }
  }

  return notes;
}

export function setSeatingStudentNote(
  snapshot: SeatingChartSnapshot,
  listId: string,
  studentName: string,
  note: string
): SeatingChartSnapshot {
  const currentNotes = snapshot.studentNotesByListId[listId] ?? {};
  const nextNotes = { ...currentNotes };

  if (note.trim()) {
    nextNotes[studentName] = note;
  } else {
    delete nextNotes[studentName];
  }

  const nextNotesByListId = { ...snapshot.studentNotesByListId };

  if (Object.keys(nextNotes).length > 0) {
    nextNotesByListId[listId] = nextNotes;
  } else {
    delete nextNotesByListId[listId];
  }

  return {
    ...snapshot,
    studentNotesByListId: nextNotesByListId
  };
}

/**
 * Placement zones keyed by the roster's canonical casing, dropping entries for
 * students no longer on the list.
 */
export function getSeatingPlacementsForList(
  snapshot: SeatingChartSnapshot,
  list: ClassList
): Record<string, SeatingPlacementZone> {
  const saved = snapshot.placementsByListId[list.id] ?? {};
  const zoneByLowerName = new Map(
    Object.entries(saved).map(([name, zone]) => [name.toLowerCase(), zone])
  );
  const placements: Record<string, SeatingPlacementZone> = {};

  for (const student of list.students) {
    const zone = zoneByLowerName.get(student.toLowerCase());
    if (zone) {
      placements[student] = zone;
    }
  }

  return placements;
}

export function setSeatingStudentPlacement(
  snapshot: SeatingChartSnapshot,
  listId: string,
  studentName: string,
  zone: SeatingPlacementZone | null
): SeatingChartSnapshot {
  const currentPlacements = snapshot.placementsByListId[listId] ?? {};
  const nextPlacements: Record<string, SeatingPlacementZone> = {};

  for (const [name, existingZone] of Object.entries(currentPlacements)) {
    if (name.toLowerCase() !== studentName.toLowerCase()) {
      nextPlacements[name] = existingZone;
    }
  }

  if (zone) {
    nextPlacements[studentName] = zone;
  }

  const nextPlacementsByListId = { ...snapshot.placementsByListId };

  if (Object.keys(nextPlacements).length > 0) {
    nextPlacementsByListId[listId] = nextPlacements;
  } else {
    delete nextPlacementsByListId[listId];
  }

  return {
    ...snapshot,
    placementsByListId: nextPlacementsByListId
  };
}

export function getSeatingGeneratorOptionsForList(
  snapshot: SeatingChartSnapshot,
  listId: string
): SeatingGeneratorOptions {
  return snapshot.generatorOptionsByListId[listId] ?? DEFAULT_SEATING_GENERATOR_OPTIONS;
}

export function setSeatingGeneratorOptionsForList(
  snapshot: SeatingChartSnapshot,
  listId: string,
  options: SeatingGeneratorOptions
): SeatingChartSnapshot {
  return {
    ...snapshot,
    generatorOptionsByListId: {
      ...snapshot.generatorOptionsByListId,
      [listId]: options
    }
  };
}

export function getSeatingStudentNote(
  item: SeatingChartLayoutItem | null,
  studentNotes: Record<string, string>
) {
  if (!item || item.kind !== 'seat' || !item.assignedStudent) {
    return null;
  }

  const note = studentNotes[item.assignedStudent];
  return note && note.trim() ? note.trim() : null;
}

export function applySeatingChartAssignments(
  layout: SeatingChartLayout,
  students: (string | null)[]
) {
  const seats = getSeatingChartSeatItems(layout);
  const assignments = new Map<string, string | null>();

  seats.forEach((seat, index) => {
    assignments.set(seat.id, students[index] ?? null);
  });

  return {
    ...layout,
    items: layout.items.map((item) =>
      item.kind === 'seat'
        ? {
            ...item,
            assignedStudent: assignments.get(item.id) ?? null
          }
        : item
    ),
    updatedAt: Date.now()
  };
}

export function buildSeatingChartItemTitle(item: SeatingChartLayoutItem) {
  if (item.kind !== 'seat') {
    return `${SEATING_CHART_ITEM_DETAILS[item.kind].title}: ${item.label}`;
  }

  const title = item.assignedStudent ? item.assignedStudent : 'Empty seat';
  return item.locked ? `${title} (locked)` : title;
}

export function getSeatingChartPreviewToken(item: SeatingChartLayoutItem) {
  if (item.kind === 'seat') {
    return item.assignedStudent ? formatStudentInitials(item.assignedStudent) : '';
  }

  if (item.kind === 'teacher-desk') {
    return 'T';
  }

  if (item.kind === 'board') {
    return 'B';
  }

  if (item.kind === 'door') {
    return 'D';
  }

  return 'S';
}

export function getSeatingChartPreviewTooltip(item: SeatingChartLayoutItem) {
  if (item.kind === 'seat') {
    return buildSeatingChartItemTitle(item);
  }

  return SEATING_CHART_ITEM_DETAILS[item.kind].title;
}

export function getSeatingChartToolToneClass(tool: SeatingChartTool) {
  if (tool === 'seat' || tool === 'rows') {
    return 'button-tone--action';
  }

  if (tool === 'erase') {
    return 'button-tone--warning';
  }

  if (tool === 'select') {
    return 'button-tone--utility';
  }

  if (tool === 'door') {
    return 'button-tone--warning';
  }

  if (tool === 'board') {
    return 'button-tone--theme';
  }

  return 'button-tone--utility';
}

export function writeSeatingChartDragPayload(
  dataTransfer: DataTransfer,
  payload: SeatingChartDragPayload
) {
  const serializedPayload = JSON.stringify(payload);
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(SEATING_CHART_DRAG_MIME, serializedPayload);
  dataTransfer.setData('text/plain', serializedPayload);
}

export function readSeatingChartDragPayload(dataTransfer: DataTransfer) {
  try {
    const raw =
      dataTransfer.getData(SEATING_CHART_DRAG_MIME) ||
      dataTransfer.getData('text/plain');
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SeatingChartDragPayload>;

    if (parsed.type === 'item' && typeof parsed.itemId === 'string') {
      return {
        itemId: parsed.itemId,
        type: 'item'
      } satisfies SeatingChartDragPayload;
    }

    if (
      parsed.type === 'student' &&
      typeof parsed.studentName === 'string' &&
      (typeof parsed.sourceSeatId === 'string' || parsed.sourceSeatId === null)
    ) {
      return {
        sourceSeatId: parsed.sourceSeatId,
        studentName: parsed.studentName,
        type: 'student'
      } satisfies SeatingChartDragPayload;
    }
  } catch {
    // Ignore invalid drag payloads.
  }

  return null;
}

export function hasSeatingChartDragPayload(dataTransfer: DataTransfer) {
  if (Array.from(dataTransfer.types).includes(SEATING_CHART_DRAG_MIME)) {
    return true;
  }

  return readSeatingChartDragPayload(dataTransfer) !== null;
}

export function createSeatingChartLayoutName(
  existingLayouts: SeatingChartLayout[],
  baseName: string
) {
  const seenNames = new Set(existingLayouts.map((layout) => activeLayoutNameForSeatingChart(layout).toLowerCase()));
  const normalizedBase = baseName.trim() || 'Layout';

  if (!seenNames.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let suffix = 2;

  while (seenNames.has(`${normalizedBase} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }

  return `${normalizedBase} ${suffix}`;
}

export function createSeatingChartLayoutId() {
  return `seating-layout-${createStickyNoteId()}`;
}

export function createSeatingChartLayoutItemId() {
  return `seating-item-${createStickyNoteId()}`;
}

export function isSeatingChartItemKind(value: unknown): value is SeatingChartItemKind {
  return (
    value === 'seat' ||
    value === 'teacher-desk' ||
    value === 'board' ||
    value === 'door' ||
    value === 'storage'
  );
}

export function isSeatingChartSeatStyle(value: unknown): value is SeatingChartSeatStyle {
  return value === 'desk' || value === 'round';
}

export const SEATING_EXPORT_CELL_WIDTH = 96;

export const SEATING_EXPORT_CELL_HEIGHT = 72;

export const SEATING_EXPORT_GAP = 8;

export const SEATING_EXPORT_MARGIN = 36;

export function exportSeatingChartPng(
  layout: SeatingChartLayout,
  className: string,
  studentNotes: Record<string, string> = {},
  flipped = false
) {
  const canvas = renderSeatingChartCanvas(layout, className, studentNotes, flipped);

  if (!canvas) {
    return;
  }

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `seating-${sanitizeSeatingFileSegment(className)}-${sanitizeSeatingFileSegment(
    activeLayoutNameForSeatingChart(layout)
  )}.png`;
  link.click();
}

export function copySeatingChartPngToClipboard(
  layout: SeatingChartLayout,
  className: string,
  studentNotes: Record<string, string> = {},
  flipped = false
) {
  const canvas = renderSeatingChartCanvas(layout, className, studentNotes, flipped);

  if (!canvas) {
    return;
  }

  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }

    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blob })])
      .then(() => showUndoToast('Copied seating chart image'))
      .catch(() => announce('Could not copy the seating chart image'));
  }, 'image/png');
}

export function renderSeatingChartCanvas(
  layout: SeatingChartLayout,
  className: string,
  studentNotes: Record<string, string>,
  flipped = false
) {
  const cellWidth = SEATING_EXPORT_CELL_WIDTH;
  const cellHeight = SEATING_EXPORT_CELL_HEIGHT;
  const gap = SEATING_EXPORT_GAP;
  const margin = SEATING_EXPORT_MARGIN;
  const titleHeight = 56;
  const notedStudents = getSeatingChartSeatItems(layout)
    .map((seat) => seat.assignedStudent)
    .filter((student): student is string => Boolean(student && studentNotes[student]?.trim()));
  const legendLineHeight = 20;
  const legendHeight = notedStudents.length > 0 ? notedStudents.length * legendLineHeight + 24 : 0;
  const gridWidth = SEATING_CHART_GRID_COLUMNS * cellWidth + (SEATING_CHART_GRID_COLUMNS - 1) * gap;
  const gridHeight = SEATING_CHART_GRID_ROWS * cellHeight + (SEATING_CHART_GRID_ROWS - 1) * gap;
  const width = margin * 2 + gridWidth;
  const height = margin * 2 + titleHeight + gridHeight + legendHeight;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.scale(scale, scale);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.textBaseline = 'middle';

  context.fillStyle = '#1f2937';
  context.font = '600 20px system-ui, sans-serif';
  context.fillText(`${className} — ${activeLayoutNameForSeatingChart(layout)}`, margin, margin + 10);
  context.fillStyle = '#6b7280';
  context.font = '400 13px system-ui, sans-serif';
  context.fillText(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date()),
    margin,
    margin + 34
  );

  const gridTop = margin + titleHeight;
  const itemsByCell = new Map(
    layout.items.map((item) => [getSeatingChartCellKey(item.x, item.y), item])
  );

  for (let y = 0; y < SEATING_CHART_GRID_ROWS; y += 1) {
    for (let x = 0; x < SEATING_CHART_GRID_COLUMNS; x += 1) {
      const cellX = margin + x * (cellWidth + gap);
      const cellY = gridTop + y * (cellHeight + gap);
      const sourceX = flipped ? SEATING_CHART_GRID_COLUMNS - 1 - x : x;
      const sourceY = flipped ? SEATING_CHART_GRID_ROWS - 1 - y : y;
      const item = itemsByCell.get(getSeatingChartCellKey(sourceX, sourceY)) ?? null;

      if (!item) {
        context.fillStyle = '#f3f4f6';
        drawSeatingExportRect(context, cellX, cellY, cellWidth, cellHeight, 8);
        continue;
      }

      context.fillStyle = item.color;
      drawSeatingExportRect(context, cellX, cellY, cellWidth, cellHeight, item.kind === 'seat' && item.seatStyle === 'round' ? cellHeight / 2 : 10);

      context.fillStyle = 'rgba(255, 255, 255, 0.92)';
      if (item.kind === 'seat') {
        context.font = '400 10px system-ui, sans-serif';
        context.fillText(item.label, cellX + 8, cellY + 12);
        context.font = '600 13px system-ui, sans-serif';
        const studentLabel = item.assignedStudent
          ? fitSeatingExportText(context, item.assignedStudent, cellWidth - 16)
          : '';
        const labelWidth = context.measureText(studentLabel).width;
        context.fillText(studentLabel, cellX + (cellWidth - labelWidth) / 2, cellY + cellHeight / 2 + 4);

        if (item.assignedStudent && studentNotes[item.assignedStudent]?.trim()) {
          context.fillStyle = '#f59e0b';
          context.beginPath();
          context.arc(cellX + cellWidth - 12, cellY + 12, 5, 0, Math.PI * 2);
          context.fill();
        }
      } else {
        context.font = '600 13px system-ui, sans-serif';
        const label = fitSeatingExportText(context, item.label, cellWidth - 16);
        const labelWidth = context.measureText(label).width;
        context.fillText(label, cellX + (cellWidth - labelWidth) / 2, cellY + cellHeight / 2);
      }
    }
  }

  if (notedStudents.length > 0) {
    let legendY = gridTop + gridHeight + 28;
    context.font = '400 13px system-ui, sans-serif';

    for (const student of notedStudents) {
      context.fillStyle = '#f59e0b';
      context.beginPath();
      context.arc(margin + 5, legendY, 5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#374151';
      context.fillText(
        fitSeatingExportText(context, `${student} — ${studentNotes[student].trim()}`, width - margin * 2 - 20),
        margin + 18,
        legendY
      );
      legendY += legendLineHeight;
    }
  }

  return canvas;
}

export function drawSeatingExportRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const clampedRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, clampedRadius);
  context.arcTo(x + width, y + height, x, y + height, clampedRadius);
  context.arcTo(x, y + height, x, y, clampedRadius);
  context.arcTo(x, y, x + width, y, clampedRadius);
  context.closePath();
  context.fill();
}

export function fitSeatingExportText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let fitted = text;

  while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth) {
    fitted = fitted.slice(0, -1);
  }

  return `${fitted}…`;
}

export function sanitizeSeatingFileSegment(value: string) {
  const segment = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return segment || 'chart';
}
