import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { BookingCalendar } from "@/components/booking-calendar";
import { LengthButtons, TimeGrid } from "@/components/lesson-times";
import { Banner, TopBar } from "@/components/ui";
import { colors, heading, strong } from "@/theme";
import type { DayAvailability, Location, Slot } from "@/types";

export default function ScheduleScreen() {
  const { config } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [partySize, setPartySize] = useState<number>(1);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [windowLabel, setWindowLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [basketTotal, setBasketTotal] = useState<string | null>(null);
  const [basketCount, setBasketCount] = useState(0);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [locationResult, schedule, basket] = await Promise.all([
        api.locations(),
        api.slots({ locationId: locationId ?? undefined }),
        api.basket(),
      ]);
      setBasketCount(basket.items.length);
      setBasketTotal(basket.totalLabel);
      setLocations(locationResult.locations);
      setLocationId((current) => {
        if (current && locationResult.locations.some((location) => location.id === current)) return current;
        const fareham = locationResult.locations.find((location) => location.address.includes("153 West Street"));
        return (fareham ?? locationResult.locations[0])?.id ?? null;
      });
      setSlots(schedule.slots);
      setDays(schedule.days);
      setWindowLabel(schedule.windowEndsLabel);
      setError(null);
      setSelected((current) => (current && schedule.days.some((day) => day.dateKey === current && day.selectable) ? current : null));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [locationId]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const daySlots = useMemo(
    () =>
      durationMinutes == null
        ? []
        : slots
            .filter((slot) => slot.dateKey === selected && slot.durationMinutes === durationMinutes && slot.capacity === partySize)
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [slots, selected, durationMinutes, partySize],
  );
  const selectedDay = days.find((day) => day.dateKey === selected) ?? null;
  const showLocationFilter = locations.length > 1;
  const lessonDurations = config?.lessonDurations ?? [30, 60];

  return (
    <View style={styles.screen}>
      <TopBar
        title="Book a lesson"
        subtitle={windowLabel ? `Choose a date, then a lesson length. Sessions through ${windowLabel}. UK time.` : "Choose a date, then a lesson length."}
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
        {loading && slots.length === 0 ? (
          <ActivityIndicator color={colors.pool} style={{ marginTop: 24 }} />
        ) : null}

        {showLocationFilter ? (
          <View style={styles.filterBlock}>
            <Text style={styles.filterLabel}>Location</Text>
            <View style={styles.chips}>
              {locations.map((location) => (
                <Chip
                  key={location.id}
                  label={location.name}
                  selected={locationId === location.id}
                  onPress={() => setLocationId(location.id)}
                />
              ))}
            </View>
          </View>
        ) : locations[0] ? (
          <View>
            <Text style={styles.filterLabel}>{locations[0].name}</Text>
            <Text style={styles.singleLocation}>{locations[0].address}</Text>
          </View>
        ) : null}

        <BookingCalendar
          monthKey={monthKey}
          days={days}
          selected={selected}
          onSelect={setSelected}
          onMonthChange={setMonthKey}
        />
        {selectedDay ? (
          <View style={styles.dayBlock}>
            <Text style={styles.dayTitle}>{selectedDay.dayLabel}</Text>
            <Text style={styles.daySub}>
              {slots.find((slot) => slot.dateKey === selected)?.windowLabel
                ? `Available ${slots.find((slot) => slot.dateKey === selected)?.windowLabel}.`
                : "Choose how long the lesson should be."}
            </Text>
            <Text style={styles.filterLabel}>Lesson length</Text>
            <LengthButtons
              options={lessonDurations.map((minutes) => ({
                minutes,
                priceLabel: config?.lessonPrices?.find((item) => item.durationMinutes === minutes)?.priceLabel ?? "",
              }))}
              selected={durationMinutes}
              onSelect={setDurationMinutes}
            />
            <Text style={styles.filterLabel}>Session</Text>
            <View style={styles.chips}>
              <Chip label="1-to-1" selected={partySize === 1} onPress={() => setPartySize(1)} />
              <Chip label="1-to-2" selected={partySize === 2} onPress={() => setPartySize(2)} />
            </View>
            {durationMinutes != null ? (
              <>
                <Text style={styles.daySub}>
                  {daySlots.some((slot) => !slot.bookable) ? "Grey times are already taken." : "Every start below is free."}
                </Text>
                {daySlots.length === 0 ? <Text style={styles.empty}>No starts of this length fit in the window.</Text> : null}
                <TimeGrid
                  slots={daySlots}
                  onPress={(slot) => {
                    void (slot.inBasket ? api.removeFromBasket(slot.id) : api.addToBasket(slot.id)).then(() => load(true));
                  }}
                />
              </>
            ) : (
              <Text style={styles.daySub}>Choose 30 or 60 minutes to see the start times.</Text>
            )}
          </View>
        ) : (
          <Text style={styles.empty}>Choose a highlighted date. Grey dates have nothing free.</Text>
        )}

        <View style={styles.courseBlock}>
          <Text style={styles.sectionTitle}>Crash courses</Text>
          <Text style={styles.sectionSub}>
            {config?.courseDailyMinutes ?? 90} minutes each day. We'll suggest the next free mornings, and you can change any day.
          </Text>
          {(config?.coursePrices ?? [
            { days: 3, priceLabel: "£349.00" },
            { days: 4, priceLabel: "£449.00" },
            { days: 5, priceLabel: "£549.00" },
          ]).map((course) => (
            <Pressable
              key={course.days}
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/course/plan", params: { days: String(course.days), locationId: locationId ?? "" } } as never)
              }
              style={styles.timeRow}
            >
              <View style={[styles.bar, { backgroundColor: colors.pool }]} />
              <View style={styles.timeBody}>
                <Text style={styles.time}>{course.days}-day course</Text>
                <Text style={styles.meta}>90 minutes each day</Text>
              </View>
              <View style={styles.side}>
                <Text style={styles.price}>{course.priceLabel}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.note}>
          Single lessons can be booked up to 6 weeks ahead and rearranged until 24 hours before they start. Each day of a crash course can be moved until 24 hours before that day.
        </Text>
      </ScrollView>
      {basketCount > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/basket" as never)} style={styles.basketBar}>
          <Text style={styles.basketText}>
            {basketCount} lesson{basketCount === 1 ? "" : "s"} · {basketTotal}
          </Text>
          <Text style={styles.basketText}>Review</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  filterBlock: { gap: 8 },
  filterLabel: { fontWeight: "700", color: colors.ink, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.seaGlass,
    backgroundColor: colors.seaGlass,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.atlantic, borderColor: colors.atlantic },
  chipText: { fontFamily: strong, color: colors.navy },
  chipTextSelected: { color: colors.white },
  singleLocation: { color: colors.muted, fontSize: 14 },
  dayBlock: { gap: 10 },
  dayTitle: { fontFamily: heading, fontSize: 24, fontWeight: "700", color: colors.ink },
  daySub: { color: colors.muted, marginTop: -4 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 12 },
  courseBlock: { gap: 10, marginTop: 8 },
  sectionTitle: { fontFamily: heading, fontSize: 24, fontWeight: "700", color: colors.ink },
  sectionSub: { color: colors.muted, lineHeight: 20, marginTop: -4 },
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
  time: { fontFamily: heading, fontSize: 22, fontWeight: "700", color: colors.ink },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted, fontSize: 13 },
  side: { alignItems: "flex-end", justifyContent: "center", paddingRight: 14, gap: 4, maxWidth: 120 },
  price: { fontWeight: "700", color: colors.ink },
  spots: { color: colors.pool, fontSize: 12, fontWeight: "700", textAlign: "right" },
  gone: { color: colors.muted },
  basketBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: colors.navy,
  },
  basketText: { color: colors.white, fontWeight: "700" },
});
