import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { BookingCalendar } from "@/components/booking-calendar";
import { Banner, TopBar } from "@/components/ui";
import { colors, levelColor, serif } from "@/theme";
import type { DayAvailability, Slot } from "@/types";

export default function ScheduleScreen() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [windowLabel, setWindowLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await api.slots();
      setSlots(result.slots);
      setDays(result.days);
      setWindowLabel(result.windowEndsLabel);
      setError(null);
      setSelected((current) => {
        if (current && result.days.some((day) => day.dateKey === current && day.selectable)) return current;
        const next = result.days.find((day) => day.selectable)?.dateKey ?? null;
        if (next) setMonthKey((month) => (current ? month : next.slice(0, 7)));
        return next;
      });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const daySlots = useMemo(() => slots.filter((slot) => slot.dateKey === selected), [slots, selected]);
  const selectedDay = days.find((day) => day.dateKey === selected) ?? null;

  return (
    <View style={styles.screen}>
      <TopBar
        tone="dark"
        title="Book a lesson"
        subtitle={windowLabel ? `Pick a date, then a time. Sessions through ${windowLabel}. UK time.` : "Pick a date, then a time."}
      />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.pool}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
          />
        }
        contentContainerStyle={styles.content}
      >
        {error ? <Banner tone="danger" text={error} /> : null}
        {loading && slots.length === 0 ? <ActivityIndicator color={colors.pool} style={{ marginTop: 24 }} /> : null}
        <BookingCalendar
          monthKey={monthKey}
          days={days}
          selected={selected}
          onSelect={setSelected}
          onMonthChange={(next) => {
            setMonthKey(next);
            const inMonth = days.find((day) => day.dateKey.startsWith(next) && day.selectable);
            if (inMonth) setSelected(inMonth.dateKey);
          }}
        />
        {selectedDay ? (
          <View style={styles.dayBlock}>
            <Text style={styles.dayTitle}>{selectedDay.dayLabel}</Text>
            <Text style={styles.daySub}>
              {selectedDay.openCount === 0
                ? "No open places on this day."
                : selectedDay.openCount === 1
                  ? "1 time available"
                  : `${selectedDay.openCount} times available`}
            </Text>
            {daySlots.map((slot) => (
              <TimeRow key={slot.id} slot={slot} onPress={() => slot.bookable && router.push(`/slot/${slot.id}`)} />
            ))}
          </View>
        ) : (
          <Text style={styles.empty}>No open dates in the next 6 weeks.</Text>
        )}
        <Text style={styles.note}>You can book up to 6 weeks ahead. A paid lesson can be rearranged until 24 hours before it starts.</Text>
      </ScrollView>
    </View>
  );
}

function TimeRow({ slot, onPress }: { slot: Slot; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!slot.bookable}
      onPress={onPress}
      style={[styles.timeRow, !slot.bookable && styles.timeDisabled]}
    >
      <View style={[styles.bar, { backgroundColor: levelColor(slot.level) }]} />
      <View style={styles.timeBody}>
        <Text style={styles.time}>{slot.startTimeLabel}</Text>
        <Text style={styles.title}>{slot.title}</Text>
        <Text style={styles.meta}>
          {slot.location} · {slot.instructor}
        </Text>
      </View>
      <View style={styles.side}>
        <Text style={styles.price}>{slot.priceLabel}</Text>
        <Text style={[styles.spots, !slot.bookable && styles.gone]}>{slot.bookable ? slot.spotsLabel : slot.unavailableReason ?? "Unavailable"}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  dayBlock: { gap: 10 },
  dayTitle: { fontFamily: serif, fontSize: 24, fontWeight: "700", color: colors.ink },
  daySub: { color: colors.muted, marginTop: -4 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 12 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  timeRow: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  timeDisabled: { opacity: 0.55 },
  bar: { width: 6 },
  timeBody: { flex: 1, paddingVertical: 14, paddingLeft: 12, paddingRight: 8, gap: 2 },
  time: { fontFamily: serif, fontSize: 22, fontWeight: "700", color: colors.ink },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted, fontSize: 13 },
  side: { alignItems: "flex-end", justifyContent: "center", paddingRight: 14, gap: 4, maxWidth: 120 },
  price: { fontWeight: "700", color: colors.ink },
  spots: { color: colors.pool, fontSize: 12, fontWeight: "700", textAlign: "right" },
  gone: { color: colors.muted },
});
