
export function splitNames(rawInput: string) {
  return dedupeNames(
    rawInput
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(Math.floor(durationMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatStudentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function dedupeNames(names: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(name);
  }

  return result;
}

export function haveSameStudents(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right.map((name) => name.toLowerCase()));
  return left.every((name) => rightSet.has(name.toLowerCase()));
}

export function shuffleNames(names: string[]) {
  const nextNames = [...names];

  for (let index = nextNames.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextNames[index], nextNames[swapIndex]] = [nextNames[swapIndex], nextNames[index]];
  }

  return nextNames;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function createStickyNoteId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
