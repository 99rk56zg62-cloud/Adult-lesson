import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { BookingCalendar } from "@/components/booking-calendar";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { colors, levelColor, serif } from "@/theme";
import type { Booking, DayAvailability, Slot } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function RescheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextBooking, schedule] = await Promise.all([api.booking(one(id)), api.slots()]);
        if (cancelled) return;
        setBooking(nextBooking.booking);
        setSlots(schedule.slots);
        setDays(schedule.days);
        const first = schedule.days.find((day) => day.selectable && day.dateKey !== nextBooking.booking.slot.dateKey)
          ?? schedule.days.find((day) => day.selectable);
        setSelectedDay(first?.dateKey ?? null);
        if (first) setMonthKey(first.dateKey.slice(0, 7));
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const options = useMemo(
    () => slots.filter((slot) => slot.bookable && slot.id !== booking?.slot.id && slot.dateKey === selectedDay),
    [slots, booking?.slot.id, selectedDay],
  );
  const chosen = options.find((slot) => slot.id === selected) ?? null;
  const dayMeta = days.find((day) => day.dateKey === selectedDay) ?? null;

  async function confirm() {
    if (!booking || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.reschedule(booking.id, chosen.id);
      router.replace(`/booking/${result.booking.id}`);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar tone="dark" title="New time" subtitle="You won't be charged again." back />
      {!booking && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 28 }} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {booking && !booking.rescheduleAllowed ? (
          <Banner tone="warn" text={booking.rescheduleBlockedReason ?? "This lesson can't be rearranged."} />
        ) : null}
        {booking?.rescheduleAllowed ? (
          <>
            <Text style={styles.lead}>
              Currently {booking.slot.dayLabel}, {booking.slot.timeLabel}.
            </Text>
            <BookingCalendar
              monthKey={monthKey}
              days={days}
              selected={selectedDay}
              onSelect={(dateKey) => {
                setSelectedDay(dateKey);
                setSelected(null);
              }}
              onMonthChange={setMonthKey}
            />
            {dayMeta ? <Text style={styles.dayTitle}>{dayMeta.dayLabel}</Text> : null}
            {options.length === 0 ? <Text style={styles.empty}>No other open times on this day.</Text> : null}
            {options.map((slot) => (
              <Pressable
                key={slot.id}
                accessibilityRole="button"
                onPress={() => setSelected(slot.id)}
                style={[styles.timeRow, selected === slot.id && styles.selected]}
              >
                <View style={[styles.bar, { backgroundColor: levelColor(slot.level) }]} />
                <View style={styles.body}>
                  <Text style={styles.time}>{slot.startTimeLabel}</Text>
                  <Text style={styles.title}>{slot.title}</Text>
                  <Text style={styles.meta}>
                    {slot.location} · {slot.spotsLabel}
                  </Text>
                </View>
                <Text style={styles.price}>{slot.priceLabel}</Text>
              </Pressable>
            ))}
            {chosen?.soon ? <Banner tone="warn" text="That session starts soon, so you won't be able to rearrange it again." /> : null}
          </>
        ) : null}
      </ScrollView>
      {booking?.rescheduleAllowed ? (
        <View style={styles.footer}>
          <Button label={busy ? "Moving…" : chosen ? "Confirm new time" : "Choose a session"} disabled={!chosen || busy} onPress={confirm} />
        </View>
      ) : null}
    </Phone>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 24 },
  lead: { color: colors.ink, lineHeight: 21 },
  dayTitle: { fontFamily: serif, fontSize: 22, fontWeight: "700", color: colors.ink, marginTop: 4 },
  empty: { color: colors.muted, lineHeight: 20 },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  selected: { borderColor: colors.pool, borderWidth: 2 },
  bar: { width: 6, alignSelf: "stretch" },
  body: { flex: 1, padding: 12, gap: 2 },
  time: { fontFamily: serif, fontSize: 20, fontWeight: "700", color: colors.ink },
  title: { fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted, fontSize: 13 },
  price: { fontWeight: "700", paddingRight: 12, color: colors.ink },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper },
});
