
export function getMinutesSinceMidnight(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

export function getTimestampForMinutes(baseDate: Date, minutes: number) {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  ).getTime();
}

export function formatDateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${`${monthIndex + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

export function parseDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const nextDate = new Date(year, monthIndex, day);

  if (
    Number.isNaN(nextDate.getTime()) ||
    nextDate.getFullYear() !== year ||
    nextDate.getMonth() !== monthIndex ||
    nextDate.getDate() !== day
  ) {
    return null;
  }

  return {
    day,
    monthIndex,
    year
  };
}

export function normalizeDateKey(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  return formatDateKey(parsed.year, parsed.monthIndex, parsed.day);
}

let cachedDayBeforeMonth: boolean | null = null;

/** Whether the user's locale writes the day before the month (dd/mm vs mm/dd). */
export function localeWritesDayFirst() {
  if (cachedDayBeforeMonth !== null) {
    return cachedDayBeforeMonth;
  }

  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric'
    }).formatToParts(new Date(2000, 11, 31));
    const dayIndex = parts.findIndex((part) => part.type === 'day');
    const monthIndex = parts.findIndex((part) => part.type === 'month');
    cachedDayBeforeMonth = dayIndex !== -1 && monthIndex !== -1 ? dayIndex < monthIndex : true;
  } catch {
    cachedDayBeforeMonth = true;
  }

  return cachedDayBeforeMonth;
}

export function getDateInputPlaceholder() {
  return localeWritesDayFirst() ? 'dd/mm/yyyy' : 'mm/dd/yyyy';
}

export function formatDateKeyForInput(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return '';
  }

  const dayPart = `${parsed.day}`.padStart(2, '0');
  const monthPart = `${parsed.monthIndex + 1}`.padStart(2, '0');
  return localeWritesDayFirst()
    ? `${dayPart}/${monthPart}/${parsed.year}`
    : `${monthPart}/${dayPart}/${parsed.year}`;
}

export function parseDateInputValue(value: string) {
  const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(value);
  if (!match) {
    return null;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);
  const dayFirst = localeWritesDayFirst();
  let day = dayFirst ? first : second;
  let monthIndex = (dayFirst ? second : first) - 1;

  // If the literal reading is impossible but the swapped one works (e.g. a
  // dd/mm value like 25/12 typed in an mm/dd locale), accept the swap rather
  // than silently corrupting the date.
  if (monthIndex > 11 && day <= 12 && first !== second) {
    const swappedDay = dayFirst ? second : first;
    const swappedMonth = (dayFirst ? first : second) - 1;
    day = swappedDay;
    monthIndex = swappedMonth;
  }

  return normalizeDateKey(formatDateKey(year, monthIndex, day));
}

export function getTodayDateKey() {
  const today = new Date();
  return formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
}

export function getDateUtcDayValue(year: number, monthIndex: number, day: number) {
  return Date.UTC(year, monthIndex, day) / (24 * 60 * 60 * 1000);
}

export function formatLongDate(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return dateKey;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date(parsed.year, parsed.monthIndex, parsed.day));
}

export function shiftDateKey(dateKey: string, deltaDays: number) {
  const parsed = parseDateKey(dateKey) ?? parseDateKey(getTodayDateKey());
  if (!parsed) {
    return getTodayDateKey();
  }

  const nextDate = new Date(parsed.year, parsed.monthIndex, parsed.day + deltaDays);
  return formatDateKey(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
}

export function getDaysUntilDateKey(fromDateKey: string, toDateKey: string) {
  const fromParsed = parseDateKey(fromDateKey);
  const toParsed = parseDateKey(toDateKey);

  if (!fromParsed || !toParsed) {
    return Number.POSITIVE_INFINITY;
  }

  const fromDate = new Date(fromParsed.year, fromParsed.monthIndex, fromParsed.day);
  const toDate = new Date(toParsed.year, toParsed.monthIndex, toParsed.day);
  return Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
}

export function getMonthKeyFromDateKey(dateKey: string) {
  const parsed = parseDateKey(dateKey) ?? parseDateKey(getTodayDateKey());
  if (!parsed) {
    return getTodayDateKey().slice(0, 7);
  }

  return `${parsed.year}-${`${parsed.monthIndex + 1}`.padStart(2, '0')}`;
}

export function shiftMonthKey(monthKey: string, delta: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return getMonthKeyFromDateKey(getTodayDateKey());
  }

  const nextDate = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
  return `${nextDate.getFullYear()}-${`${nextDate.getMonth() + 1}`.padStart(2, '0')}`;
}

export function formatMonthLabel(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric'
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

export function buildCalendarDays(monthKey: string, selectedDate: string, entryDates: Set<string>) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) {
    return [] as Array<{
      dateKey: string;
      day: number;
      hasEntry: boolean;
      isCurrentMonth: boolean;
      isToday: boolean;
    }>;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const firstOfMonth = new Date(year, monthIndex, 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const firstVisibleDay = new Date(year, monthIndex, 1 - mondayOffset);
  const todayKey = getTodayDateKey();

  return Array.from({ length: 42 }, (_value, index) => {
    const dayDate = new Date(
      firstVisibleDay.getFullYear(),
      firstVisibleDay.getMonth(),
      firstVisibleDay.getDate() + index
    );
    const dateKey = formatDateKey(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());

    return {
      dateKey,
      day: dayDate.getDate(),
      hasEntry: entryDates.has(dateKey),
      isCurrentMonth: dayDate.getMonth() === monthIndex,
      isToday: dateKey === todayKey || dateKey === selectedDate && selectedDate === todayKey
    };
  });
}
