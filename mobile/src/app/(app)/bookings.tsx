import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { Banner, Button, TopBar } from "@/components/ui";
import { colors, serif } from "@/theme";
import type { Booking } from "@/types";

export default function BookingsScreen() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.bookings();
      setBookings(result.bookings);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const upcoming = bookings.filter((booking) => booking.phase === "upcoming");
  const past = bookings.filter((booking) => booking.phase === "past");

  return (
    <View style={styles.screen}>
      <TopBar tone="dark" title="My lessons" subtitle="Paid bookings, and any still waiting for payment." />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.pool} onRefresh={() => { setRefreshing(true); void load(); }} />}
        contentContainerStyle={styles.content}
      >
        {error ? <Banner tone="danger" text={error} /> : null}
        {loading && bookings.length === 0 ? <ActivityIndicator color={colors.pool} style={{ marginTop: 24 }} /> : null}
        {!loading && bookings.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No bookings yet</Text>
            <Text style={styles.emptyBody}>The schedule shows single lessons and crash courses for the next 6 weeks.</Text>
            <Button label="Browse the schedule" onPress={() => router.push("/schedule")} />
          </View>
        ) : null}
        {upcoming.length > 0 ? <Text style={styles.section}>Coming up</Text> : null}
        {upcoming.map((booking) => (
          <BookingRow key={booking.id} booking={booking} />
        ))}
        {past.length > 0 ? <Text style={styles.section}>Earlier</Text> : null}
        {past.map((booking) => (
          <BookingRow key={booking.id} booking={booking} />
        ))}
      </ScrollView>
    </View>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const pending = booking.status === "pending_payment";
  const isCourse = booking.kind === "course";
  const party = isCourse ? booking.course?.partyLabel : booking.slot?.partyLabel;
  const title = isCourse ? booking.course?.title ?? "Crash course" : booking.slot?.title ?? "Lesson";
  const when = isCourse
    ? `${booking.course?.dateSummary}\n${booking.course?.dailyTimeLabel} daily`
    : `${booking.slot?.dayLabel}\n${booking.slot?.timeLabel}`;
  const where = isCourse ? booking.course?.location : booking.slot?.location;

  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/booking/${booking.id}`)} style={styles.card}>
      <View style={[styles.bar, { backgroundColor: colors.pool }]} />
      <View style={styles.body}>
        <Text style={styles.kicker}>{pending ? "Payment not finished" : `${booking.reference}${isCourse ? " · Course" : ""}`}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>
          {when}
          {party ? `\n${party}` : ""}
          {where ? `\n${where}` : ""}
        </Text>
        {pending && booking.holdExpiresLabel ? <Text style={styles.hold}>Held until {booking.holdExpiresLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 12, paddingBottom: 32 },
  section: { fontFamily: serif, fontSize: 22, fontWeight: "700", color: colors.ink, marginTop: 8 },
  card: { flexDirection: "row", backgroundColor: colors.white, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  bar: { width: 6 },
  body: { flex: 1, padding: 14, gap: 3 },
  kicker: { color: colors.pool, fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted, lineHeight: 18 },
  hold: { color: colors.warn, fontWeight: "600", marginTop: 4 },
  empty: { gap: 12, paddingTop: 12 },
  emptyTitle: { fontFamily: serif, fontSize: 28, fontWeight: "700", color: colors.ink },
  emptyBody: { color: colors.muted, lineHeight: 20 },
});
