import { useEffect, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import type { InterfaceScaleControlsState } from '../app/interfaceScale';
import { usePersistentState } from '../shared/persistence';
import { createStickyNoteId } from '../shared/utils';
import { PopoutWidgetActions, WidgetCard } from './chrome';
import type { ClassList } from './classLists';
import type { WidgetSizeTier } from './dashboard';
import { usePickerState } from './picker';
import { WIDGET_DETAILS } from './registry';

export const STICKY_NOTE_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;

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
  return [...notes.filter((note) => note.pinned), ...notes.filter((note) => !note.pinned)];
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
  const [draftIsTask, setDraftIsTask] = useState(false);

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
  const visibleNotes = sortStickyNotesForDisplay(
    activeScope === 'class' && selectedList
      ? stickyNotes.filter((note) => note.listId === selectedList.id)
      : stickyNotes
  );

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
    setStickyNotes((current) => current.filter((note) => note.id !== id));
  };

  const updateNoteText = (id: string, text: string) => {
    const nextText = text.trim();
    if (!nextText) {
      return;
    }

    updateStickyNote(id, (note) => ({ ...note, text: nextText }));
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

  const moveStickyNote = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) {
      return;
    }

    setStickyNotes((current) => {
      const draggedIndex = current.findIndex((note) => note.id === draggedId);
      const targetIndex = current.findIndex((note) => note.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0) {
        return current;
      }

      const target = current[targetIndex];
      const dragged =
        current[draggedIndex].pinned === target.pinned
          ? current[draggedIndex]
          : { ...current[draggedIndex], pinned: target.pinned };
      const without = current.filter((note) => note.id !== draggedId);
      const insertIndex =
        without.findIndex((note) => note.id === targetId) + (draggedIndex < targetIndex ? 1 : 0);

      return [...without.slice(0, insertIndex), dragged, ...without.slice(insertIndex)];
    });
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
    cycleNoteColor,
    descriptionLabel:
      activeScope === 'class' && selectedList
        ? `Notes for ${selectedList.name}.`
        : WIDGET_DETAILS.notes.description,
    draftIsTask,
    getListName,
    moveStickyNote,
    noteDraft,
    removeStickyNote,
    selectedList,
    setDraftIsTask,
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

export function NotesWidgetContent({ controller }: { controller: NotesWidgetController }) {
  const {
    activeScope,
    addStickyNote,
    cycleNoteColor,
    draftIsTask,
    getListName,
    moveStickyNote,
    noteDraft,
    removeStickyNote,
    selectedList,
    setDraftIsTask,
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
        <input
          className="text-field"
          onChange={(event) => setNoteDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addStickyNote();
            }
          }}
          placeholder={draftIsTask ? 'Type a to-do and press Enter' : 'Type a note and press Enter'}
          type="text"
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
      </div>

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
        {visibleNotes.length > 0 ? (
          visibleNotes.map((note) => {
            const isEditing = editingNoteId === note.id;
            const listName = activeScope === 'all' ? getListName(note.listId) : null;
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
                draggable={!isEditing}
                key={note.id}
                onDragEnd={clearDragState}
                onDragOver={(event) => handleDragOver(event, note)}
                onDragStart={(event) => handleDragStart(event, note)}
                onDrop={(event) => handleDrop(event, note)}
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
                  {listName ? <span className="note-row__tag">{listName}</span> : null}
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
                  <button
                    aria-label="Switch note color"
                    className="note-row__tool note-row__tool--color"
                    data-tooltip-content="Switch color"
                    onClick={() => cycleNoteColor(note.id)}
                    type="button"
                  >
                    <span className="note-row__swatch" />
                  </button>
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
              </article>
            );
          })
        ) : (
          <p className="empty-copy">
            {activeScope === 'class' && selectedList
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
