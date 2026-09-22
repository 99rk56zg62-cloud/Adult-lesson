import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { runCheckout } from "@/checkout";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { paymentReturnUrl } from "@/return-url";
import { colors, levelColor, serif } from "@/theme";
import type { CourseRun } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { config } = useAuth();
  const [course, setCourse] = useState<CourseRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.course(one(id));
        if (!cancelled) setCourse(result.course);
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function book() {
    if (!course) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const checkout = await api.createBooking({ courseRunId: course.id, returnUrl: paymentReturnUrl() });
      const result = await runCheckout({
        checkoutUrl: checkout.checkoutUrl,
        sessionId: checkout.sessionId,
        bookingId: checkout.booking.id,
        returnUrl: paymentReturnUrl(),
      });
      if (result.leftApp) return;
      if (result.booking.status === "confirmed") {
        router.replace(`/booking/${result.booking.id}`);
        return;
      }
      setInfo("Payment wasn't completed. The place stays held for a short time — finish from My lessons.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar tone="dark" title={course?.title ?? "Crash course"} subtitle={course?.dateSummary ?? " "} back />
      {!course && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 32 }} /> : null}
      {error ? (
        <View style={styles.pad}>
          <Banner tone="danger" text={error} />
        </View>
      ) : null}
      {course ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.level, { backgroundColor: levelColor(course.level) }]}>
            <Text style={styles.levelText}>{course.level}</Text>
          </View>
          <Text style={styles.place}>{course.location}</Text>
          <Text style={styles.address}>{course.address}</Text>
          <Text style={styles.blurb}>{course.blurb}</Text>
          <View style={styles.facts}>
            <Fact label="Dates" value={course.dateSummary} />
            <Fact label="Daily time" value={`${course.dailyTimeLabel} · ${course.dailyMinutes} minutes`} />
            <Fact label="Teacher" value={course.instructor} />
            <Fact label="Places" value={course.spotsLabel} />
            <Fact label="Price" value={course.priceLabel} />
          </View>
          <View style={styles.schedule}>
            <Text style={styles.scheduleTitle}>Your schedule</Text>
            {course.sessions.map((session) => (
              <Text key={session.dayIndex} style={styles.sessionLine}>
                Day {session.dayIndex}: {session.dayLabel}, {session.timeLabel}
              </Text>
            ))}
          </View>
          <Text style={styles.note}>
            Booking reserves the whole {course.days}-day run. You can move to another open {course.days}-day run until 24 hours before day one.
          </Text>
          {course.soon && course.bookable ? (
            <Banner tone="warn" text="This course starts soon. After you book, it can't be moved — changes close 24 hours before day one." />
          ) : null}
          {course.unavailableReason ? <Banner tone="warn" text={course.unavailableReason} /> : null}
          {info ? <Banner tone="warn" text={info} /> : null}
          <Button
            label={busy ? "Opening payment…" : course.bookable ? `Book course · ${course.priceLabel}` : "Can't book this course"}
            disabled={!course.bookable || busy}
            onPress={book}
          />
          <Text style={styles.payNote}>
            {config?.paymentsMode === "stripe"
              ? "You'll pay on Stripe's secure page. The course appears in My lessons after payment succeeds."
              : "This server is using a local test payment, so you won't be charged."}
          </Text>
        </ScrollView>
      ) : null}
    </Phone>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 20 },
  content: { padding: 20, gap: 12, paddingBottom: 36 },
  level: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  levelText: { color: colors.white, fontWeight: "700", fontSize: 12 },
  place: { fontFamily: serif, fontSize: 28, fontWeight: "700", color: colors.ink },
  address: { color: colors.muted, marginTop: -6 },
  blurb: { fontSize: 16, lineHeight: 23, color: colors.ink },
  facts: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 6 },
  fact: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  factLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  factValue: { color: colors.ink, fontSize: 16, marginTop: 2 },
  schedule: { gap: 6 },
  scheduleTitle: { fontFamily: serif, fontSize: 22, fontWeight: "700", color: colors.ink },
  sessionLine: { color: colors.ink, lineHeight: 20 },
  note: { color: colors.muted, lineHeight: 20 },
  payNote: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
