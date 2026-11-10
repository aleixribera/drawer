/** Time helpers. Everything is stored as UTC ISO strings and shown in the owner's time zone. */

/** DRAWER_TIME_ZONE, else TZ, else the machine's own zone. */
export const OWNER_TIME_ZONE = ownerTimeZone();

function ownerTimeZone(): string {
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const zone = process.env.DRAWER_TIME_ZONE || process.env.TZ || system;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return system;
  }
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock & { set(iso: string): void; advance(ms: number): void } {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set: (next) => (current = new Date(next)),
    advance: (ms) => (current = new Date(current.getTime() + ms)),
  };
}

/** The offset of a time zone from UTC at a given instant, in minutes (Madrid in summer: +120). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** A wall-clock time in a time zone (what WhatsApp prints) as the instant it names. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone = OWNER_TIME_ZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = offsetMinutes(new Date(guess), timeZone);
  const second_ = offsetMinutes(new Date(guess - first * 60000), timeZone);
  return new Date(guess - second_ * 60000);
}

export const DAY = 86_400_000;

export function daysBetween(earlier: Date | string, later: Date | string): number {
  return (new Date(later).getTime() - new Date(earlier).getTime()) / DAY;
}
