import { DateTime } from "luxon";

export const ZONE = "Europe/London";

export function toUtcIso(value: DateTime): string {
  const iso = value.toUTC().toISO({ suppressMilliseconds: false });
  if (!iso) {
    throw new Error("Invalid date");
  }
  return iso;
}

export function parseInstant(value: string): DateTime | null {
  const hasZone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value);
  const parsed = hasZone
    ? DateTime.fromISO(value, { setZone: true })
    : DateTime.fromISO(value, { zone: ZONE });
  return parsed.isValid ? parsed : null;
}

export function fromIso(value: string): DateTime {
  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parsed;
}
