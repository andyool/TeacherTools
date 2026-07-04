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
