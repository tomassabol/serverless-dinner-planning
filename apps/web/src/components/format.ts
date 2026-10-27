const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

export const asDate = (date: string) => new Date(`${date}T12:00:00Z`);
export const longDay = (date: string) => dayFormat.format(asDate(date));
export const shortDay = (date: string) => shortDayFormat.format(asDate(date));
export const dkk = (n: number) => `${n.toLocaleString('da-DK', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} kr`;
export const weekNumber = (week: string) => Number(week.split('-W')[1]);

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "6 Nov" */
export const dayMonth = (date: string) => shortDate.format(asDate(date));

/** "2 Nov – 8 Nov" for the Monday-to-Sunday week containing a date. */
export function weekRange(anyDateInWeek: string): string {
  const date = asDate(anyDateInWeek);
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return `${shortDate.format(monday)} – ${shortDate.format(sunday)}`;
}

export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Local date (YYYY-MM-DD) in Copenhagen, to highlight tonight's dinner. */
export const todayInCopenhagen = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
