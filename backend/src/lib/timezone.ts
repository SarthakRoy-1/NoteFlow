import { IANAZone } from 'luxon';

/** True for 'UTC' or a Region/City style IANA identifier that the runtime recognises. */
export function isValidIanaTimezone(value: string): boolean {
  if (value !== 'UTC' && !value.includes('/')) return false;
  return IANAZone.isValidZone(value);
}
