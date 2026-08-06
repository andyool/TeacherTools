import { useEffect } from 'react';
import { usePersistentState } from './persistence';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pruneKeyedRecord(value: unknown, field: string, validListIds: Set<string>) {
  if (!isRecord(value) || !isRecord(value[field])) {
    return null;
  }

  const record = value[field] as Record<string, unknown>;
  const orphanKeys = Object.keys(record).filter((key) => !validListIds.has(key));
  if (orphanKeys.length === 0) {
    return null;
  }

  const nextRecord = { ...record };
  for (const key of orphanKeys) {
    delete nextRecord[key];
  }

  return { ...value, [field]: nextRecord };
}

// Stores that key or reference students by their raw display name. Planner,
// notes and dashboard layouts hold no per-student data, so they are excluded.
const STUDENT_NAME_STORE_KEYS = [
  'teacher-tools.seating-chart',
  'teacher-tools.group-rules',
  'teacher-tools.group-maker',
  'teacher-tools.homework-assessment-tracker',
  'teacher-tools.picker'
];

function deepRenameStrings(value: unknown, renames: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return renames.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => deepRenameStrings(entry, renames));
  }

  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[renames.get(key) ?? key] = deepRenameStrings(entry, renames);
    }
    return next;
  }

  return value;
}

/**
 * Students are identified by raw name strings across seating, rules, groups,
 * homework ticks and pick history — so renaming (or fixing the casing of) a
 * student used to orphan all of it. Until students get stable ids, this
 * cascades exact-name renames through every store that references them.
 */
export function cascadeStudentRenames(renames: Array<{ from: string; to: string }>) {
  const api = window.electronAPI;
  if (!api?.getPersistentState || !api.setPersistentState) {
    return;
  }

  const renameMap = new Map(
    renames
      .filter((rename) => rename.from && rename.to && rename.from !== rename.to)
      .map((rename) => [rename.from, rename.to] as const)
  );
  if (renameMap.size === 0) {
    return;
  }

  for (const storeKey of STUDENT_NAME_STORE_KEYS) {
    try {
      const snapshot = api.getPersistentState(storeKey);
      if (!snapshot?.found) {
        continue;
      }

      const renamed = deepRenameStrings(snapshot.value, renameMap);
      if (JSON.stringify(renamed) !== JSON.stringify(snapshot.value)) {
        void api.setPersistentState(storeKey, renamed);
      }
    } catch {
      // Best-effort: a store that fails to update keeps its old names.
    }
  }
}

/**
 * Diffs an old roster against a new one and returns probable renames: exact
 * casing fixes always count; a single added + single removed name is treated
 * as one rename.
 */
export function detectStudentRenames(previousStudents: string[], nextStudents: string[]) {
  const nextSet = new Set(nextStudents);
  const previousSet = new Set(previousStudents);
  const removed = previousStudents.filter((name) => !nextSet.has(name));
  const added = nextStudents.filter((name) => !previousSet.has(name));

  const renames: Array<{ from: string; to: string }> = [];
  const unmatchedRemoved: string[] = [];
  const remainingAdded = [...added];

  for (const name of removed) {
    const casingIndex = remainingAdded.findIndex(
      (candidate) => candidate.toLowerCase() === name.toLowerCase()
    );
    if (casingIndex !== -1) {
      renames.push({ from: name, to: remainingAdded[casingIndex] });
      remainingAdded.splice(casingIndex, 1);
    } else {
      unmatchedRemoved.push(name);
    }
  }

  if (unmatchedRemoved.length === 1 && remainingAdded.length === 1) {
    renames.push({ from: unmatchedRemoved[0], to: remainingAdded[0] });
  }

  return renames;
}

/**
 * Deleting a class list used to leave its seating charts, group rules, planner
 * entries and dashboard layouts stored forever. This one-shot pass (per panel
 * mount) drops store keys pointing at class lists that no longer exist.
 *
 * Uses raw store access on purpose: shapes are checked defensively and
 * untouched fields are spread through, so it stays correct even as the
 * individual widget stores evolve.
 */
export function useOrphanedClassDataCleanup(validListIds: string[]) {
  const [, setSeating] = usePersistentState<Record<string, unknown>>('teacher-tools.seating-chart', {});
  const [, setGroupRules] = usePersistentState<Record<string, unknown>>('teacher-tools.group-rules', {});
  const [, setPlanner] = usePersistentState<Record<string, unknown>>('teacher-tools.planner', {});
  const [, setLayouts] = usePersistentState<Record<string, unknown>>('teacher-tools.dashboard-layouts', {});

  const validKey = validListIds.slice().sort().join('|');

  useEffect(() => {
    if (validListIds.length === 0) {
      // An empty roster more likely means state hasn't loaded than that every
      // class was deleted — never wipe on that signal.
      return;
    }

    const validSet = new Set(validListIds);

    setSeating((current) => pruneKeyedRecord(current, 'chartsByListId', validSet) ?? current);
    setGroupRules((current) => pruneKeyedRecord(current, 'rulesByListId', validSet) ?? current);
    setLayouts((current) => pruneKeyedRecord(current, 'layoutsByListId', validSet) ?? current);
    setPlanner((current) => {
      const prunedEntries = pruneKeyedRecord(current, 'entriesByListId', validSet) ?? current;
      return pruneKeyedRecord(prunedEntries, 'activeDateByListId', validSet) ?? prunedEntries;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validKey]);
}
