import type { Booking, CalendarStatus, CheckoutResponse, CourseRun, Location, PublicConfig, Slot, User } from "@/types";

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
    throw new ApiError(0, "NETWORK", "Can't reach the booking server. Check that it is running and EXPO_PUBLIC_API_URL points at it.");
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

function query(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  config: () => request<PublicConfig>("/api/config", { auth: false }),
  register: (body: { name: string; email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/register", { method: "POST", body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body, auth: false }),
  me: () => request<{ user: User }>("/api/me"),
  profile: () =>
    request<{
      complete: boolean;
      consentText: string;
      swimmingLevels: { id: string; label: string }[];
      profile: import("@/types").SwimmerProfile | null;
    }>("/api/profile"),
  saveProfile: (body: import("@/types").SwimmerProfile & { consent: boolean }) =>
    request<{ complete: boolean; profile: import("@/types").SwimmerProfile }>("/api/profile", { method: "PUT", body }),
  saveCourseNotes: (bookingId: string, body: { goal: string; comments?: string }) =>
    request<{ booking: Booking }>(`/api/bookings/${bookingId}/course-notes`, { method: "POST", body }),
  pages: () =>
    request<{
      contactEmail: string;
      contactPhone: string;
      contactTel: string;
      contactLine: string;
      courseIntro: string;
      packages: {
        days: number;
        title: string;
        body: string;
        priceLabel: string;
        depositLabel: string;
        balanceLabel: string;
        recommended: boolean;
      }[];
      weeklyCard: string;
      weeklyIntro: string;
      weeklyHeading: string;
      levels: { id: string; title: string; body: string }[];
      weeklyClosing: string;
      paymentPlan: string;
    }>("/api/pages"),
  locations: () => request<{ locations: Location[] }>("/api/locations"),
  slots: (filters?: { locationId?: string; durationMinutes?: number; partySize?: number; excludeBookingId?: string }) =>
    request<{
      slots: Slot[];
      days: import("@/types").DayAvailability[];
      windowEndsLabel: string;
      maxAdvanceWeeks: number;
      rescheduleCutoffHours: number;
    }>(`/api/slots${query(filters ?? {})}`),
  coursePlan: (days: number, locationId?: string) =>
    request<{
      days: number;
      dailyMinutes: number;
      pricePence: number;
      priceLabel: string;
      locationId: string;
      suggestions: import("@/types").CourseSuggestion[];
    }>(`/api/course-plans${query({ days, locationId })}`),
  courseDayOptions: (locationId: string | undefined, excludeDates: string[]) =>
    request<{ locationId: string; sessions: import("@/types").PlannedSession[] }>(
      `/api/course-plans/options${query({ locationId, excludeDates: excludeDates.join(",") })}`,
    ),
  addCourseToBasket: (body: {
    days: number;
    locationId?: string;
    partySize?: number;
    sessions: { dateKey: string; hour: number; minute: number }[];
  }) => request<{ items: Booking[]; totalPence: number; totalLabel: string }>("/api/basket/course", { method: "POST", body }),
  removeBasketBooking: (bookingId: string) =>
    request<{ items: Booking[]; totalPence: number; totalLabel: string }>(`/api/basket/bookings/${encodeURIComponent(bookingId)}`, {
      method: "DELETE",
    }),
  rescheduleSession: (bookingId: string, sessionId: string, body: { dateKey: string; hour: number; minute: number }) =>
    request<{ booking: Booking; calendarSyncError: string | null }>(
      `/api/bookings/${encodeURIComponent(bookingId)}/sessions/${encodeURIComponent(sessionId)}/reschedule`,
      { method: "POST", body },
    ),
  courses: (filters?: { locationId?: string; days?: number; partySize?: number }) =>
    request<{ courses: CourseRun[]; maxAdvanceWeeks: number }>(`/api/courses${query(filters ?? {})}`),
  slot: (id: string) => request<{ slot: Slot }>(`/api/slots/${id}`),
  course: (id: string) => request<{ course: CourseRun }>(`/api/courses/${id}`),
  bookings: () => request<{ bookings: Booking[] }>("/api/bookings"),
  booking: (id: string) => request<{ booking: Booking }>(`/api/bookings/${id}`),
  createBooking: (input: { slotId?: string; courseRunId?: string; returnUrl: string }) =>
    request<CheckoutResponse>("/api/bookings", { method: "POST", body: input }),
  basket: () => request<{ items: Booking[]; totalPence: number; totalLabel: string }>("/api/basket"),
  addToBasket: (slotId: string) =>
    request<{ items: Booking[]; totalPence: number; totalLabel: string }>("/api/basket", { method: "POST", body: { slotId } }),
  removeFromBasket: (slotId: string) =>
    request<{ items: Booking[]; totalPence: number; totalLabel: string }>(`/api/basket/${encodeURIComponent(slotId)}`, {
      method: "DELETE",
    }),
  checkoutBasket: (returnUrl: string, options?: { savedCardId?: string; saveCard?: boolean }) =>
    request<CheckoutResponse & { paidImmediately?: boolean }>("/api/basket/checkout", { method: "POST", body: { returnUrl, ...options } }),
  cards: () => request<{ cards: { id: string; brand: string; last4: string; expMonth: number; expYear: number; isDefault: boolean }[] }>("/api/cards"),
  addCard: (body: { brand?: string; last4: string; expMonth: number; expYear: number }) =>
    request<{ cards: { id: string; brand: string; last4: string; expMonth: number; expYear: number; isDefault: boolean }[] }>("/api/cards", {
      method: "POST",
      body,
    }),
  defaultCard: (id: string) =>
    request<{ cards: { id: string; brand: string; last4: string; isDefault: boolean }[] }>(`/api/cards/${id}/default`, { method: "POST" }),
  removeCard: (id: string) => request<{ cards: { id: string }[] }>(`/api/cards/${id}`, { method: "DELETE" }),
  notificationSettings: () => request<{ pushOptOut: boolean; emailStaysOn: boolean }>("/api/notification-settings"),
  saveNotificationSettings: (body: { pushOptOut?: boolean }) =>
    request<{ pushOptOut: boolean; emailStaysOn: boolean }>("/api/notification-settings", { method: "PUT", body }),
  balanceCheckout: (bookingId: string, returnUrl: string) =>
    request<CheckoutResponse>(`/api/bookings/${bookingId}/balance-checkout`, { method: "POST", body: { returnUrl } }),
  refreshCheckout: (id: string, returnUrl: string) =>
    request<CheckoutResponse>(`/api/bookings/${id}/checkout`, { method: "POST", body: { returnUrl } }),
  confirm: (sessionId: string) =>
    request<{ booking: Booking; calendarSyncError: string | null }>("/api/payments/confirm", {
      method: "POST",
      body: { sessionId },
    }),
  reschedule: (id: string, input: { slotId?: string; courseRunId?: string }) =>
    request<{ booking: Booking; calendarSyncError: string | null }>(`/api/bookings/${id}/reschedule`, {
      method: "POST",
      body: input,
    }),
  syncCalendar: (id: string) => request<{ booking: Booking }>(`/api/bookings/${id}/calendar-sync`, { method: "POST" }),
  calendarStatus: () => request<CalendarStatus>("/api/calendar/status"),
  connectCalendar: (returnUrl: string) =>
    request<{ url: string }>("/api/calendar/connect", { method: "POST", body: { returnUrl } }),
  disconnectCalendar: () => request<CalendarStatus>("/api/calendar", { method: "DELETE" }),
};
