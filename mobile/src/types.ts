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
  demoLogin: { email: string; password: string; name: string } | null;
};

export type Slot = {
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

export type Booking = {
  id: string;
  reference: string;
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
  slot: Slot;
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
