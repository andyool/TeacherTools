import { useEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { announce, showUndoToast } from '../shared/uiKit';
import { createStickyNoteId } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import { usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';

export const STICKY_NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;

const NOTES_SEARCH_AUTO_SHOW_COUNT = 8;

export type StickyNoteColor = (typeof STICKY_NOTE_COLORS)[number];

export type StickyNoteScope = 'all' | 'class';

export type StickyNote = {
  id: string;
  text: string;
  createdAt: number;
  color: StickyNoteColor;
  pinned: boolean;
  isTask: boolean;
  done: boolean;
  listId: string | null;
};

export function normalizeStickyNotes(raw: unknown): StickyNote[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const notes: StickyNote[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const candidate = entry as Partial<StickyNote>;
    if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') {
      continue;
    }

    const isTask = candidate.isTask === true;
    notes.push({
      id: candidate.id,
      text: candidate.text,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
      color: STICKY_NOTE_COLORS.includes(candidate.color as StickyNoteColor)
        ? (candidate.color as StickyNoteColor)
        : 'yellow',
      pinned: candidate.pinned === true,
      isTask,
      done: isTask && candidate.done === true,
      listId: typeof candidate.listId === 'string' ? candidate.listId : null
    });
  }

  return notes;
}

export function normalizeStickyNoteScope(raw: unknown): StickyNoteScope {
  return raw === 'class' ? 'class' : 'all';
}

export function sortStickyNotesForDisplay(notes: StickyNote[]) {
  const doneLast = (group: StickyNote[]) => [
    ...group.filter((note) => !(note.isTask && note.done)),
    ...group.filter((note) => note.isTask && note.done)
  ];

  return [...doneLast(notes.filter((note) => note.pinned)), ...doneLast(notes.filter((note) => !note.pinned))];
}

function formatStickyNoteDate(createdAt: number) {
  return new Date(createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function useNotesWidgetState(selectedList: ClassList | null, classLists: ClassList[]) {
  const [stickyNotes, setStickyNotes] = usePersistentState<StickyNote[]>(
    'teacher-tools.note-items',
    [],
    {
      normalize: normalizeStickyNotes
    }
  );
  const [noteDraft, setNoteDraft] = usePersistentState<string>('teacher-tools.note-draft', '');
  const [noteScope, setNoteScope] = usePersistentState<StickyNoteScope>(
    'teacher-tools.notes-scope',
    'all',
    {
      normalize: normalizeStickyNoteScope
    }
  );
  const [draftIsTask, setDraftIsTask] = usePersistentState<boolean>(
    'teacher-tools.note-draft-is-task',
    false,
    {
      normalize: (raw, initialValue) => (typeof raw === 'boolean' ? raw : initialValue)
    }
  );

  useEffect(() => {
    if (stickyNotes.length > 0) {
      return;
    }

    try {
      const legacyRaw = window.localStorage.getItem('teacher-tools.notes');
      if (!legacyRaw) {
        return;
      }

      const legacyValue = JSON.parse(legacyRaw);
      if (typeof legacyValue === 'string' && legacyValue.trim()) {
        setStickyNotes([
          {
            id: createStickyNoteId(),
            text: legacyValue.trim(),
            createdAt: Date.now(),
            color: 'yellow',
            pinned: false,
            isTask: false,
            done: false,
            listId: null
          }
        ]);
      }

      window.localStorage.removeItem('teacher-tools.notes');
    } catch {
      // Ignore legacy migration failures.
    }
  }, [setStickyNotes, stickyNotes.length]);

  const activeScope: StickyNoteScope = selectedList && noteScope === 'class' ? 'class' : 'all';
  const isNoteInScope = (note: StickyNote) =>
    activeScope === 'class' && selectedList ? note.listId === selectedList.id : true;
  const visibleNotes = sortStickyNotesForDisplay(stickyNotes.filter(isNoteInScope));

  const updateStickyNote = (id: string, update: (note: StickyNote) => StickyNote) => {
    setStickyNotes((current) => current.map((note) => (note.id === id ? update(note) : note)));
  };

  const addStickyNote = () => {
    const nextText = noteDraft.trim();
    if (!nextText) {
      return;
    }

    setStickyNotes((current) => [
      {
        id: createStickyNoteId(),
        text: nextText,
        createdAt: Date.now(),
        color: 'yellow',
        pinned: false,
        isTask: draftIsTask,
        done: false,
        listId: activeScope === 'class' && selectedList ? selectedList.id : null
      },
      ...current
    ]);
    setNoteDraft('');
  };

  const removeStickyNote = (id: string) => {
    const removedIndex = stickyNotes.findIndex((note) => note.id === id);
    if (removedIndex < 0) {
      return;
    }

    const removedNote = stickyNotes[removedIndex];
    setStickyNotes((current) => current.filter((note) => note.id !== id));
    showUndoToast('Note deleted', () => {
      setStickyNotes((current) => {
        if (current.some((note) => note.id === removedNote.id)) {
          return current;
        }

        const insertIndex = Math.min(removedIndex, current.length);
        return [...current.slice(0, insertIndex), removedNote, ...current.slice(insertIndex)];
      });
    });
  };

  const clearDoneNotes = () => {
    const removed: Array<{ index: number; note: StickyNote }> = [];
    stickyNotes.forEach((note, index) => {
      if (note.isTask && note.done && isNoteInScope(note)) {
        removed.push({ index, note });
      }
    });

    if (removed.length === 0) {
      return;
    }

    const removedIds = new Set(removed.map((entry) => entry.note.id));
    setStickyNotes((current) => current.filter((note) => !removedIds.has(note.id)));
    showUndoToast(
      removed.length === 1 ? 'Cleared 1 done to-do' : `Cleared ${removed.length} done to-dos`,
      () => {
        setStickyNotes((current) => {
          const next = [...current];
          for (const entry of removed) {
            if (!next.some((note) => note.id === entry.note.id)) {
              next.splice(Math.min(entry.index, next.length), 0, entry.note);
            }
          }

          return next;
        });
      }
    );
  };

  const updateNoteText = (id: string, text: string) => {
    updateStickyNote(id, (note) => ({ ...note, text: text.trim() }));
  };

  const toggleNoteDone = (id: string) => {
    updateStickyNote(id, (note) => (note.isTask ? { ...note, done: !note.done } : note));
  };

  const toggleNoteTask = (id: string) => {
    updateStickyNote(id, (note) => ({ ...note, isTask: !note.isTask, done: false }));
  };

  const toggleNotePinned = (id: string) => {
    updateStickyNote(id, (note) => ({ ...note, pinned: !note.pinned }));
  };

  const cycleNoteColor = (id: string) => {
    updateStickyNote(id, (note) => ({
      ...note,
      color:
        STICKY_NOTE_COLORS[(STICKY_NOTE_COLORS.indexOf(note.color) + 1) % STICKY_NOTE_COLORS.length]
    }));
  };

  const setNoteColor = (id: string, color: StickyNoteColor) => {
    updateStickyNote(id, (note) => ({ ...note, color }));
  };

  const cycleNoteListId = (id: string) => {
    if (classLists.length === 0) {
      return;
    }

    updateStickyNote(id, (note) => {
      const currentIndex = note.listId
        ? classLists.findIndex((list) => list.id === note.listId)
        : -1;
      const nextList = classLists[currentIndex + 1] ?? null;
      return { ...note, listId: nextList ? nextList.id : null };
    });
  };

  const moveStickyNote = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) {
      return;
    }

    const draggedVisibleIndex = visibleNotes.findIndex((note) => note.id === draggedId);
    const targetVisibleIndex = visibleNotes.findIndex((note) => note.id === targetId);
    if (draggedVisibleIndex < 0 || targetVisibleIndex < 0) {
      return;
    }

    const movingDown = draggedVisibleIndex < targetVisibleIndex;
    setStickyNotes((current) => {
      const dragged = current.find((note) => note.id === draggedId);
      const target = current.find((note) => note.id === targetId);
      if (!dragged || !target) {
        return current;
      }

      const without = current.filter((note) => note.id !== draggedId);
      let insertIndex: number;

      if (dragged.pinned === target.pinned) {
        const targetIndex = without.findIndex((note) => note.id === targetId);
        insertIndex = targetIndex + (movingDown ? 1 : 0);
      } else if (dragged.pinned) {
        // Dropped onto the unpinned section: keep the pin, land at the bottom of the pinned section.
        let lastPinnedIndex = -1;
        without.forEach((note, index) => {
          if (note.pinned) {
            lastPinnedIndex = index;
          }
        });
        insertIndex = lastPinnedIndex + 1;
      } else {
        // Dropped onto the pinned section: stay unpinned, land at the top of the unpinned section.
        const firstUnpinnedIndex = without.findIndex((note) => !note.pinned);
        insertIndex = firstUnpinnedIndex < 0 ? without.length : firstUnpinnedIndex;
      }

      return [...without.slice(0, insertIndex), dragged, ...without.slice(insertIndex)];
    });
  };

  const moveNoteInSection = (id: string, direction: -1 | 1) => {
    const note = stickyNotes.find((entry) => entry.id === id);
    if (!note) {
      return;
    }

    const isDone = note.isTask && note.done;
    const section = visibleNotes.filter(
      (entry) => entry.pinned === note.pinned && (entry.isTask && entry.done) === isDone
    );
    const sectionIndex = section.findIndex((entry) => entry.id === id);
    const neighbor = sectionIndex >= 0 ? section[sectionIndex + direction] : undefined;
    if (!neighbor) {
      announce(
        direction === -1
          ? 'Note is already at the top of its section'
          : 'Note is already at the bottom of its section'
      );
      return;
    }

    setStickyNotes((current) => {
      const moved = current.find((entry) => entry.id === id);
      const without = current.filter((entry) => entry.id !== id);
      const neighborIndex = without.findIndex((entry) => entry.id === neighbor.id);
      if (!moved || neighborIndex < 0) {
        return current;
      }

      const insertIndex = direction === 1 ? neighborIndex + 1 : neighborIndex;
      return [...without.slice(0, insertIndex), moved, ...without.slice(insertIndex)];
    });
    announce(direction === -1 ? 'Note moved up' : 'Note moved down');
  };

  const getListName = (listId: string | null) => {
    if (!listId) {
      return null;
    }

    return classLists.find((list) => list.id === listId)?.name ?? null;
  };

  return {
    activeScope,
    addStickyNote,
    badgeLabel: visibleNotes.length > 0 ? `${visibleNotes.length}` : null,
    classLists,
    clearDoneNotes,
    cycleNoteColor,
    cycleNoteListId,
    descriptionLabel:
      activeScope === 'class' && selectedList
        ? `Notes for ${selectedList.name}.`
        : WIDGET_DETAILS.notes.description,
    draftIsTask,
    getListName,
    moveNoteInSection,
    moveStickyNote,
    noteDraft,
    removeStickyNote,
    selectedList,
    setDraftIsTask,
    setNoteColor,
    setNoteDraft,
    setNoteScope,
    stickyNotes,
    toggleNoteDone,
    toggleNotePinned,
    toggleNoteTask,
    updateNoteText,
    visibleNotes
  };
}

export type NotesWidgetController = ReturnType<typeof useNotesWidgetState>;

function NotePinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M9.3 2.2 13.8 6.7c-.9.3-1.8.4-2.6.3l-2.1 2.1c.2 1.1 0 2.2-.5 3.2L4.7 8.4c1-.5 2.1-.7 3.2-.5l2.1-2.1c-.1-.8 0-1.7.3-2.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path d="M5.2 10.8 2.4 13.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
    </svg>
  );
}

function NoteCheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M3.6 8.6 6.4 11.4 12.4 4.8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function NoteTaskIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect fill="none" height="10.8" rx="2.6" stroke="currentColor" strokeWidth="1.3" width="10.8" x="2.6" y="2.6" />
      <path
        d="M5.3 8.2 7.2 10 10.7 5.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function NoteSearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="7" cy="7" fill="none" r="4.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.4 10.4 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

export function NotesWidgetContent({ controller }: { controller: NotesWidgetController }) {
  const {
    activeScope,
    addStickyNote,
    classLists,
    clearDoneNotes,
    cycleNoteColor,
    cycleNoteListId,
    draftIsTask,
    getListName,
    moveNoteInSection,
    moveStickyNote,
    noteDraft,
    removeStickyNote,
    selectedList,
    setDraftIsTask,
    setNoteColor,
    setNoteDraft,
    setNoteScope,
    toggleNoteDone,
    toggleNotePinned,
    toggleNoteTask,
    updateNoteText,
    visibleNotes
  } = controller;
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTargetNoteId, setDropTargetNoteId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [colorMenuNoteId, setColorMenuNoteId] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const showSearch = isSearchOpen || visibleNotes.length > NOTES_SEARCH_AUTO_SHOW_COUNT;
  const normalizedQuery = showSearch ? searchQuery.trim().toLowerCase() : '';
  const displayNotes = normalizedQuery
    ? visibleNotes.filter((note) => note.text.toLowerCase().includes(normalizedQuery))
    : visibleNotes;
  const doneCount = visibleNotes.filter((note) => note.isTask && note.done).length;
  const canReorder = normalizedQuery === '';

  useEffect(() => {
    if (!colorMenuNoteId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-note-color-menu]')) {
        return;
      }

      setColorMenuNoteId(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setColorMenuNoteId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorMenuNoteId]);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => clearLongPress, []);

  const startLongPress = (noteId: string) => {
    clearLongPress();
    longPressFiredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      setColorMenuNoteId(noteId);
    }, 450);
  };

  const startEditing = (note: StickyNote) => {
    setEditingNoteId(note.id);
    setEditDraft(note.text);
  };

  const commitEditing = () => {
    if (editingNoteId) {
      updateNoteText(editingNoteId, editDraft);
    }

    setEditingNoteId(null);
  };

  const cancelEditing = () => {
    setEditingNoteId(null);
  };

  const clearDragState = () => {
    setDraggedNoteId(null);
    setDropTargetNoteId(null);
  };

  const handleDragStart = (event: DragEvent<HTMLElement>, note: StickyNote) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', note.id);
    setDraggedNoteId(note.id);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, note: StickyNote) => {
    const isNoteDrag = draggedNoteId !== null || event.dataTransfer.types.includes('text/plain');
    if (!isNoteDrag || draggedNoteId === note.id) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetNoteId(note.id);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, note: StickyNote) => {
    event.preventDefault();
    const droppedId = draggedNoteId ?? event.dataTransfer.getData('text/plain');
    if (droppedId) {
      moveStickyNote(droppedId, note.id);
    }

    clearDragState();
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitEditing();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>, note: StickyNote) => {
    if (editingNoteId === note.id) {
      return;
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      moveNoteInSection(note.id, event.key === 'ArrowUp' ? -1 : 1);
    }
  };

  return (
    <>
      <div className="note-input-row widget-top-controls">
        <button
          aria-label={draftIsTask ? 'Switch to plain notes' : 'Switch to to-do items'}
          aria-pressed={draftIsTask}
          className={`text-toggle note-compose-mode${draftIsTask ? ' note-compose-mode--active' : ''}`}
          data-tooltip-content={draftIsTask ? 'Adding to-dos' : 'Add as to-do'}
          onClick={() => setDraftIsTask(!draftIsTask)}
          type="button"
        >
          <NoteTaskIcon />
        </button>
        <textarea
          aria-label={draftIsTask ? 'New to-do' : 'New note'}
          className="text-field note-compose-field"
          onChange={(event) => setNoteDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              addStickyNote();
            }
          }}
          placeholder={draftIsTask ? 'Type a to-do and press Enter' : 'Type a note and press Enter'}
          rows={Math.min(5, Math.max(1, noteDraft.split('\n').length))}
          value={noteDraft}
        />
        <button
          aria-label={draftIsTask ? 'Add to-do' : 'Add note'}
          className="primary-link"
          data-compact-icon="+"
          onClick={addStickyNote}
          type="button"
        >
          Add
        </button>
        <button
          aria-label={isSearchOpen ? 'Hide note search' : 'Search notes'}
          aria-pressed={isSearchOpen}
          className={`text-toggle note-compose-mode${isSearchOpen ? ' note-compose-mode--active' : ''}`}
          data-tooltip-content="Search"
          onClick={() => {
            setIsSearchOpen((current) => {
              if (current) {
                setSearchQuery('');
              }

              return !current;
            });
          }}
          type="button"
        >
          <NoteSearchIcon />
        </button>
      </div>

      {showSearch || doneCount > 0 ? (
        <div className="notes-toolbar widget-top-controls">
          {showSearch ? (
            <input
              aria-label="Search notes"
              className="text-field notes-search-field"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search notes"
              type="search"
              value={searchQuery}
            />
          ) : null}
          {doneCount > 0 ? (
            <button
              className="text-toggle notes-clear-done"
              data-tooltip-content="Remove completed to-dos"
              onClick={clearDoneNotes}
              type="button"
            >
              Clear done
            </button>
          ) : null}
        </div>
      ) : null}

      {selectedList ? (
        <div className="segmented-row notes-scope-row widget-top-controls">
          <button
            aria-pressed={activeScope === 'all'}
            className={`text-toggle notes-scope-toggle${
              activeScope === 'all' ? ' notes-scope-toggle--active' : ''
            }`}
            onClick={() => setNoteScope('all')}
            type="button"
          >
            All classes
          </button>
          <button
            aria-pressed={activeScope === 'class'}
            className={`text-toggle notes-scope-toggle${
              activeScope === 'class' ? ' notes-scope-toggle--active' : ''
            }`}
            data-tooltip-content={`Only show notes for ${selectedList.name}`}
            onClick={() => setNoteScope('class')}
            type="button"
          >
            {selectedList.name}
          </button>
        </div>
      ) : null}

      <div className="notes-list">
        {displayNotes.length > 0 ? (
          displayNotes.map((note) => {
            const isEditing = editingNoteId === note.id;
            const scopeLabel = getListName(note.listId) ?? 'All';
            const rowClasses = [
              'note-row',
              note.pinned ? 'note-row--pinned' : '',
              note.isTask && note.done ? 'note-row--done' : '',
              draggedNoteId === note.id ? 'note-row--dragging' : '',
              dropTargetNoteId === note.id && draggedNoteId !== note.id ? 'note-row--drop-target' : ''
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <article
                className={rowClasses}
                data-note-color={note.color}
                draggable={!isEditing && canReorder}
                key={note.id}
                onDragEnd={clearDragState}
                onDragOver={(event) => handleDragOver(event, note)}
                onDragStart={(event) => handleDragStart(event, note)}
                onDrop={(event) => handleDrop(event, note)}
                onKeyDown={(event) => handleRowKeyDown(event, note)}
              >
                <span aria-hidden="true" className="note-row__hue" />
                {note.isTask ? (
                  <button
                    aria-label={note.done ? 'Mark as not done' : 'Mark as done'}
                    aria-pressed={note.done}
                    className="note-row__checkbox"
                    onClick={() => toggleNoteDone(note.id)}
                    type="button"
                  >
                    {note.done ? <NoteCheckIcon /> : null}
                  </button>
                ) : null}
                <div className="note-row__body">
                  {isEditing ? (
                    <textarea
                      autoFocus
                      className="note-row__edit"
                      onBlur={commitEditing}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onFocus={(event) =>
                        event.currentTarget.setSelectionRange(
                          event.currentTarget.value.length,
                          event.currentTarget.value.length
                        )
                      }
                      onKeyDown={handleEditKeyDown}
                      rows={Math.max(1, editDraft.split('\n').length)}
                      value={editDraft}
                    />
                  ) : (
                    <p
                      className="note-row__text"
                      onClick={() => startEditing(note)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          startEditing(note);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {note.text}
                    </p>
                  )}
                  {classLists.length > 0 ? (
                    <button
                      aria-label={`Shown for ${
                        note.listId ? scopeLabel : 'all classes'
                      }. Switch class.`}
                      className="note-row__scope"
                      data-tooltip-content="Switch class"
                      onClick={() => cycleNoteListId(note.id)}
                      type="button"
                    >
                      {scopeLabel}
                    </button>
                  ) : null}
                </div>
                <div className="note-row__actions">
                  <button
                    aria-label={note.pinned ? 'Unpin note' : 'Pin note to top'}
                    aria-pressed={note.pinned}
                    className={`note-row__tool note-row__tool--pin${
                      note.pinned ? ' note-row__tool--active' : ''
                    }`}
                    data-tooltip-content={note.pinned ? 'Unpin' : 'Pin to top'}
                    onClick={() => toggleNotePinned(note.id)}
                    type="button"
                  >
                    <NotePinIcon />
                  </button>
                  <span className="note-color-anchor" data-note-color-menu>
                    <button
                      aria-label="Switch note color. Right-click or hold for all colors."
                      className="note-row__tool note-row__tool--color"
                      data-tooltip-content="Switch color · hold to choose"
                      onClick={() => {
                        if (longPressFiredRef.current) {
                          longPressFiredRef.current = false;
                          return;
                        }

                        cycleNoteColor(note.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setColorMenuNoteId((current) => (current === note.id ? null : note.id));
                      }}
                      onPointerCancel={clearLongPress}
                      onPointerDown={() => startLongPress(note.id)}
                      onPointerLeave={clearLongPress}
                      onPointerUp={clearLongPress}
                      type="button"
                    >
                      <span className="note-row__swatch" />
                    </button>
                    {colorMenuNoteId === note.id ? (
                      <span aria-label="Note color" className="note-color-menu" role="menu">
                        {STICKY_NOTE_COLORS.map((color) => (
                          <button
                            aria-label={`Set color to ${color}`}
                            className={`note-color-menu__swatch${
                              note.color === color ? ' note-color-menu__swatch--current' : ''
                            }`}
                            data-note-color={color}
                            key={color}
                            onClick={() => {
                              setNoteColor(note.id, color);
                              setColorMenuNoteId(null);
                            }}
                            role="menuitem"
                            type="button"
                          />
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <button
                    aria-label={note.isTask ? 'Turn into note' : 'Turn into to-do'}
                    aria-pressed={note.isTask}
                    className={`note-row__tool note-row__tool--task${
                      note.isTask ? ' note-row__tool--active' : ''
                    }`}
                    data-tooltip-content={note.isTask ? 'Turn into note' : 'Turn into to-do'}
                    onClick={() => toggleNoteTask(note.id)}
                    type="button"
                  >
                    <NoteTaskIcon />
                  </button>
                  <button
                    aria-label="Delete sticky note"
                    className="note-row__delete"
                    onClick={() => removeStickyNote(note.id)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <span aria-hidden="true" className="note-row__date">
                  {formatStickyNoteDate(note.createdAt)}
                </span>
              </article>
            );
          })
        ) : (
          <p className="empty-copy">
            {normalizedQuery
              ? 'No matching notes.'
              : activeScope === 'class' && selectedList
                ? `No notes for ${selectedList.name} yet.`
                : 'No notes yet.'}
          </p>
        )}
      </div>
    </>
  );
}

export function NotesWidgetPopoutCard({
  interfaceScaleControls,
  sizeTier
}: {
  interfaceScaleControls: InterfaceScaleControlsState;
  sizeTier: WidgetSizeTier;
}) {
  const [picker] = usePickerState();
  const selectedList = picker.lists.find((list) => list.id === picker.selectedListId) ?? null;
  const notes = useNotesWidgetState(selectedList, picker.lists);

  return (
    <WidgetCard
      badge={notes.badgeLabel}
      collapsed={false}
      description={notes.descriptionLabel}
      headerActions={
        <PopoutWidgetActions
          interfaceScaleControls={interfaceScaleControls}
          title={WIDGET_DETAILS.notes.title}
          widgetId="notes"
        />
      }
      headerDragMode="window"
      isDragOver={false}
      isDragging={false}
      showCollapse={false}
      sizeTier={sizeTier}
      title={WIDGET_DETAILS.notes.title}
      widgetId="notes"
    >
      <NotesWidgetContent controller={notes} />
    </WidgetCard>
  );
}
