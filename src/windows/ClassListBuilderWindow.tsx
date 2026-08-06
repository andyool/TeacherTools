import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import type { DesktopWindowContext } from '../electron-types';
import { InterfaceScaleControls, useInterfaceScaleControls } from '../app/interfaceScale';
import { useResolvedTheme, useThemePreferenceState } from '../app/theme';
import { fallbackContext } from '../app/windowContext';
import { cascadeStudentRenames, detectStudentRenames } from '../shared/classDataCleanup';
import { announce, requestConfirm, showUndoToast } from '../shared/uiKit';
import { dedupeNames, splitNames } from '../shared/utils';
import { WINDOW_EDGE_MARGIN } from '../shared/windowSizing';
import {
  activateClassList,
  createPredictableListId,
  isClassListVisible,
  upsertClassList
} from '../widgets/classLists';
import {
  removeClassListFromPicker,
  usePickerState,
  type PickerSnapshot
} from '../widgets/picker';

export const CLASS_LIST_TEXTAREA_MIN_HEIGHT = 176;

const CSV_HEADER_PATTERN =
  /^(names?|students?|student[ _-]?names?|full[ _-]?names?|first[ _-]?names?|pupils?|learners?)$/i;

function readFirstCsvCell(line: string) {
  const cleaned = line.replace(/^\uFEFF/, '');

  if (cleaned.startsWith('"')) {
    let value = '';
    let index = 1;
    while (index < cleaned.length) {
      const character = cleaned[index];
      if (character === '"') {
        if (cleaned[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        break;
      }
      value += character;
      index += 1;
    }
    return value.trim();
  }

  const delimiterIndex = cleaned.search(/[,;\t]/);
  return (delimiterIndex === -1 ? cleaned : cleaned.slice(0, delimiterIndex)).trim();
}

export function parseRosterImport(text: string) {
  const cells = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0)
    .map(readFirstCsvCell)
    .filter(Boolean);

  if (cells.length > 0 && CSV_HEADER_PATTERN.test(cells[0])) {
    cells.shift();
  }

  return dedupeNames(cells);
}

function looksLikeCsvPaste(text: string) {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return false;
  }

  const delimited = lines.filter((line) => /[,;\t]/.test(line)).length;
  return delimited >= Math.ceil(lines.length / 2);
}

