import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { BookingCalendar } from "@/components/booking-calendar";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { colors, levelColor, serif } from "@/theme";
import type { Booking, CourseRun, DayAvailability, Slot } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function RescheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [courses, setCourses] = useState<CourseRun[]>([]);
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isCourse = booking?.kind === "course";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextBooking = await api.booking(one(id));
        if (cancelled) return;
        setBooking(nextBooking.booking);
        if (nextBooking.booking.kind === "course") {
          const courseList = await api.courses({ days: nextBooking.booking.course?.days });
          if (cancelled) return;
          setCourses(courseList.courses.filter((course) => course.id !== nextBooking.booking.course?.id));
        } else {
          const schedule = await api.slots({
            locationId: nextBooking.booking.slot?.locationId,
            durationMinutes: nextBooking.booking.slot?.durationMinutes,
          });
          if (cancelled) return;
          setSlots(schedule.slots);
          setDays(schedule.days);
          const first =
            schedule.days.find((day) => day.selectable && day.dateKey !== nextBooking.booking.slot?.dateKey) ??
            schedule.days.find((day) => day.selectable);
          setSelectedDay(first?.dateKey ?? null);
          if (first) setMonthKey(first.dateKey.slice(0, 7));
        }
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const options = useMemo(
    () => slots.filter((slot) => slot.bookable && slot.id !== booking?.slot?.id && slot.dateKey === selectedDay),
    [slots, booking?.slot?.id, selectedDay],
  );
  const chosenSlot = options.find((slot) => slot.id === selected) ?? null;
  const chosenCourse = courses.find((course) => course.id === selected) ?? null;
  const dayMeta = days.find((day) => day.dateKey === selectedDay) ?? null;

  async function confirm() {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      const result = isCourse
        ? await api.reschedule(booking.id, { courseRunId: chosenCourse!.id })
        : await api.reschedule(booking.id, { slotId: chosenSlot!.id });
      router.replace(`/booking/${result.booking.id}`);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar tone="dark" title={isCourse ? "New course run" : "New time"} subtitle="You won't be charged again." back />
      {!booking && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 28 }} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {booking && !booking.rescheduleAllowed ? (
          <Banner tone="warn" text={booking.rescheduleBlockedReason ?? "This booking can't be changed."} />
        ) : null}
        {booking?.rescheduleAllowed && isCourse ? (
          <>
            <Text style={styles.lead}>
              Currently {booking.course?.dateSummary}, {booking.course?.dailyTimeLabel} daily.
            </Text>
            {courses.length === 0 ? <Text style={styles.empty}>No other open {booking.course?.days}-day runs right now.</Text> : null}
            {courses.map((course) => (
              <Pressable
                key={course.id}
                accessibilityRole="button"
                onPress={() => setSelected(course.id)}
                style={[styles.timeRow, selected === course.id && styles.selected]}
              >
                <View style={[styles.bar, { backgroundColor: levelColor(course.level) }]} />
                <View style={styles.body}>
                  <Text style={styles.time}>{course.dateSummary}</Text>
                  <Text style={styles.title}>{course.title}</Text>
                  <Text style={styles.meta}>
                    {course.dailyTimeLabel} daily · {course.spotsLabel}
                  </Text>
                </View>
                <Text style={styles.price}>{course.priceLabel}</Text>
              </Pressable>
            ))}
            {chosenCourse?.soon ? <Banner tone="warn" text="That run starts soon, so you won't be able to move it again." /> : null}
          </>
        ) : null}
        {booking?.rescheduleAllowed && !isCourse ? (
          <>
            <Text style={styles.lead}>
              Currently {booking.slot?.dayLabel}, {booking.slot?.timeLabel}.
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
            {chosenSlot?.soon ? <Banner tone="warn" text="That session starts soon, so you won't be able to rearrange it again." /> : null}
          </>
        ) : null}
      </ScrollView>
      {booking?.rescheduleAllowed ? (
        <View style={styles.footer}>
          <Button
            label={busy ? "Moving…" : isCourse ? (chosenCourse ? "Confirm new run" : "Choose a run") : chosenSlot ? "Confirm new time" : "Choose a session"}
            disabled={busy || (isCourse ? !chosenCourse : !chosenSlot)}
            onPress={confirm}
          />
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
