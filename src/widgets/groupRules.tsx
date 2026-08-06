import { useId, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePersistentState } from '../shared/persistence';
import { isString } from '../shared/utils';

export type GroupRuleKind = 'apart' | 'together';

export type GroupPairRule = [string, string];

export type GroupRulesForList = {
  apart: GroupPairRule[];
  together: GroupPairRule[];
};

export type GroupRulesSnapshot = {
  rulesByListId: Record<string, GroupRulesForList>;
};

export const DEFAULT_GROUP_RULES: GroupRulesSnapshot = {
  rulesByListId: {}
};

export const EMPTY_GROUP_RULES: GroupRulesForList = {
  apart: [],
  together: []
};

export function useGroupRulesState() {
  return usePersistentState<GroupRulesSnapshot>('teacher-tools.group-rules', DEFAULT_GROUP_RULES, {
    normalize: normalizeGroupRulesSnapshot
  });
}

export function normalizeGroupRulesSnapshot(raw: unknown, initialValue: GroupRulesSnapshot) {
  if (!raw || typeof raw !== 'object') {
    return initialValue;
  }

  const nextRaw = raw as { rulesByListId?: Record<string, unknown> };
  const rulesByListId: Record<string, GroupRulesForList> = {};

  if (nextRaw.rulesByListId && typeof nextRaw.rulesByListId === 'object') {
    for (const [listId, rulesRaw] of Object.entries(nextRaw.rulesByListId)) {
      const rules = normalizeGroupRulesForList(rulesRaw);
      if (rules.apart.length > 0 || rules.together.length > 0) {
        rulesByListId[listId] = rules;
      }
    }
  }

  return { rulesByListId };
}

export function normalizeGroupRulesForList(raw: unknown): GroupRulesForList {
  if (!raw || typeof raw !== 'object') {
    return EMPTY_GROUP_RULES;
  }

  const nextRaw = raw as { apart?: unknown[]; together?: unknown[] };

  return {
    apart: normalizeGroupPairRules(nextRaw.apart),
    together: normalizeGroupPairRules(nextRaw.together)
  };
}

export function normalizeGroupPairRules(raw: unknown[] | undefined): GroupPairRule[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const pairs: GroupPairRule[] = [];

  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      continue;
    }

    const [first, second] = entry;
    if (!isString(first) || !isString(second) || !first.trim() || !second.trim()) {
      continue;
    }

    if (areSameStudent(first, second)) {
      continue;
    }

    if (pairs.some((pair) => isSamePair(pair, [first, second]))) {
      continue;
    }

    pairs.push([first, second]);
  }

  return pairs;
}

export function getGroupRulesForList(
  snapshot: GroupRulesSnapshot,
  listId: string | null,
  roster: string[]
): GroupRulesForList {
  if (!listId) {
    return EMPTY_GROUP_RULES;
  }

  const rules = snapshot.rulesByListId[listId];
  if (!rules) {
    return EMPTY_GROUP_RULES;
  }

  const rosterSet = new Set(roster.map((name) => name.toLowerCase()));
  const keepPair = (pair: GroupPairRule) =>
    rosterSet.has(pair[0].toLowerCase()) && rosterSet.has(pair[1].toLowerCase());

  return {
    apart: rules.apart.filter(keepPair),
    together: rules.together.filter(keepPair)
  };
}

export function addGroupRule(
  snapshot: GroupRulesSnapshot,
  listId: string,
  kind: GroupRuleKind,
  first: string,
  second: string
): GroupRulesSnapshot {
  if (areSameStudent(first, second) || !first.trim() || !second.trim()) {
    return snapshot;
  }

  const currentRules = snapshot.rulesByListId[listId] ?? EMPTY_GROUP_RULES;
  const oppositeKind: GroupRuleKind = kind === 'apart' ? 'together' : 'apart';

  if (currentRules[kind].some((pair) => isSamePair(pair, [first, second]))) {
    return snapshot;
  }

  return {
    rulesByListId: {
      ...snapshot.rulesByListId,
      [listId]: {
        ...currentRules,
        [kind]: [...currentRules[kind], [first, second] as GroupPairRule],
        [oppositeKind]: currentRules[oppositeKind].filter(
          (pair) => !isSamePair(pair, [first, second])
        )
      }
    }
  };
}

export function removeGroupRule(
  snapshot: GroupRulesSnapshot,
  listId: string,
  kind: GroupRuleKind,
  pair: GroupPairRule
): GroupRulesSnapshot {
  const currentRules = snapshot.rulesByListId[listId];
  if (!currentRules) {
    return snapshot;
  }

  return {
    rulesByListId: {
      ...snapshot.rulesByListId,
      [listId]: {
        ...currentRules,
        [kind]: currentRules[kind].filter((candidate) => !isSamePair(candidate, pair))
      }
    }
  };
}

export function isSamePair(left: GroupPairRule, right: GroupPairRule) {
  return (
    (areSameStudent(left[0], right[0]) && areSameStudent(left[1], right[1])) ||
    (areSameStudent(left[0], right[1]) && areSameStudent(left[1], right[0]))
  );
}

