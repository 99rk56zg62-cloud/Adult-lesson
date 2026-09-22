import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { runCheckout } from "@/checkout";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { paymentReturnUrl } from "@/return-url";
import { colors, serif } from "@/theme";
import type { Booking, CalendarStatus } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextBooking, nextCalendar] = await Promise.all([api.booking(one(id)), api.calendarStatus()]);
      setBooking(nextBooking.booking);
      setCalendar(nextCalendar);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function pay() {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      const checkout = await api.refreshCheckout(booking.id, paymentReturnUrl());
      const result = await runCheckout({
        checkoutUrl: checkout.checkoutUrl,
        sessionId: checkout.sessionId,
        bookingId: checkout.booking.id,
        returnUrl: paymentReturnUrl(),
      });
      if (!result.leftApp) {
        setBooking(result.booking);
        if (result.booking.status !== "confirmed") {
          setInfo("Payment wasn't completed. You can try again while the space is held.");
        }
      }
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.syncCalendar(booking.id);
      setBooking(result.booking);
      setInfo("Added to your Google Calendar.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const pending = booking?.status === "pending_payment";
  const isCourse = booking?.kind === "course";
  const title = isCourse ? booking?.course?.title : booking?.slot?.title;
  const when = isCourse
    ? `${booking?.course?.dateSummary}\n${booking?.course?.dailyTimeLabel} daily · ${booking?.course?.dailyMinutes} min`
    : `${booking?.slot?.dayLabel}\n${booking?.slot?.timeLabel}`;
  const place = isCourse
    ? `${booking?.course?.location}, ${booking?.course?.address}`
    : `${booking?.slot?.location}, ${booking?.slot?.address}`;
  const meta = isCourse
    ? `${booking?.course?.level} · ${booking?.course?.instructor} · Paid ${booking?.priceLabel}`
    : `${booking?.slot?.level} · ${booking?.slot?.instructor} · Paid ${booking?.priceLabel}`;

  return (
    <Phone>
      <TopBar
        tone="dark"
        title={booking?.reference ?? (isCourse ? "Course" : "Lesson")}
        subtitle={pending ? "Waiting for payment" : "You're booked"}
        back
      />
      {!booking && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 32 }} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {info ? <Banner tone="ok" text={info} /> : null}
        {booking?.paymentSource === "seed" ? (
          <Banner tone="warn" text="This sample booking was added so you can try rearranging. New bookings are charged." />
        ) : null}
        {booking ? (
          <>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.when}>{when}</Text>
            {isCourse && booking.course ? (
              <View style={styles.schedule}>
                {booking.course.sessions.map((session) => (
                  <Text key={session.dayIndex} style={styles.sessionLine}>
                    Day {session.dayIndex}: {session.dayLabel}, {session.timeLabel}
                  </Text>
                ))}
              </View>
            ) : null}
            <Text style={styles.place}>{place}</Text>
            <Text style={styles.meta}>{meta}</Text>
            {pending ? (
              <>
                <Banner
                  tone="warn"
                  text={booking.holdExpiresLabel ? `Complete payment by ${booking.holdExpiresLabel} to keep this place.` : "Payment hasn't been completed."}
                />
                <Button label={busy ? "Opening payment…" : `Pay ${booking.priceLabel}`} disabled={busy} onPress={pay} />
              </>
            ) : null}
            {booking.status === "confirmed" ? (
              <View style={styles.block}>
                <Text style={styles.heading}>{isCourse ? "Move course" : "Rearrange"}</Text>
                {booking.rescheduleAllowed ? (
                  <Text style={styles.body}>
                    {isCourse
                      ? `You can move to another open ${booking.course?.days}-day run until ${booking.rescheduleClosesLabel}. You won't be charged again.`
                      : `You can move this lesson until ${booking.rescheduleClosesLabel}. You won't be charged again.`}
                  </Text>
                ) : (
                  <Text style={styles.body}>{booking.rescheduleBlockedReason}</Text>
                )}
                <Button
                  label={isCourse ? "Choose another run" : "Choose a new time"}
                  variant="secondary"
                  disabled={!booking.rescheduleAllowed}
                  onPress={() => router.push(`/reschedule/${booking.id}`)}
                />
              </View>
            ) : null}
            {booking.status === "confirmed" ? (
              <View style={styles.block}>
                <Text style={styles.heading}>Calendar</Text>
                {booking.calendarSynced ? (
                  <Banner tone="ok" text={isCourse ? "This course is on your Google Calendar." : "This lesson is on your Google Calendar. Rearranging it updates the event."} />
                ) : null}
                {!booking.calendarSynced && calendar?.connected ? (
                  <Button label={busy ? "Syncing…" : "Add to my Google Calendar"} disabled={busy} onPress={sync} />
                ) : null}
                {!booking.calendarSynced && booking.googleCalendarUrl ? (
                  <Button
                    label="Add to Google Calendar"
                    variant={calendar?.connected ? "secondary" : "primary"}
                    onPress={() => Linking.openURL(booking.googleCalendarUrl!)}
                  />
                ) : null}
                {!calendar?.connected ? (
                  <Text style={styles.body}>Connect Google Calendar in Account if you want bookings added for you.</Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Phone>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  title: { fontFamily: serif, fontSize: 32, fontWeight: "700", color: colors.ink },
  when: { fontSize: 18, lineHeight: 26, color: colors.ink, fontWeight: "600" },
  schedule: { gap: 4 },
  sessionLine: { color: colors.ink, lineHeight: 20 },
  place: { color: colors.muted, lineHeight: 20 },
  meta: { color: colors.ink },
  block: { gap: 10, marginTop: 8 },
  heading: { fontFamily: serif, fontSize: 24, fontWeight: "700", color: colors.ink },
  body: { color: colors.ink, lineHeight: 21 },
});
