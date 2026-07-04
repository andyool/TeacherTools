import { createStickyNoteId, dedupeNames, isString } from '../shared/utils';
import type { PickerSnapshot } from './picker';

export type ClassList = {
  id: string;
  name: string;
  students: string[];
};

export const DEFAULT_CLASS_LIST: ClassList = {
  id: 'default-class-list',
  name: 'Period 1',
  students: ['Ava', 'Noah', 'Mia', 'Liam']
};

export function normalizeClassList(raw: unknown): ClassList | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const nextRaw = raw as {
    id?: unknown;
    name?: unknown;
    students?: unknown[];
  };

  if (
    typeof nextRaw.id !== 'string' ||
    typeof nextRaw.name !== 'string' ||
    !Array.isArray(nextRaw.students)
  ) {
    return null;
  }

  const students = dedupeNames(nextRaw.students.filter(isString));
  if (!nextRaw.name.trim()) {
    return null;
  }

  return {
    id: nextRaw.id,
    name: nextRaw.name.trim(),
    students
  };
}

export function activateClassList(snapshot: PickerSnapshot, listId: string) {
  const nextList = snapshot.lists.find((list) => list.id === listId);
  if (!nextList) {
    return snapshot;
  }

  const isSameList = snapshot.selectedListId === listId;

  return {
    ...snapshot,
    selectedListId: listId,
    pool: syncPoolWithRoster(
      nextList.students,
      isSameList ? snapshot.pool : [],
      isSameList && snapshot.removePickedStudents
    ),
    currentPick:
      isSameList && snapshot.currentPick && nextList.students.includes(snapshot.currentPick)
        ? snapshot.currentPick
        : null,
    recentPicks: isSameList
      ? snapshot.recentPicks.filter((name) => nextList.students.includes(name))
      : []
  };
}

export function upsertClassList(
  snapshot: PickerSnapshot,
  entry: {
    listId: string;
    name: string;
    students: string[];
  }
) {
  const nextList: ClassList = {
    id: entry.listId,
    name: entry.name.trim(),
    students: dedupeNames(entry.students)
  };
  const existingIndex = snapshot.lists.findIndex((list) => list.id === entry.listId);
  const nextLists =
    existingIndex >= 0
      ? snapshot.lists.map((list) => (list.id === entry.listId ? nextList : list))
      : [nextList, ...snapshot.lists];

  return {
    ...snapshot,
    lists: nextLists,
    selectedListId: nextList.id,
    pool: [...nextList.students],
    currentPick: null,
    recentPicks: []
  };
}

export function createPredictableListId(name: string, existingIds: string[]) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug ? `class-list-${slug}` : createClassListId();
  let candidate = base;
  let suffix = 2;

  while (existingIds.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function syncPoolWithRoster(roster: string[], pool: string[], allowEmptyPool = false) {
  const nextPool = pool.filter((name) => roster.includes(name));
  if (allowEmptyPool) {
    return nextPool;
  }

  return nextPool.length ? nextPool : [...roster];
}

export function createClassListId() {
  return `class-list-${createStickyNoteId()}`;
}