export function areSameStudent(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function countGroupRules(rules: GroupRulesForList) {
  return rules.apart.length + rules.together.length;
}

/**
 * Merges students into atomic units so that every keep-together pair shares a
 * unit. Students without rules become single-member units.
 */
export function buildTogetherUnits(students: string[], togetherPairs: GroupPairRule[]) {
  const unitIndexByStudent = new Map<string, number>();
  const units: string[][] = students.map((student, index) => {
    unitIndexByStudent.set(student.toLowerCase(), index);
    return [student];
  });

  for (const [first, second] of togetherPairs) {
    const firstIndex = unitIndexByStudent.get(first.toLowerCase());
    const secondIndex = unitIndexByStudent.get(second.toLowerCase());

    if (firstIndex === undefined || secondIndex === undefined || firstIndex === secondIndex) {
      continue;
    }

    const [fromIndex, toIndex] =
      units[firstIndex].length >= units[secondIndex].length
        ? [secondIndex, firstIndex]
        : [firstIndex, secondIndex];

    for (const member of units[fromIndex]) {
      unitIndexByStudent.set(member.toLowerCase(), toIndex);
    }

    units[toIndex] = [...units[toIndex], ...units[fromIndex]];
    units[fromIndex] = [];
  }

  return units.filter((unit) => unit.length > 0);
}

export function countApartViolationsInGroup(group: string[], apartPairs: GroupPairRule[]) {
  const memberSet = new Set(group.map((name) => name.toLowerCase()));

  return apartPairs.filter(
    (pair) => memberSet.has(pair[0].toLowerCase()) && memberSet.has(pair[1].toLowerCase())
  ).length;
}

export function countApartViolationsInGroups(groups: string[][], apartPairs: GroupPairRule[]) {
  return groups.reduce((total, group) => total + countApartViolationsInGroup(group, apartPairs), 0);
}

/**
 * Type-ahead student picker for the rules dialog. Typing filters the roster;
 * arrow keys move the highlight, Enter picks the highlighted student. Pressing
 * Enter again with the list closed calls onSubmit (used to add the rule).
 */
export function StudentCombobox({
  label,
  onSelect,
  onSubmit,
  selected,
  students
}: {
  label: string;
  onSelect: (student: string) => void;
  onSubmit?: () => void;
  selected: string;
  students: string[];
}) {
  const listboxId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const query = draft?.trim().toLowerCase() ?? '';
  const filteredStudents = query
    ? students.filter((student) => student.toLowerCase().includes(query))
    : students;
  const activeIndex = Math.min(highlightIndex, Math.max(filteredStudents.length - 1, 0));

  const commitStudent = (student: string) => {
    onSelect(student);
    setDraft(null);
    setIsOpen(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      if (!isOpen) {
        setIsOpen(true);
        return;
      }

      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightIndex(
        Math.min(Math.max(activeIndex + delta, 0), Math.max(filteredStudents.length - 1, 0))
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      if (isOpen && filteredStudents.length > 0) {
        commitStudent(filteredStudents[activeIndex]);
        return;
      }

      onSubmit?.();
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      setIsOpen(false);
    }
  };

  return (
    <label className="field-stack group-rules__combobox">
      <span className="field-label">{label}</span>
      <input
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        className="text-field"
        onBlur={() => {
          setDraft(null);
          setIsOpen(false);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setHighlightIndex(0);
          setIsOpen(true);
        }}
        onFocus={(event) => {
          event.target.select();
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a name"
        role="combobox"
        type="text"
        value={draft ?? selected}
      />
      {isOpen ? (
        <ul className="group-rules__combobox-menu" id={listboxId} role="listbox">
          {filteredStudents.length > 0 ? (
            filteredStudents.map((student, index) => (
              <li aria-selected={student === selected} key={student} role="option">
                <button
                  className={`group-rules__combobox-option${
                    index === activeIndex ? ' group-rules__combobox-option--active' : ''
                  }`}
                  onClick={() => commitStudent(student)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(index)}
                  tabIndex={-1}
                  type="button"
                >
                  {student}
                </button>
              </li>
            ))
          ) : (
            <li className="group-rules__combobox-empty">No matching students</li>
          )}
        </ul>
      ) : null}
    </label>
  );
}

export function groupsSatisfyTogetherRules(groups: string[][], togetherPairs: GroupPairRule[]) {
  const groupIndexByStudent = new Map<string, number>();

  groups.forEach((group, index) => {
    group.forEach((name) => groupIndexByStudent.set(name.toLowerCase(), index));
  });

  return togetherPairs.every((pair) => {
    const firstIndex = groupIndexByStudent.get(pair[0].toLowerCase());
    const secondIndex = groupIndexByStudent.get(pair[1].toLowerCase());

    return firstIndex === undefined || secondIndex === undefined || firstIndex === secondIndex;
  });
}
