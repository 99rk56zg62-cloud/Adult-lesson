import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { BookingCalendar } from "@/components/booking-calendar";
import { LengthButtons, TimeGrid } from "@/components/lesson-times";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { colors, heading } from "@/theme";
import type { Booking, DayAvailability, PlannedSession, Slot } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function RescheduleScreen() {
  const params = useLocalSearchParams<{ id: string; session?: string }>();
  const id = params.id;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [courseOptions, setCourseOptions] = useState<PlannedSession[]>([]);
  const [courseSessionId, setCourseSessionId] = useState<string | null>(one(params.session) || null);
  const [courseChoice, setCourseChoice] = useState<PlannedSession | null>(null);
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
          const sessionId = one(params.session) || nextBooking.booking.course?.sessions.find((session) => session.movable)?.id || null;
          setCourseSessionId(sessionId);
          const exclude = (nextBooking.booking.course?.sessions ?? [])
            .filter((session) => session.id !== sessionId)
            .map((session) => session.dateKey);
          const options = await api.courseDayOptions(nextBooking.booking.course?.locationId, exclude);
          if (cancelled) return;
          setCourseOptions(options.sessions);
        } else {
          const schedule = await api.slots({
            locationId: nextBooking.booking.slot?.locationId,
            durationMinutes: nextBooking.booking.slot?.durationMinutes,
            partySize: nextBooking.booking.slot?.capacity === 2 ? 2 : 1,
            excludeBookingId: nextBooking.booking.id,
          });
          if (cancelled) return;
          setSlots(schedule.slots);
          setDays(schedule.days);
          const currentDay = nextBooking.booking.slot?.dateKey;
          if (currentDay && schedule.days.some((day) => day.dateKey === currentDay)) setMonthKey(currentDay.slice(0, 7));
        }
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, params.session]);

  const options = useMemo(
    () => slots.filter((slot) => slot.dateKey === selectedDay).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [slots, selectedDay],
  );
  const chosenSlot = options.find((slot) => slot.id === selected) ?? null;
  const dayMeta = days.find((day) => day.dateKey === selectedDay) ?? null;

  async function confirm() {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      const result = isCourse
        ? await api.rescheduleSession(booking.id, courseSessionId!, {
            dateKey: courseChoice!.dateKey,
            hour: courseChoice!.hour,
            minute: courseChoice!.minute,
          })
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
      <TopBar title={isCourse ? "Move a day" : "New time"} subtitle="You won't be charged again." back />
      {!booking && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 28 }} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {booking && !booking.rescheduleAllowed ? (
          <Banner tone="warn" text={booking.rescheduleBlockedReason ?? "This booking can't be changed."} />
        ) : null}
        {booking?.rescheduleAllowed && isCourse ? (
          <>
            <Text style={styles.lead}>
              Moving {booking.course?.sessions.find((session) => session.id === courseSessionId)?.dayLabel ?? "a day"}. The other days stay as they are.
            </Text>
            {booking.course?.sessions.map((session) => (
              <Text key={session.id} style={styles.empty}>
                {session.dayLabel}, {session.timeLabel}
                {session.movable ? "" : ` — ${session.moveBlockedReason}`}
              </Text>
            ))}
            {courseOptions.map((option) => {
              const picked = courseChoice?.dateKey === option.dateKey && courseChoice.hour === option.hour && courseChoice.minute === option.minute;
              return (
                <Pressable
                  key={`${option.dateKey}-${option.hour}-${option.minute}`}
                  accessibilityRole="button"
                  onPress={() => setCourseChoice(option)}
                  style={[styles.timeRow, picked && styles.selected]}
                >
                  <View style={styles.body}>
                    <Text style={styles.time}>{option.dayLabel}</Text>
                    <Text style={styles.meta}>{option.timeLabel}</Text>
                  </View>
                </Pressable>
              );
            })}
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
            {selectedDay ? (
              <>
                <Text style={styles.dayTitle}>{dayMeta?.dayLabel}</Text>
                <Text style={styles.filterLabel}>Lesson length</Text>
                <LengthButtons
                  locked
                  options={[{ minutes: booking.slot?.durationMinutes ?? 60, priceLabel: booking.slot?.priceLabel ?? "" }]}
                  selected={booking.slot?.durationMinutes ?? null}
                  onSelect={() => {}}
                />
                <Text style={styles.empty}>This lesson stays the same length. Grey times are already taken.</Text>
                {options.length === 0 ? <Text style={styles.empty}>No starts of this length fit in the window.</Text> : null}
                <TimeGrid
                  slots={options}
                  currentId={booking.slot?.id}
                  selectedId={selected}
                  onPress={(slot) => setSelected(slot.id)}
                />
              </>
            ) : (
              <Text style={styles.empty}>Choose a highlighted date.</Text>
            )}
            {chosenSlot?.soon ? <Banner tone="warn" text="That session starts soon, so you won't be able to rearrange it again." /> : null}
          </>
        ) : null}
      </ScrollView>
      {booking?.rescheduleAllowed ? (
        <View style={styles.footer}>
          <Button
            label={busy ? "Moving…" : isCourse ? (courseChoice ? "Confirm new day" : "Choose a day") : chosenSlot ? "Confirm new time" : "Choose a session"}
            disabled={busy || (isCourse ? !courseChoice || !courseSessionId : !chosenSlot)}
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
  dayTitle: { fontFamily: heading, fontSize: 22, fontWeight: "700", color: colors.ink, marginTop: 4 },
  filterLabel: { fontWeight: "700", color: colors.ink, fontSize: 13 },
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
  time: { fontFamily: heading, fontSize: 20, fontWeight: "700", color: colors.ink },
  title: { fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted, fontSize: 13 },
  price: { fontWeight: "700", paddingRight: 12, color: colors.ink },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.paper },
});
