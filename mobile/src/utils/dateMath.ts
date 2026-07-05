/** Local-clock (not Europe/Stockholm-server-computed — this is only ever
 * used to pre-fill KB3's date pickers with a sane default, the server is
 * the real source of truth for date validation) ISO `YYYY-MM-DD` helpers
 * for the goal-builder's default start/end dates. */
export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

export function addDaysIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
