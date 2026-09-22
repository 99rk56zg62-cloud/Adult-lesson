export type User = {
  id: string;
  email: string;
  name: string;
};

export type PublicConfig = {
  product: "Lido";
  timezone: string;
  currency: string;
  maxAdvanceWeeks: number;
  rescheduleCutoffHours: number;
  holdMinutes: number;
  paymentsMode: "stripe" | "mock";
  calendarConfigured: boolean;
  lessonDurations: number[];
  courseLengths: number[];
  courseDailyMinutes: number;
  courseMorningWindow: { startHour: number; endHour: number };
  adminUrl: string | null;
  demoLogin: { email: string; password: string; name: string } | null;
};

export type Location = {
  id: string;
  name: string;
  address: string;
  enabled: boolean;
};

export type DayAvailability = {
  dateKey: string;
  dayLabel: string;
  weekdayShort: string;
  dayOfMonth: number;
  openCount: number;
  totalCount: number;
  selectable: boolean;
};

export type Slot = {
  id: string;
  locationId: string;
  title: string;
  level: string;
  blurb: string;
  location: string;
  address: string;
  instructor: string;
  startsAt: string;
  endsAt: string;
  dayLabel: string;
  timeLabel: string;
  startTimeLabel: string;
  dateKey: string;
  weekKey: string;
  weekLabel: string;
  durationMinutes: number;
  pricePence: number;
  priceLabel: string;
  capacity: number;
  spotsLeft: number;
  spotsLabel: string;
  bookable: boolean;
  unavailableReason: string | null;
  soon: boolean;
  enabled: boolean;
  cancelled: boolean;
  ruleId: string | null;
};

export type CourseSession = {
  dayIndex: number;
  startsAt: string;
  endsAt: string;
  dayLabel: string;
  timeLabel: string;
  dateKey: string;
};

export type CourseRun = {
  id: string;
  productId: string;
  locationId: string;
  title: string;
  level: string;
  blurb: string;
  instructor: string;
  location: string;
  address: string;
  days: number;
  dailyMinutes: number;
  firstDate: string;
  dailyHour: number;
  dailyMinute: number;
  dailyTimeLabel: string;
  dateSummary: string;
  startsAt: string;
  endsAt: string;
  pricePence: number;
  priceLabel: string;
  capacity: number;
  spotsLeft: number;
  spotsLabel: string;
  bookable: boolean;
  unavailableReason: string | null;
  soon: boolean;
  enabled: boolean;
  cancelled: boolean;
  sessions: CourseSession[];
};

export type Booking = {
  id: string;
  reference: string;
  kind: "lesson" | "course";
  status: "pending_payment" | "confirmed" | "expired" | "cancelled";
  paymentSource: string | null;
  pricePence: number;
  priceLabel: string;
  createdAt: string;
  confirmedAt: string | null;
  holdExpiresAt: string | null;
  holdExpiresLabel: string | null;
  phase: "upcoming" | "past";
  rescheduleAllowed: boolean;
  rescheduleBlockedReason: string | null;
  rescheduleClosesAt: string;
  rescheduleClosesLabel: string;
  calendarSynced: boolean;
  googleCalendarUrl: string | null;
  slot: Slot | null;
  course: CourseRun | null;
};

export type CalendarStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  setupHint: string | null;
};

export type CheckoutResponse = {
  booking: Booking;
  checkoutUrl: string;
  sessionId: string;
};
