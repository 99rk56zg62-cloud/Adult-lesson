import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { SlotCard } from "@/components/slot-card";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { colors, serif } from "@/theme";
import type { Booking, Slot } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function RescheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
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
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const options = useMemo(
    () => slots.filter((slot) => slot.bookable && slot.id !== booking?.slot.id),
    [slots, booking?.slot.id],
  );
  const chosen = options.find((slot) => slot.id === selected) ?? null;

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
        {booking && !booking.rescheduleAllowed ? <Banner tone="warn" text={booking.rescheduleBlockedReason ?? "This lesson can't be rearranged."} /> : null}
        {booking?.rescheduleAllowed ? (
          <>
            <Text style={styles.lead}>Currently {booking.slot.dayLabel}, {booking.slot.timeLabel}.</Text>
            {options.length === 0 ? <Text style={styles.empty}>No other sessions are open in the next 6 weeks.</Text> : null}
            {groupDays(options).map((day) => (
              <View key={day.dateKey} style={styles.day}>
                <Text style={styles.dayTitle}>{day.label}</Text>
                {day.slots.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} selected={slot.id === selected} onPress={() => setSelected(slot.id)} />
                ))}
              </View>
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

function groupDays(slots: Slot[]) {
  const days: { dateKey: string; label: string; slots: Slot[] }[] = [];
  for (const slot of slots) {
    const last = days[days.length - 1];
    if (!last || last.dateKey !== slot.dateKey) days.push({ dateKey: slot.dateKey, label: slot.dayLabel, slots: [slot] });
    else last.slots.push(slot);
  }
  return days;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 24 },
  lead: { color: colors.ink, lineHeight: 21 },
  empty: { color: colors.muted, lineHeight: 20 },
  day: { gap: 10 },
  dayTitle: { fontFamily: serif, fontSize: 20, fontWeight: "700", color: colors.ink, marginTop: 6 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper },
});
