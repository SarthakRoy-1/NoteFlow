/**
 * The only module that talks to Google's Calendar and token endpoints. The refresh token is passed
 * in per call and never logged; errors are reduced to a small set of categories.
 */

export type CalendarFailure =
  /** Google no longer honours the grant (revoked, expired or removed): the user must reconnect. */
  | 'revoked'
  /** The grant exists but does not allow this (e.g. the Calendar permission was declined). */
  | 'no_permission'
  /** A timeout, network error, 429 or 5xx: worth trying again later. */
  | 'transient'
  /** Our request or configuration is wrong; retrying will not help. */
  | 'invalid';

export type UpsertOutcome = { ok: true; eventId: string } | { ok: false; failure: CalendarFailure };
export type DeleteOutcome = { ok: true } | { ok: false; failure: CalendarFailure };

export interface CalendarEventInput {
  /** Chosen by us (derived from the reminder id) so a repeated create can never duplicate. */
  eventId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  /** e.g. "RRULE:FREQ=WEEKLY;BYDAY=MO", or null for a one-off event. */
  rrule: string | null;
  reminderId: string;
}

export interface GoogleCalendarApi {
  /** Creates the event, or updates it when it already exists (same id). */
  upsertEvent(refreshToken: string, event: CalendarEventInput): Promise<UpsertOutcome>;
  deleteEvent(refreshToken: string, eventId: string): Promise<DeleteOutcome>;
  /** Best effort: ask Google to revoke the grant. Never throws. */
  revoke(refreshToken: string): Promise<void>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TIMEOUT_MS = 8_000;
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

interface Options {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

type Failure = { ok: false; failure: CalendarFailure };

export function createGoogleCalendarApi({
  clientId,
  clientSecret,
  fetchImpl = fetch,
}: Options): GoogleCalendarApi {
  const call = (url: string, init: RequestInit) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

  async function accessToken(refreshToken: string): Promise<{ ok: true; token: string } | Failure> {
    let res: Response;
    try {
      res = await call(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
    } catch {
      return { ok: false, failure: 'transient' };
    }
    const body = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      error?: unknown;
    } | null;
    if (res.ok && typeof body?.access_token === 'string') {
      return { ok: true, token: body.access_token };
    }
    if (res.status >= 500 || res.status === 429) return { ok: false, failure: 'transient' };
    // invalid_grant: revoked, expired (e.g. an app in "Testing" status) or the password changed.
    if (body?.error === 'invalid_grant') return { ok: false, failure: 'revoked' };
    return { ok: false, failure: 'invalid' };
  }

  /** Maps a non-2xx Calendar API answer to a failure category. */
  async function classify(res: Response): Promise<CalendarFailure> {
    if (res.status === 401) return 'revoked';
    if (res.status === 429 || res.status >= 500) return 'transient';
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as {
        error?: { errors?: { reason?: string }[] };
      } | null;
      const reason = body?.error?.errors?.[0]?.reason ?? '';
      return RATE_REASONS.has(reason) ? 'transient' : 'no_permission';
    }
    return 'invalid';
  }

  const eventBody = (e: CalendarEventInput) => ({
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
    end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
    recurrence: e.rrule ? [e.rrule] : [],
    status: 'confirmed',
    extendedProperties: { private: { noteflowReminderId: e.reminderId } },
  });

  const authHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  return {
    async upsertEvent(refreshToken, event) {
      const access = await accessToken(refreshToken);
      if (!access.ok) return access;
      const headers = authHeaders(access.token);
      const idUrl = `${EVENTS_URL}/${encodeURIComponent(event.eventId)}?sendUpdates=none`;
      try {
        const insert = () =>
          call(`${EVENTS_URL}?sendUpdates=none`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ id: event.eventId, ...eventBody(event) }),
          });
        // A create that finds the id already taken (an earlier attempt succeeded, or the event
        // exists) becomes an update, so the same reminder can never produce a second event.
        let res = await insert();
        if (res.status === 409) {
          res = await call(idUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(eventBody(event)),
          });
        }
        if (res.ok) return { ok: true, eventId: event.eventId };
        return { ok: false, failure: await classify(res) };
      } catch {
        return { ok: false, failure: 'transient' };
      }
    },

    async deleteEvent(refreshToken, eventId) {
      const access = await accessToken(refreshToken);
      if (!access.ok) return access;
      try {
        const res = await call(`${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=none`, {
          method: 'DELETE',
          headers: authHeaders(access.token),
        });
        // Already gone (404/410) is exactly what we wanted.
        if (res.ok || res.status === 404 || res.status === 410) return { ok: true };
        return { ok: false, failure: await classify(res) };
      } catch {
        return { ok: false, failure: 'transient' };
      }
    },

    async revoke(refreshToken) {
      try {
        await call(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
        });
      } catch {
        // Best effort: the local connection is removed either way.
      }
    },
  };
}
