import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { clampNumber, createStickyNoteId, formatStudentInitials, isString, shuffleNames } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import type { GroupPairRule } from './groupRules';
import { getGroupRulesForList, useGroupRulesState } from './groupRules';
import { usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';

export type SeatingChartItemKind = 'seat' | 'teacher-desk' | 'board' | 'door' | 'storage';

export type SeatingChartSeatStyle = 'desk' | 'round';

export type SeatingChartLayoutItem = {
  assignedStudent: string | null;
  color: string;
  id: string;
  kind: SeatingChartItemKind;
  label: string;
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
  studentNotesByListId: Record<string, Record<string, string>>;
};

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
  studentNotesByListId: {}
};

export const SEATING_RESHUFFLE_ATTEMPTS = 40;

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
                  <button
                    aria-label={buildSeatingChartItemTitle(item)}
                    className={`seating-chart__preview-item seating-chart__preview-item--${item.kind} ${
                      isSeat ? `seating-chart__preview-item--seat-${item.seatStyle}` : ''
                    } ${item.assignedStudent ? 'seating-chart__preview-item--assigned' : ''}`}
                    data-tooltip-content={
                      studentNote
                        ? `${getSeatingChartPreviewTooltip(item)} — ${studentNote}`
                        : getSeatingChartPreviewTooltip(item)
                    }
                    style={
                      {
                        ['--seat-colour' as string]: item.color
                      } as CSSProperties
                    }
                    type="button"
                  >
                    <span className="seating-chart__preview-token">
                      {getSeatingChartPreviewToken(item)}
                    </span>
                    {studentNote ? (
                      <span aria-hidden="true" className="seating-chart__note-flag seating-chart__note-flag--preview" />
                    ) : null}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="seating-chart__preview-footer">
        <p className="helper-text">
          Preview only. Open the editor to change seats or layouts for {selectedList.name}.
        </p>
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
  const [selectedTool, setSelectedTool] = useState<'select' | SeatingChartItemKind | 'erase'>('seat');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedStudentName, setSelectedStudentName] = useState<string | null>(null);
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
        controller.removeItem(itemId);
      }
      setSelectedItemId(null);
      return;
    }

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

  const handleDropToUnseated = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = readSeatingChartDragPayload(event.dataTransfer);

    if (payload?.type === 'student' && payload.sourceSeatId) {
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
        controller.swapSeatAssignments(activeDrag.sourceSeatId, targetSeatId);
      } else {
        controller.assignStudentToSeat(activeDrag.studentName, targetSeatId, activeDrag.sourceSeatId);
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

    controller.assignStudentToSeat(selectedStudentName, seatId);
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
            onChange={(event) => controller.renameActiveLayout(event.target.value)}
            placeholder="Layout name"
            type="text"
            value={activeLayout.name}
          />
        </div>

        <div className="seating-chart__toolbar-actions">
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
          <button
            aria-label="Export this layout as a PNG image"
            className="secondary-link button-tone--utility"
            data-tooltip-content="Save a printable image for a relief teacher"
            onClick={controller.exportActiveLayoutPng}
            type="button"
          >
            Export PNG
          </button>
          <button
            className="danger-link"
            disabled={!controller.canDeleteLayout}
            onClick={controller.deleteActiveLayout}
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
          <span className="seating-chart__stat-label">Unseated</span>
          <strong>{controller.unseatedStudents.length}</strong>
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
              {(['select', 'seat', 'teacher-desk', 'board', 'door', 'storage', 'erase'] as const).map(
                (tool) => (
                  <button
                    className={`text-toggle ${getSeatingChartToolToneClass(tool)} ${
                      selectedTool === tool ? 'text-toggle--active' : ''
                    }`}
                    key={tool}
                    onClick={() => setSelectedTool(tool)}
                    type="button"
                  >
                    {tool === 'select'
                      ? 'Select'
                      : tool === 'erase'
                        ? 'Erase'
                        : SEATING_CHART_ITEM_DETAILS[tool].title}
                  </button>
                )
              )}
            </div>
          ) : null}

          <SeatingChartGrid
            assignmentTargetSeatId={assignmentTargetSeatId}
            compact={false}
            onGridElementChange={(element) => {
              assignmentGridRef.current = element;
            }}
            layout={activeLayout}
            draggingSeatAssignmentId={draggingSeatAssignmentId}
            mode={showArrangeWorkspace ? 'arrange' : 'assign'}
            onGridToolAction={handleGridToolAction}
            onMoveItem={controller.moveItem}
            onSelectItem={setSelectedItemId}
            onSeatActivate={handleSeatActivate}
            onSeatAssignmentPointerDown={startSeatAssignmentPointerDrag}
            onStudentDrop={controller.assignStudentToSeat}
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
              onClick={controller.autofillAssignments}
              type="button"
            >
              Fill from front
            </button>
            <button
              className="secondary-link button-tone--utility"
              data-tooltip-content="Seat the class alphabetically, filling from the front"
              disabled={controller.seatCount === 0 || controller.selectedStudents.length === 0}
              onClick={controller.autofillAlphabetical}
              type="button"
            >
              A–Z
            </button>
            <button
              className="secondary-link button-tone--utility"
              data-tooltip-content={
                controller.apartPairs.length > 0
                  ? 'Random seats that keep keep-apart pairs off neighbouring desks'
                  : 'Shuffle everyone onto random seats'
              }
              disabled={controller.seatCount === 0 || controller.selectedStudents.length === 0}
              onClick={controller.reshuffleAssignments}
              type="button"
            >
              Randomize
            </button>
            <button
              className="secondary-link"
              disabled={controller.assignedSeatCount === 0}
              onClick={controller.clearAssignments}
              type="button"
            >
              Clear seats
            </button>
          </div>

          {!controller.hasEnoughSeats ? (
            <p className="helper-text helper-text--accent">
              Add {controller.selectedStudents.length - controller.seatCount} more seat
              {controller.selectedStudents.length - controller.seatCount === 1 ? '' : 's'} to fit
              the full class.
            </p>
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
                          controller.clearSeatAssignment(activeSeat.id);
                          return;
                        }

                        controller.assignStudentToSeat(event.target.value, activeSeat.id);
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
                          placeholder="e.g. glasses, needs front row, IEP"
                          type="text"
                          value={controller.studentNotes[activeSeat.assignedStudent] ?? ''}
                        />
                        <span className="helper-text">
                          Notes follow the student to any seat and show on hover.
                        </span>
                      </label>
                    ) : null}
                    <p className="helper-text">
                      Drag a student onto this seat, or click a student on the right and then click a seat.
                    </p>
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
                  <span className="field-label">Arrange tools</span>
                  <span className="badge">
                    {selectedTool === 'select'
                      ? 'Select'
                      : selectedTool === 'erase'
                        ? 'Erase'
                        : SEATING_CHART_ITEM_DETAILS[selectedTool].title}
                  </span>
                </div>
                <p className="helper-text">
                  Click any grid square to place items. Drag items to move or swap positions.
                </p>
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
                          onClick={() =>
                            controller.updateItem(activeItem.id, (item) => ({
                              ...item,
                              color
                            }))
                          }
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
                            onClick={() =>
                              controller.updateItem(activeItem.id, (item) => ({
                                ...item,
                                seatStyle
                              }))
                            }
                            type="button"
                          >
                            {seatStyle === 'desk' ? 'Desk' : 'Round'}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <button
                      className="secondary-link"
                      onClick={() => {
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

      <p className="helper-text">
        Saved automatically for {selectedList.name}. Layouts stay attached to this class.
      </p>
    </div>
  );
}

