import type { Booking, CalendarStatus, CheckoutResponse, PublicConfig, Slot, User } from "@/types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => {};

export function setApiToken(value: string | null) {
  token = value;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

async function request<T>(path: string, options?: { method?: string; body?: unknown; auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body !== undefined) headers["content-type"] = "application/json";
  if (options?.auth !== false && token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the Lido server. Check that it is running and EXPO_PUBLIC_API_URL points at it.");
  }
  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const code = payload?.error?.code ?? "REQUEST_FAILED";
    const message = payload?.error?.message ?? "Something went wrong. Please try again.";
    if (response.status === 401 && options?.auth !== false) onUnauthorized();
    throw new ApiError(response.status, code, message);
  }
  return payload as T;
}

export const api = {
  config: () => request<PublicConfig>("/api/config", { auth: false }),
  register: (body: { name: string; email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/register", { method: "POST", body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body, auth: false }),
  me: () => request<{ user: User }>("/api/me"),
  slots: () =>
    request<{
      slots: Slot[];
      days: import("@/types").DayAvailability[];
      windowEndsLabel: string;
      maxAdvanceWeeks: number;
      rescheduleCutoffHours: number;
    }>("/api/slots"),
  slot: (id: string) => request<{ slot: Slot }>(`/api/slots/${id}`),
  bookings: () => request<{ bookings: Booking[] }>("/api/bookings"),
  booking: (id: string) => request<{ booking: Booking }>(`/api/bookings/${id}`),
  createBooking: (slotId: string, returnUrl: string) =>
    request<CheckoutResponse>("/api/bookings", { method: "POST", body: { slotId, returnUrl } }),
  refreshCheckout: (id: string, returnUrl: string) =>
    request<CheckoutResponse>(`/api/bookings/${id}/checkout`, { method: "POST", body: { returnUrl } }),
  confirm: (sessionId: string) =>
    request<{ booking: Booking; calendarSyncError: string | null }>("/api/payments/confirm", {
      method: "POST",
      body: { sessionId },
    }),
  reschedule: (id: string, slotId: string) =>
    request<{ booking: Booking; calendarSyncError: string | null }>(`/api/bookings/${id}/reschedule`, {
      method: "POST",
      body: { slotId },
    }),
  syncCalendar: (id: string) => request<{ booking: Booking }>(`/api/bookings/${id}/calendar-sync`, { method: "POST" }),
  calendarStatus: () => request<CalendarStatus>("/api/calendar/status"),
  connectCalendar: (returnUrl: string) =>
    request<{ url: string }>("/api/calendar/connect", { method: "POST", body: { returnUrl } }),
  disconnectCalendar: () => request<CalendarStatus>("/api/calendar", { method: "DELETE" }),
};
