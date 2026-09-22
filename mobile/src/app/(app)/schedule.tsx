import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { BookingCalendar } from "@/components/booking-calendar";
import { Banner, TopBar } from "@/components/ui";
import { colors, levelColor, serif } from "@/theme";
import type { CourseRun, DayAvailability, Location, Slot } from "@/types";

export default function ScheduleScreen() {
  const { config } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [courses, setCourses] = useState<CourseRun[]>([]);
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
      const [locationResult, schedule, courseResult] = await Promise.all([
        api.locations(),
        api.slots({ locationId: locationId ?? undefined, durationMinutes }),
        api.courses({ locationId: locationId ?? undefined }),
      ]);
      setLocations(locationResult.locations);
      setLocationId((current) => {
        if (current && locationResult.locations.some((location) => location.id === current)) return current;
        return locationResult.locations.length > 1 ? locationResult.locations[0]!.id : null;
      });
      setSlots(schedule.slots);
      setCourses(courseResult.courses);
      setDays(schedule.days);
      setWindowLabel(schedule.windowEndsLabel);
      setError(null);
      setSelected((current) => {
        if (current && schedule.days.some((day) => day.dateKey === current && day.selectable)) return current;
        const next = schedule.days.find((day) => day.selectable)?.dateKey ?? null;
        if (next) setMonthKey((month) => (current ? month : next.slice(0, 7)));
        return next;
      });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [durationMinutes, locationId]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const daySlots = useMemo(() => slots.filter((slot) => slot.dateKey === selected), [slots, selected]);
  const selectedDay = days.find((day) => day.dateKey === selected) ?? null;
  const showLocationFilter = locations.length > 1;
  const lessonDurations = config?.lessonDurations ?? [30, 60];

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
        {loading && slots.length === 0 && courses.length === 0 ? (
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
          <Text style={styles.singleLocation}>{locations[0].name}</Text>
        ) : null}

        <View style={styles.filterBlock}>
          <Text style={styles.filterLabel}>Lesson length</Text>
          <View style={styles.chips}>
            {lessonDurations.map((minutes) => (
              <Chip
                key={minutes}
                label={`${minutes} min`}
                selected={durationMinutes === minutes}
                onPress={() => setDurationMinutes(minutes)}
              />
            ))}
          </View>
        </View>

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
          <Text style={styles.empty}>No open dates in the next 6 weeks for this length.</Text>
        )}

        {courses.length > 0 ? (
          <View style={styles.courseBlock}>
            <Text style={styles.sectionTitle}>Crash courses</Text>
            <Text style={styles.sectionSub}>
              {config?.courseDailyMinutes ?? 90} minutes each morning ({config?.courseMorningWindow.startHour ?? 6}:00–
              {config?.courseMorningWindow.endHour ?? 9}:00 UK). Book the whole run.
            </Text>
            {courses.map((course) => (
              <CourseRow
                key={course.id}
                course={course}
                onPress={() => course.bookable && router.push({ pathname: "/course/[id]", params: { id: course.id } })}
              />
            ))}
          </View>
        ) : null}

        <Text style={styles.note}>
          Single lessons can be booked up to 6 weeks ahead and rearranged until 24 hours before they start. Crash courses lock the same way — until 24 hours before day one.
        </Text>
      </ScrollView>
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
          {slot.durationMinutes} min · {slot.instructor}
        </Text>
      </View>
      <View style={styles.side}>
        <Text style={styles.price}>{slot.priceLabel}</Text>
        <Text style={[styles.spots, !slot.bookable && styles.gone]}>{slot.bookable ? slot.spotsLabel : slot.unavailableReason ?? "Unavailable"}</Text>
      </View>
    </Pressable>
  );
}

function CourseRow({ course, onPress }: { course: CourseRun; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!course.bookable}
      onPress={onPress}
      style={[styles.timeRow, !course.bookable && styles.timeDisabled]}
    >
      <View style={[styles.bar, { backgroundColor: levelColor(course.level) }]} />
      <View style={styles.timeBody}>
        <Text style={styles.time}>{course.days}-day course</Text>
        <Text style={styles.title}>{course.title}</Text>
        <Text style={styles.meta}>
          {course.dateSummary} · {course.dailyTimeLabel} daily
        </Text>
      </View>
      <View style={styles.side}>
        <Text style={styles.price}>{course.priceLabel}</Text>
        <Text style={[styles.spots, !course.bookable && styles.gone]}>
          {course.bookable ? course.spotsLabel : course.unavailableReason ?? "Unavailable"}
        </Text>
      </View>
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
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.pool, borderColor: colors.pool },
  chipText: { color: colors.ink, fontWeight: "600" },
  chipTextSelected: { color: colors.white },
  singleLocation: { color: colors.muted, fontSize: 14 },
  dayBlock: { gap: 10 },
  dayTitle: { fontFamily: serif, fontSize: 24, fontWeight: "700", color: colors.ink },
  daySub: { color: colors.muted, marginTop: -4 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 12 },
  courseBlock: { gap: 10, marginTop: 8 },
  sectionTitle: { fontFamily: serif, fontSize: 24, fontWeight: "700", color: colors.ink },
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
  time: { fontFamily: serif, fontSize: 22, fontWeight: "700", color: colors.ink },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted, fontSize: 13 },
  side: { alignItems: "flex-end", justifyContent: "center", paddingRight: 14, gap: 4, maxWidth: 120 },
  price: { fontWeight: "700", color: colors.ink },
  spots: { color: colors.pool, fontSize: 12, fontWeight: "700", textAlign: "right" },
  gone: { color: colors.muted },
});
