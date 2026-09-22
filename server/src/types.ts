export type BookingStatus = "pending_payment" | "confirmed" | "expired" | "cancelled";
export type BookingKind = "lesson" | "course";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  google_refresh_token: string | null;
  google_email: string | null;
  created_at: string;
};

export type LocationRow = {
  id: string;
  name: string;
  address: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type AvailabilityRuleRow = {
  id: string;
  location_id: string;
  weekday: number;
  hour: number;
  minute: number;
  duration_minutes: number;
  capacity: number;
  price_pence: number;
  title: string;
  level: string;
  blurb: string;
  instructor: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type SlotRow = {
  id: string;
  rule_id: string | null;
  location_id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  capacity: number;
  price_pence: number;
  title: string;
  level: string;
  blurb: string;
  location: string;
  address: string;
  instructor: string;
  enabled: number;
  cancelled: number;
};

export type CourseProductRow = {
  id: string;
  location_id: string;
  days: number;
  daily_minutes: number;
  capacity: number;
  price_pence: number;
  title: string;
  level: string;
  blurb: string;
  instructor: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type CourseRunRow = {
  id: string;
  product_id: string;
  location_id: string;
  first_date: string;
  daily_hour: number;
  daily_minute: number;
  days: number;
  daily_minutes: number;
  capacity: number;
  price_pence: number;
  title: string;
  level: string;
  blurb: string;
  instructor: string;
  location: string;
  address: string;
  enabled: number;
  cancelled: number;
  created_at: string;
};

export type CourseSessionRow = {
  id: string;
  run_id: string;
  day_index: number;
  starts_at: string;
  ends_at: string;
};

export type BookingRow = {
  id: string;
  reference: string;
  user_id: string;
  kind: BookingKind;
  slot_id: string | null;
  course_run_id: string | null;
  status: BookingStatus;
  hold_expires_at: string | null;
  price_pence: number;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  payment_source: string | null;
  return_url: string | null;
  calendar_event_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  rescheduled_at: string | null;
};

export type UserDto = {
  id: string;
  email: string;
  name: string;
};

export type LocationDto = {
  id: string;
  name: string;
  address: string;
  enabled: boolean;
};

export type SlotDto = {
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

export type DayAvailability = {
  dateKey: string;
  dayLabel: string;
  weekdayShort: string;
  dayOfMonth: number;
  openCount: number;
  totalCount: number;
  selectable: boolean;
};

export type AvailabilityRuleDto = {
  id: string;
  locationId: string;
  locationName: string;
  locationAddress: string;
  weekday: number;
  weekdayLabel: string;
  hour: number;
  minute: number;
  timeLabel: string;
  durationMinutes: number;
  capacity: number;
  pricePence: number;
  priceLabel: string;
  title: string;
  level: string;
  blurb: string;
  instructor: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CourseSessionDto = {
  dayIndex: number;
  startsAt: string;
  endsAt: string;
  dayLabel: string;
  timeLabel: string;
  dateKey: string;
};

export type CourseRunDto = {
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
  sessions: CourseSessionDto[];
};

export type CourseProductDto = {
  id: string;
  locationId: string;
  locationName: string;
  days: number;
  dailyMinutes: number;
  capacity: number;
  pricePence: number;
  priceLabel: string;
  title: string;
  level: string;
  blurb: string;
  instructor: string;
  enabled: boolean;
};

export type BookingDto = {
  id: string;
  reference: string;
  kind: BookingKind;
  status: BookingStatus;
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
  slot: SlotDto | null;
  course: CourseRunDto | null;
};

export type PublicConfig = {
  product: "Lido";
  timezone: "Europe/London";
  currency: "GBP";
  maxAdvanceWeeks: number;
  rescheduleCutoffHours: number;
  holdMinutes: number;
  paymentsMode: "stripe" | "mock";
  calendarConfigured: boolean;
  lessonDurations: number[];
  courseLengths: number[];
  courseDailyMinutes: number;
  courseMorningWindow: { startHour: number; endHour: number };
  demoLogin: { email: string; password: string; name: string } | null;
  adminUrl?: string | null;
};
