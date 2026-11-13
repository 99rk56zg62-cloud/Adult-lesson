import { DateTime } from "luxon";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { ZONE } from "./time.js";

export type CalendarEventInput = {
  refreshToken: string;
  eventId?: string | null;
  summary: string;
  description: string;
  location: string;
  startsAt: DateTime;
  endsAt: DateTime;
};

export type CalendarGateway = {
  configured: boolean;
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<{ refreshToken: string | null; email: string | null }>;
  upsertEvent(input: CalendarEventInput): Promise<{ eventId: string; htmlLink: string | null }>;
};

const CALENDAR_SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";

const NOT_CONFIGURED =
  "Google Calendar isn't configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or use Add to Google Calendar on a booking.";

export function createCalendarGateway(config: AppConfig): CalendarGateway {
  const configured = Boolean(config.googleClientId && config.googleClientSecret);
  const redirectUri = `${config.apiPublicUrl}/api/calendar/callback`;

  return {
    configured,
    authUrl(state) {
      if (!config.googleClientId) {
        throw new AppError(503, "CALENDAR_NOT_CONFIGURED", NOT_CONFIGURED);
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", config.googleClientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", CALENDAR_SCOPE);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("state", state);
      return url.toString();
    },
    async exchangeCode(code) {
      if (!config.googleClientId || !config.googleClientSecret) {
        throw new AppError(503, "CALENDAR_NOT_CONFIGURED", NOT_CONFIGURED);
      }
      const token = await postForm("https://oauth2.googleapis.com/token", {
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      const accessToken = typeof token.access_token === "string" ? token.access_token : null;
      return {
        refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : null,
        email: accessToken ? await fetchEmail(accessToken) : null,
      };
    },
    async upsertEvent(input) {
      if (!config.googleClientId || !config.googleClientSecret) {
        throw new AppError(503, "CALENDAR_NOT_CONFIGURED", NOT_CONFIGURED);
      }
      const access = await refreshAccess(config, input.refreshToken);
      const body = {
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: { dateTime: input.startsAt.setZone(ZONE).toISO({ suppressMilliseconds: true }), timeZone: ZONE },
        end: { dateTime: input.endsAt.setZone(ZONE).toISO({ suppressMilliseconds: true }), timeZone: ZONE },
      };
      if (input.eventId) {
        const patched = await writeEvent("PATCH", input.eventId, access, body);
        if (patched) return patched;
      }
      const created = await writeEvent("POST", null, access, body);
      if (!created) {
        throw new AppError(502, "CALENDAR_SYNC", "Google Calendar couldn't be updated.");
      }
      return created;
    },
  };
}

async function refreshAccess(config: AppConfig, refreshToken: string): Promise<string> {
  const token = await postForm("https://oauth2.googleapis.com/token", {
    client_id: config.googleClientId ?? "",
    client_secret: config.googleClientSecret ?? "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (typeof token.access_token !== "string") {
    throw new AppError(409, "CALENDAR_AUTH", "Google Calendar needs to be reconnected.");
  }
  return token.access_token;
}

async function postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    console.error("google token error", response.status, json.error);
    throw new AppError(
      502,
      "CALENDAR_AUTH",
      "Google Calendar rejected the sign-in. Check the OAuth client id, secret, and redirect URI.",
    );
  }
  return json;
}

async function fetchEmail(accessToken: string): Promise<string | null> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { email?: string };
  return json.email ?? null;
}

async function writeEvent(
  method: "POST" | "PATCH",
  eventId: string | null,
  accessToken: string,
  body: unknown,
): Promise<{ eventId: string; htmlLink: string | null } | null> {
  const endpoint = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const response = await fetch(endpoint, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 404 && method === "PATCH") return null;
  if (response.status === 401 || response.status === 403) {
    throw new AppError(409, "CALENDAR_AUTH", "Google Calendar needs to be reconnected.");
  }
  if (!response.ok) {
    console.error("calendar event error", response.status);
    throw new AppError(502, "CALENDAR_SYNC", "Google Calendar couldn't be updated.");
  }
  const json = (await response.json()) as { id?: string; htmlLink?: string };
  if (!json.id) {
    throw new AppError(502, "CALENDAR_SYNC", "Google Calendar didn't return an event.");
  }
  return { eventId: json.id, htmlLink: json.htmlLink ?? null };
}