export function SeatingChartGrid({
  assignmentTargetSeatId,
  compact,
  draggingSeatAssignmentId,
  onGridElementChange,
  layout,
  mode,
  onGridToolAction,
  onMoveItem,
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
  onGridElementChange: (element: HTMLDivElement | null) => void;
  layout: SeatingChartLayout;
  mode: 'arrange' | 'assign';
  onGridToolAction: (x: number, y: number, itemId: string | null) => void;
  onMoveItem: (itemId: string, x: number, y: number) => void;
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
  selectedTool: 'select' | SeatingChartItemKind | 'erase';
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
  const suppressClickRef = useRef(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragTargetCellKey, setDragTargetCellKey] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      pointerDragCleanupRef.current?.();
      pointerDragCleanupRef.current = null;
      pointerDragStateRef.current = null;
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
        className={`seating-chart__grid seating-chart__grid--${mode} ${
          compact ? 'seating-chart__grid--compact' : ''
        }`}
        ref={(element) => {
          gridRef.current = element;
          onGridElementChange(element);
        }}
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
              className={`seating-chart__cell ${
                item ? 'seating-chart__cell--occupied' : ''
              } ${isSelected ? 'seating-chart__cell--selected' : ''} ${
                isDragTarget ? 'seating-chart__cell--drag-target' : ''
              } ${isAssignmentTarget ? 'seating-chart__cell--assignment-target' : ''}`}
              data-grid-x={x}
              data-grid-y={y}
              key={key}
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
          <span key={`column-${index + 1}`}>{index + 1}</span>
        ))}
      </div>
      <div className="seating-chart__grid-axis seating-chart__grid-axis--rows">
        {Array.from({ length: SEATING_CHART_GRID_ROWS }, (_value, index) => (
          <span key={`row-${index + 1}`}>{index + 1}</span>
        ))}
      </div>
      {mode === 'arrange' ? (
        <p className="helper-text">
          Active tool:{' '}
          {selectedTool === 'select'
            ? 'Select existing items'
            : selectedTool === 'erase'
              ? 'Erase items from the grid'
              : `Place ${SEATING_CHART_ITEM_DETAILS[selectedTool].title.toLowerCase()} items`}
        </p>
      ) : null}
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
  const seatingChart = useSeatingChartController(selectedList, {
    apartPairs: getGroupRulesForList(groupRules, selectedList?.id ?? null, selectedList?.students ?? [])
      .apart
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
  options?: { apartPairs?: GroupPairRule[] }
) {
  const [seatingChart, setSeatingChart] = useSeatingChartState();
  const apartPairs = options?.apartPairs ?? [];
  const selectedStudents = selectedList?.students ?? [];
  const studentNotes = selectedList
    ? getSeatingStudentNotesForList(seatingChart, selectedList)
    : {};
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
    hasEnoughSeats,
    layoutCount: classState?.layouts.length ?? 0,
    layoutOptions: classState?.layouts ?? [],
    seatCount: seatItems.length,
    seatItems,
    selectedList,
    selectedStudents,
    seatingChart,
    studentNotes,
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
    exportActiveLayoutPng: () => {
      if (activeLayout && selectedList) {
        exportSeatingChartPng(activeLayout, selectedList.name, studentNotes);
      }
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
    reshuffleAssignments: () =>
      updateActiveLayout((layout) =>
        reshuffleSeatingChartLayout(layout, selectedStudents, apartPairs)
      ),
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
    studentNotesByListId?: Record<string, unknown>;
  };
  const chartsByListId: Record<string, SeatingChartClassState> = {};
  const studentNotesByListId: Record<string, Record<string, string>> = {};

  if (nextRaw.chartsByListId && typeof nextRaw.chartsByListId === 'object') {
    for (const [listId, chartRaw] of Object.entries(nextRaw.chartsByListId)) {
      chartsByListId[listId] = normalizeSeatingChartClassState(chartRaw);
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
    studentNotesByListId
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

export function sanitizeSeatingChartLayout(layout: SeatingChartLayout, roster: string[]) {
  const rosterSet = new Set(roster);
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
        normalized.kind === 'seat' && normalized.assignedStudent && rosterSet.has(normalized.assignedStudent)
          ? normalized.assignedStudent
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

export function reshuffleSeatingChartLayout(
  layout: SeatingChartLayout,
  students: string[],
  apartPairs: GroupPairRule[] = []
) {
  if (apartPairs.length === 0) {
    return applySeatingChartAssignments(layout, shuffleNames(students));
  }

  let bestLayout: SeatingChartLayout | null = null;
  let bestViolations = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < SEATING_RESHUFFLE_ATTEMPTS; attempt += 1) {
    const candidate = applySeatingChartAssignments(layout, shuffleNames(students));
    const violations = countSeatingApartViolations(candidate, apartPairs);

    if (violations < bestViolations) {
      bestLayout = candidate;
      bestViolations = violations;
    }

    if (bestViolations === 0) {
      break;
    }
  }

  return bestLayout ?? applySeatingChartAssignments(layout, shuffleNames(students));
}

/**
 * A keep-apart pair violates seating when the two students sit on touching
 * cells (including diagonals).
 */
export function countSeatingApartViolations(
  layout: SeatingChartLayout,
  apartPairs: GroupPairRule[]
) {
  const cellByStudent = new Map<string, { x: number; y: number }>();

  for (const item of layout.items) {
    if (item.kind === 'seat' && item.assignedStudent) {
      cellByStudent.set(item.assignedStudent.toLowerCase(), { x: item.x, y: item.y });
    }
  }

  return apartPairs.filter((pair) => {
    const first = cellByStudent.get(pair[0].toLowerCase());
    const second = cellByStudent.get(pair[1].toLowerCase());

    return (
      first !== undefined &&
      second !== undefined &&
      Math.abs(first.x - second.x) <= 1 &&
      Math.abs(first.y - second.y) <= 1
    );
  }).length;
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

export function applySeatingChartAssignments(layout: SeatingChartLayout, students: string[]) {
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

  return item.assignedStudent ? item.assignedStudent : 'Empty seat';
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

export function getSeatingChartToolToneClass(tool: 'select' | SeatingChartItemKind | 'erase') {
  if (tool === 'seat') {
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
  studentNotes: Record<string, string> = {}
) {
  const canvas = renderSeatingChartCanvas(layout, className, studentNotes);

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

export function renderSeatingChartCanvas(
  layout: SeatingChartLayout,
  className: string,
  studentNotes: Record<string, string>
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
      const item = itemsByCell.get(getSeatingChartCellKey(x, y)) ?? null;

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