function escapeCsvCell(value: string) {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function sanitizeStudentName(value: string) {
  return value.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
}

type PendingImport = {
  names: string[];
  source: 'file' | 'paste';
};

export function ClassListBuilderWindow({ windowContext }: { windowContext: DesktopWindowContext }) {
  const stageRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastRequestedHeightRef = useRef(0);
  const focusRosterIndexRef = useRef<number | null>(null);
  const [picker, setPicker] = usePickerState();
  const [themePreference] = useThemePreferenceState();
  const {
    canDecreaseInterfaceScale,
    canIncreaseInterfaceScale,
    decreaseInterfaceScale,
    increaseInterfaceScale,
    interfaceScale
  } = useInterfaceScaleControls();
  const resolvedTheme = useResolvedTheme(themePreference);
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const [builderListId, setBuilderListId] = useState<string | null>(() => selectedList?.id ?? null);
  const [builderListName, setBuilderListName] = useState(() => selectedList?.name ?? '');
  const [builderStudents, setBuilderStudents] = useState(() =>
    selectedList ? selectedList.students.join('\n') : ''
  );
  const [isCreatingNewList, setIsCreatingNewList] = useState(() => !selectedList);
  const [studentsView, setStudentsView] = useState<'text' | 'list'>(() =>
    selectedList ? 'list' : 'text'
  );
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [isArchivedSectionOpen, setIsArchivedSectionOpen] = useState(false);
  const [editingStudentIndex, setEditingStudentIndex] = useState<number | null>(null);
  const [editingStudentValue, setEditingStudentValue] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const hasPendingImport = pendingImport !== null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (hasPendingImport) {
        setPendingImport(null);
        return;
      }

      window.electronAPI?.closeClassListBuilder();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasPendingImport]);

  useEffect(() => {
    if (isCreatingNewList) {
      return;
    }

    if (builderListId) {
      const activeList = picker.lists.find((list) => list.id === builderListId);
      if (activeList) {
        return;
      }
    }

    if (selectedList) {
      setBuilderListId(selectedList.id);
      setBuilderListName(selectedList.name);
      setBuilderStudents(selectedList.students.join('\n'));
      return;
    }

    setIsCreatingNewList(true);
    setBuilderListId(null);
    setBuilderListName('');
    setBuilderStudents('');
  }, [builderListId, isCreatingNewList, picker.lists, selectedList]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const panel = panelRef.current;
    const stage = stageRef.current;

    if (!textarea || !panel || !stage) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.overflowY = 'hidden';

    const naturalTextareaHeight = Math.max(textarea.scrollHeight, CLASS_LIST_TEXTAREA_MIN_HEIGHT);
    textarea.style.height = `${naturalTextareaHeight}px`;

    const stageStyles = window.getComputedStyle(stage);
    const stagePadding =
      parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
    const display = windowContext.anchor?.display ?? fallbackContext.anchor?.display;
    const windowTop =
      (typeof window.screenY === 'number' && Number.isFinite(window.screenY)
        ? window.screenY
        : typeof window.screenTop === 'number' && Number.isFinite(window.screenTop)
          ? window.screenTop
          : null) ?? (display ? display.y + WINDOW_EDGE_MARGIN : WINDOW_EDGE_MARGIN);
    const maxWindowHeight = display
      ? Math.max(0, display.y + display.height - windowTop - WINDOW_EDGE_MARGIN)
      : Number.POSITIVE_INFINITY;
    const naturalWindowHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);
    const overflow = Number.isFinite(maxWindowHeight)
      ? Math.max(0, naturalWindowHeight - maxWindowHeight)
      : 0;
    const nextTextareaHeight = Math.max(
      CLASS_LIST_TEXTAREA_MIN_HEIGHT,
      naturalTextareaHeight - overflow
    );

    textarea.style.height = `${nextTextareaHeight}px`;
    textarea.style.overflowY = nextTextareaHeight < naturalTextareaHeight ? 'auto' : 'hidden';
  }, [builderStudents, builderListId, interfaceScale, isCreatingNewList, studentsView, windowContext]);

  useLayoutEffect(() => {
    if (!window.electronAPI || !stageRef.current || !panelRef.current) {
      return;
    }

    const stage = stageRef.current;
    const panel = panelRef.current;
    let cancelled = false;

    const reportHeight = () => {
      const stageStyles = window.getComputedStyle(stage);
      const stagePadding =
        parseFloat(stageStyles.paddingTop || '0') + parseFloat(stageStyles.paddingBottom || '0');
      const desiredHeight = Math.ceil(Math.max(panel.scrollHeight, panel.offsetHeight) + stagePadding);

      if (desiredHeight === lastRequestedHeightRef.current) {
        return;
      }

      lastRequestedHeightRef.current = desiredHeight;
      window.electronAPI?.getCurrentWindowBounds().then((bounds) => {
        if (cancelled) {
          return;
        }

        window.electronAPI?.setCurrentWindowBounds({
          ...bounds,
          height: desiredHeight
        });
      });
    };

    reportHeight();

    if (typeof ResizeObserver !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(reportHeight);
    });

    resizeObserver.observe(panel);
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [builderListId, builderStudents, interfaceScale, isCreatingNewList, picker.lists.length]);

  const draftStudents = splitNames(builderStudents);
  const effectiveStudentsView = draftStudents.length > 0 ? studentsView : 'text';
  const visibleLists = picker.lists.filter(isClassListVisible);
  const archivedLists = picker.lists.filter((list) => !isClassListVisible(list));

  useEffect(() => {
    const focusIndex = focusRosterIndexRef.current;
    if (focusIndex === null) {
      return;
    }

    focusRosterIndexRef.current = null;
    const row = panelRef.current?.querySelector<HTMLElement>(`[data-roster-index="${focusIndex}"]`);
    row?.focus({ preventScroll: true });
  }, [builderStudents]);

  const startNewList = () => {
    setIsCreatingNewList(true);
    setBuilderListId(null);
    setBuilderListName('');
    setBuilderStudents('');
    setStudentsView('text');
    setPendingImport(null);
    setEditingStudentIndex(null);
  };

  const openListInEditor = (listId: string, name: string, students: string[]) => {
    setIsCreatingNewList(false);
    setBuilderListId(listId);
    setBuilderListName(name);
    setBuilderStudents(students.join('\n'));
    setStudentsView('list');
    setPendingImport(null);
    setEditingStudentIndex(null);
  };

  const editList = (listId: string) => {
    const nextList = picker.lists.find((list) => list.id === listId);
    if (!nextList) {
      return;
    }

    setPicker((current) => activateClassList(current, listId));
    openListInEditor(nextList.id, nextList.name, nextList.students);
  };

  const saveClassList = () => {
    const nextName = builderListName.trim();
    if (!nextName || !draftStudents.length) {
      return;
    }

    const targetListId =
      builderListId ??
      createPredictableListId(nextName, picker.lists.map((list) => list.id));

    // Carry seat assignments, rules, homework ticks and pick history across
    // renames/casing fixes instead of orphaning them.
    const previousList = picker.lists.find((list) => list.id === targetListId);
    if (previousList) {
      cascadeStudentRenames(detectStudentRenames(previousList.students, draftStudents));
    }

    setPicker((current) =>
      upsertClassList(current, {
        listId: targetListId,
        name: nextName,
        students: draftStudents
      })
    );

    setIsCreatingNewList(false);
    setBuilderListId(targetListId);
    setBuilderListName(nextName);
    setBuilderStudents(draftStudents.join('\n'));
    announce(`Saved "${nextName}"`);
  };

  const deleteClassList = async () => {
    if (!builderListId) {
      return;
    }

    const targetList = picker.lists.find((list) => list.id === builderListId);
    if (!targetList) {
      return;
    }

    const confirmed = await requestConfirm({
      title: `Delete "${targetList.name}"?`,
      message: 'Its pick history and absences go with it.',
      tone: 'danger',
      confirmLabel: 'Delete'
    });

    if (!confirmed) {
      return;
    }

    const listIndex = picker.lists.findIndex((list) => list.id === targetList.id);
    const absenceRecord = picker.absentByListId[targetList.id];
    const historyRecord = picker.historyByListId[targetList.id];

    setPicker((current) => removeClassListFromPicker(current, targetList.id));
    startNewList();

    showUndoToast(`Deleted "${targetList.name}"`, () => {
      setPicker((current) => {
        if (current.lists.some((list) => list.id === targetList.id)) {
          return activateClassList(current, targetList.id);
        }

        const nextLists = [...current.lists];
        nextLists.splice(Math.min(Math.max(listIndex, 0), nextLists.length), 0, targetList);
        const restored: PickerSnapshot = {
          ...current,
          lists: nextLists,
          absentByListId: absenceRecord
            ? { ...current.absentByListId, [targetList.id]: absenceRecord }
            : current.absentByListId,
          historyByListId: historyRecord
            ? { ...current.historyByListId, [targetList.id]: historyRecord }
            : current.historyByListId
        };
        return activateClassList(restored, targetList.id);
      });
      openListInEditor(targetList.id, targetList.name, targetList.students);
    });
  };

  const duplicateList = () => {
    const sourceList = picker.lists.find((list) => list.id === builderListId);
    if (!sourceList) {
      return;
    }

    const takenNames = picker.lists.map((list) => list.name.toLowerCase());
    let nextName = `${sourceList.name} copy`;
    let suffix = 2;
    while (takenNames.includes(nextName.toLowerCase())) {
      nextName = `${sourceList.name} copy ${suffix}`;
      suffix += 1;
    }

    const nextListId = createPredictableListId(nextName, picker.lists.map((list) => list.id));
    setPicker((current) =>
      upsertClassList(current, {
        listId: nextListId,
        name: nextName,
        students: sourceList.students
      })
    );
    openListInEditor(nextListId, nextName, sourceList.students);
    announce(`Duplicated as "${nextName}"`);
  };

  const setListArchived = (listId: string, archived: boolean) => {
    setPicker((current) => {
      const nextSnapshot: PickerSnapshot = {
        ...current,
        lists: current.lists.map((list) =>
          list.id === listId
            ? archived
              ? { ...list, archived: true }
              : { ...list, archived: undefined }
            : list
        )
      };

      if (archived && nextSnapshot.selectedListId === listId) {
        const fallbackList = nextSnapshot.lists.find(
          (list) => list.id !== listId && isClassListVisible(list)
        );
        if (fallbackList) {
          return activateClassList(nextSnapshot, fallbackList.id);
        }
      }

      if (!archived) {
        return activateClassList(nextSnapshot, listId);
      }

      return nextSnapshot;
    });
  };

  const archiveCurrentList = () => {
    const targetList = picker.lists.find((list) => list.id === builderListId);
    if (!targetList) {
      return;
    }

    setListArchived(targetList.id, true);

    const nextVisibleList = picker.lists.find(
      (list) => list.id !== targetList.id && isClassListVisible(list)
    );
    if (nextVisibleList) {
      openListInEditor(nextVisibleList.id, nextVisibleList.name, nextVisibleList.students);
    } else {
      startNewList();
    }

    showUndoToast(`Archived "${targetList.name}"`, () => {
      setListArchived(targetList.id, false);
      openListInEditor(targetList.id, targetList.name, targetList.students);
    });
  };

  const unarchiveList = (listId: string) => {
    const targetList = picker.lists.find((list) => list.id === listId);
    if (!targetList) {
      return;
    }

    setListArchived(listId, false);
    openListInEditor(targetList.id, targetList.name, targetList.students);
    announce(`Unarchived "${targetList.name}"`);
  };

  const copyNames = async () => {
    if (!draftStudents.length) {
      return;
    }

    try {
      await navigator.clipboard.writeText(draftStudents.join('\n'));
      showUndoToast(`Copied ${draftStudents.length} name${draftStudents.length === 1 ? '' : 's'}`);
    } catch {
      announce('Copy failed');
    }
  };

  const downloadCsv = () => {
    if (!draftStudents.length) {
      return;
    }

    const csv = ['Name', ...draftStudents.map(escapeCsvCell)].join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const slug = builderListName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    anchor.href = url;
    anchor.download = `${slug || 'class-list'}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    file.text().then((text) => {
      const names = parseRosterImport(text);
      if (!names.length) {
        announce('No names found in that file');
        return;
      }

      setPendingImport({ names, source: 'file' });
      announce(`${names.length} name${names.length === 1 ? '' : 's'} ready to import`);
    });
  };

  const handleStudentsPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    if (!text || !looksLikeCsvPaste(text)) {
      return;
    }

    const names = parseRosterImport(text);
    if (!names.length) {
      return;
    }

    event.preventDefault();
    setPendingImport({ names, source: 'paste' });
    announce(`${names.length} name${names.length === 1 ? '' : 's'} ready to import`);
  };

  const applyImport = (mode: 'replace' | 'append') => {
    if (!pendingImport) {
      return;
    }

    const nextStudents =
      mode === 'append'
        ? dedupeNames([...draftStudents, ...pendingImport.names])
        : pendingImport.names;
    setBuilderStudents(nextStudents.join('\n'));
    setPendingImport(null);
    announce(
      `Imported ${pendingImport.names.length} name${pendingImport.names.length === 1 ? '' : 's'}`
    );
  };

  const moveStudent = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= draftStudents.length || fromIndex === toIndex) {
      return;
    }

    const nextStudents = [...draftStudents];
    const [movedName] = nextStudents.splice(fromIndex, 1);
    nextStudents.splice(toIndex, 0, movedName);
    setBuilderStudents(nextStudents.join('\n'));
    focusRosterIndexRef.current = toIndex;
    announce(`${movedName} moved to position ${toIndex + 1} of ${nextStudents.length}`);
  };

  const removeStudent = (index: number) => {
    const removedName = draftStudents[index];
    if (removedName === undefined) {
      return;
    }

    const nextStudents = draftStudents.filter((_, studentIndex) => studentIndex !== index);
    setBuilderStudents(nextStudents.join('\n'));
    announce(`Removed ${removedName}`);
  };

  const startRename = (index: number) => {
    setEditingStudentIndex(index);
    setEditingStudentValue(draftStudents[index] ?? '');
  };

  const commitRename = () => {
    if (editingStudentIndex === null) {
      return;
    }

    const renameIndex = editingStudentIndex;
    const currentName = draftStudents[renameIndex];
    const nextName = sanitizeStudentName(editingStudentValue);
    setEditingStudentIndex(null);

    if (!nextName || currentName === undefined || nextName === currentName) {
      return;
    }

    const collides = draftStudents.some(
      (name, index) => index !== renameIndex && name.toLowerCase() === nextName.toLowerCase()
    );
    if (collides) {
      announce(`"${nextName}" is already on this list`);
      return;
    }

    setBuilderStudents(
      draftStudents.map((name, index) => (index === renameIndex ? nextName : name)).join('\n')
    );
    announce(`Renamed ${currentName} to ${nextName}`);
  };

  const handleRosterRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveStudent(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
      return;
    }

    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      startRename(index);
    }
  };

  const handleRosterDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      moveStudent(dragIndex, index);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <main
      aria-label="Class list builder"
      className="window-stage window-stage--builder window-stage--class-list-builder"
      ref={stageRef}
    >
      <section
        className="panel panel--builder panel--class-list-builder"
        data-theme={resolvedTheme}
        ref={panelRef}
      >
        <div aria-hidden="true" className="panel__glass" />
        <div aria-hidden="true" className="panel__gloss" />
        <div aria-hidden="true" className="panel__bezel-mid" />
        <div className="panel__content">
          <header className="panel-header">
            <div className="panel-header__title">
              <span className="panel-kicker">Class lists</span>
              <h1 className="panel-title">Builder</h1>
            </div>
            <div className="panel-actions">
              <InterfaceScaleControls
                canDecrease={canDecreaseInterfaceScale}
                canIncrease={canIncreaseInterfaceScale}
                onDecrease={decreaseInterfaceScale}
                onIncrease={increaseInterfaceScale}
                scale={interfaceScale}
              />
              <button className="toolbar-link button-tone--action" onClick={startNewList} type="button">
                New
              </button>
              <button
                aria-label="Close class list builder"
                className="icon-button icon-button--close"
                onClick={() => window.electronAPI?.closeClassListBuilder()}
                type="button"
              >
                ×
              </button>
            </div>
          </header>

          <div className="builder-layout builder-layout--class-list">
            <aside className="builder-sidebar">
              <div className="builder-sidebar__head">
                <span className="card-label">Lists</span>
                <span className="badge">{visibleLists.length}</span>
              </div>

              <div className="builder-list">
                {visibleLists.length > 0 ? (
                  visibleLists.map((list) => (
                    <button
                      className={`builder-list__button ${
                        list.id === builderListId ? 'builder-list__button--active' : ''
                      }`}
                      key={list.id}
                      onClick={() => editList(list.id)}
                      type="button"
                    >
                      <span>{list.name}</span>
                      <span>{list.students.length}</span>
                    </button>
                  ))
                ) : (
                  <p className="empty-copy">No lists yet.</p>
                )}
              </div>

              {archivedLists.length > 0 && (
                <div className="builder-archived">
                  <button
                    aria-expanded={isArchivedSectionOpen}
                    className="builder-archived__toggle"
                    onClick={() => setIsArchivedSectionOpen((open) => !open)}
                    type="button"
                  >
                    <span aria-hidden="true" className="builder-archived__caret">
                      {isArchivedSectionOpen ? '▾' : '▸'}
                    </span>
                    Archived ({archivedLists.length})
                  </button>
                  {isArchivedSectionOpen && (
                    <div className="builder-archived__list">
                      {archivedLists.map((list) => (
                        <div className="builder-archived__row" key={list.id}>
                          <span className="builder-archived__name">{list.name}</span>
                          <button
                            aria-label={`Unarchive ${list.name}`}
                            className="toolbar-link builder-archived__action"
                            onClick={() => unarchiveList(list.id)}
                            type="button"
                          >
                            Unarchive
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </aside>

            <section className="builder-editor">
              <div className="field-stack">
                <label className="field-label" htmlFor="class-list-name">
                  List name
                </label>
                <input
                  className="text-field"
                  id="class-list-name"
                  onChange={(event) => setBuilderListName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveClassList();
                    }
                  }}
                  placeholder="Period 1"
                  type="text"
                  value={builderListName}
                />
              </div>

              <div className="field-stack field-stack--fill builder-students-field">
                <div className="builder-roster-head">
                  <span className="field-label" id="class-list-students-label">
                    Students
                  </span>
                  <div className="builder-roster-head__actions">
                    <input
                      accept=".csv,.txt,text/csv,text/plain"
                      aria-hidden="true"
                      className="builder-import-input"
                      onChange={handleImportFile}
                      ref={fileInputRef}
                      tabIndex={-1}
                      type="file"
                    />
                    <button
                      aria-label="Import names from a CSV or text file"
                      className="toolbar-link"
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      Import
                    </button>
                    {draftStudents.length > 0 && (
                      <div aria-label="Roster view" className="builder-view-toggle" role="group">
                        <button
                          aria-pressed={effectiveStudentsView === 'list'}
                          className="builder-view-toggle__button"
                          onClick={() => setStudentsView('list')}
                          type="button"
                        >
                          List
                        </button>
                        <button
                          aria-pressed={effectiveStudentsView === 'text'}
                          className="builder-view-toggle__button"
                          onClick={() => setStudentsView('text')}
                          type="button"
                        >
                          Text
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {pendingImport && (
                  <div className="builder-import-preview" role="status">
                    <span className="builder-import-preview__chip">
                      {pendingImport.names.length} name{pendingImport.names.length === 1 ? '' : 's'}
                    </span>
                    {draftStudents.length > 0 ? (
                      <>
                        <button
                          className="toolbar-link"
                          onClick={() => applyImport('replace')}
                          type="button"
                        >
                          Replace
                        </button>
                        <button
                          className="toolbar-link"
                          onClick={() => applyImport('append')}
                          type="button"
                        >
                          Add
                        </button>
                      </>
                    ) : (
                      <button
                        className="toolbar-link"
                        onClick={() => applyImport('replace')}
                        type="button"
                      >
                        Use
                      </button>
                    )}
                    <button
                      aria-label="Dismiss import preview"
                      className="builder-import-preview__dismiss"
                      onClick={() => setPendingImport(null)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                )}

                {effectiveStudentsView === 'text' ? (
                  <textarea
                    aria-labelledby="class-list-students-label"
                    className="text-area text-area--builder"
                    id="class-list-students"
                    onChange={(event) => setBuilderStudents(event.target.value)}
                    onPaste={handleStudentsPaste}
                    placeholder="One name per line or separated by commas"
                    ref={textareaRef}
                    value={builderStudents}
                  />
                ) : (
                  <div
                    aria-labelledby="class-list-students-label"
                    className="builder-roster"
                    role="list"
                  >
                    {draftStudents.map((studentName, index) => (
                      <div
                        aria-label={`${studentName}, ${index + 1} of ${draftStudents.length}. Enter to rename, Alt with arrow keys to reorder.`}
                        className={`builder-roster__row${
                          dragOverIndex === index ? ' builder-roster__row--drop' : ''
                        }${dragIndex === index ? ' builder-roster__row--dragging' : ''}`}
                        data-roster-index={index}
                        draggable={editingStudentIndex === null}
                        key={studentName}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDragOver={(event) => {
                          if (dragIndex === null) {
                            return;
                          }
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          if (dragOverIndex !== index) {
                            setDragOverIndex(index);
                          }
                        }}
                        onDragStart={(event) => {
                          setDragIndex(index);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', studentName);
                        }}
                        onDrop={(event) => handleRosterDrop(event, index)}
                        onKeyDown={(event) => handleRosterRowKeyDown(event, index)}
                        role="listitem"
                        tabIndex={0}
                      >
                        <span aria-hidden="true" className="builder-roster__grip">
                          ⋮⋮
                        </span>
                        {editingStudentIndex === index ? (
                          <input
                            aria-label={`Rename ${studentName}`}
                            autoFocus
                            className="builder-roster__input"
                            onBlur={commitRename}
                            onChange={(event) => setEditingStudentValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitRename();
                              } else if (event.key === 'Escape') {
                                event.stopPropagation();
                                setEditingStudentIndex(null);
                              }
                            }}
                            type="text"
                            value={editingStudentValue}
                          />
                        ) : (
                          <button
                            aria-label={`Rename ${studentName}`}
                            className="builder-roster__name"
                            onClick={() => startRename(index)}
                            tabIndex={-1}
                            type="button"
                          >
                            {studentName}
                          </button>
                        )}
                        <button
                          aria-label={`Remove ${studentName}`}
                          className="builder-roster__remove"
                          onClick={() => removeStudent(index)}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="helper-text">
                  {draftStudents.length} student{draftStudents.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="builder-footer builder-footer--class-list">
                <button
                  className="primary-link"
                  disabled={!builderListName.trim() || draftStudents.length === 0}
                  onClick={saveClassList}
                  type="button"
                >
                  {builderListId ? 'Save list' : 'Add list'}
                </button>
                {builderListId && (
                  <>
                    <div className="builder-footer__tools">
                      <button className="toolbar-link" onClick={duplicateList} type="button">
                        Duplicate
                      </button>
                      <button
                        aria-label="Copy names to clipboard"
                        className="toolbar-link"
                        onClick={() => void copyNames()}
                        type="button"
                      >
                        Copy names
                      </button>
                      <button
                        aria-label="Download as CSV"
                        className="toolbar-link"
                        onClick={downloadCsv}
                        type="button"
                      >
                        CSV
                      </button>
                      <button className="toolbar-link" onClick={archiveCurrentList} type="button">
                        Archive
                      </button>
                    </div>
                    <button className="danger-link" onClick={() => void deleteClassList()} type="button">
                      Delete
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
