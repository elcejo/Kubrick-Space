/** Proleptic Gregorian dates; a negative historical year denotes AC, without a year zero. */
export function calendarDate(value) {
  if (typeof value !== 'string' || !/^-?\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [historicalYear, month, day] = value.replace(/^-/, '').split('-').map(Number);
  if (historicalYear < 1 || month < 1 || month > 12 || day < 1) return null;
  const year = value.startsWith('-') ? 1 - historicalYear : historicalYear;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1] ? value : null;
}

export function calendarDateToDate(value) {
  if (!calendarDate(value)) return new Date(NaN);
  const [year, month, day] = value.replace(/^-/, '').split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(value.startsWith('-') ? 1 - year : year, month - 1, day);
  return date;
}

export function calendarDateFromDate(date) {
  if (!Number.isFinite(date?.getTime())) return null;
  const year = date.getUTCFullYear();
  const historicalYear = year <= 0 ? 1 - year : year;
  if (historicalYear > 9999) return null;
  return `${year <= 0 ? '-' : ''}${String(historicalYear).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function compareCalendarDates(a, b) {
  return calendarDateToDate(a).getTime() - calendarDateToDate(b).getTime();
}
