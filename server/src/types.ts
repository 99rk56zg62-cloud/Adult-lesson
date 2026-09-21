export type BookingStatus = "pending_payment" | "confirmed" | "expired" | "cancelled";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  google_refresh_token: string | null;
  google_email: string | null;
  created_at: string;
};

export type SlotRow = {
  id: string;
  rule_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  price_pence: number;
  title: string;
  level: string;
  blurb: string;
  location: string;
  address: string;
  instructor: string;
};

export type BookingRow = {
  id: string;
  reference: string;
  user_id: string;
  slot_id: string;
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

export type SlotDto = {
  id: string;
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
};

export type BookingDto = {
  id: string;
  reference: string;
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
  slot: SlotDto;
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
  demoLogin: { email: string; password: string; name: string } | null;
};
