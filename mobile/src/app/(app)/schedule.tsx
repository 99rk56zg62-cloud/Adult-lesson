import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { SlotCard } from "@/components/slot-card";
import { Banner, Chip, TopBar } from "@/components/ui";
import { colors, serif } from "@/theme";
import type { Slot } from "@/types";

const LEVELS = ["All", "Beginners", "Improvers", "Confidence", "Technique"];

export default function ScheduleScreen() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [windowLabel, setWindowLabel] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [level, setLevel] = useState("All");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await api.slots();
      setSlots(result.slots);
      setWindowLabel(result.windowEndsLabel);
      setError(null);
      setWeek((current) => (current && result.slots.some((slot) => slot.weekKey === current) ? current : result.slots[0]?.weekKey ?? null));
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

  const weeks = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of slots) map.set(slot.weekKey, slot.weekLabel);
    return [...map.entries()];
  }, [slots]);

  const visible = slots.filter((slot) => slot.weekKey === week && (level === "All" || slot.level === level));
  const days = groupDays(visible);

  return (
    <View style={styles.screen}>
      <TopBar
        tone="dark"
        title="Book a lesson"
        subtitle={windowLabel ? `Sessions through ${windowLabel}. Times are UK (Europe/London).` : "Adult sessions, shown in UK time."}
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.pool} onRefresh={() => { setRefreshing(true); void load(true); }} />}
        contentContainerStyle={styles.content}
      >
        {error ? <Banner tone="danger" text={error} /> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {weeks.map(([key, label]) => (
            <Chip key={key} label={label} selected={key === week} onPress={() => setWeek(key)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {LEVELS.map((item) => (
            <Chip key={item} label={item} selected={item === level} onPress={() => setLevel(item)} />
          ))}
        </ScrollView>
        {loading && slots.length === 0 ? <ActivityIndicator color={colors.pool} style={{ marginTop: 24 }} /> : null}
        {!loading && days.length === 0 ? <Text style={styles.empty}>Nothing in this week for that filter.</Text> : null}
        {days.map((day) => (
          <View key={day.dateKey} style={styles.day}>
            <Text style={styles.dayTitle}>{day.label}</Text>
            {day.slots.map((slot) => (
              <SlotCard key={slot.id} slot={slot} onPress={() => router.push(`/slot/${slot.id}`)} />
            ))}
          </View>
        ))}
        <Text style={styles.note}>You can book up to 6 weeks ahead. A paid lesson can be rearranged until 24 hours before it starts.</Text>
      </ScrollView>
    </View>
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
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: 28, gap: 8 },
  chips: { paddingHorizontal: 20, gap: 8, paddingVertical: 6 },
  day: { paddingHorizontal: 20, gap: 10, marginTop: 8 },
  dayTitle: { fontFamily: serif, fontSize: 20, fontWeight: "700", color: colors.ink, marginTop: 8 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 28, paddingHorizontal: 24 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18, paddingHorizontal: 20, marginTop: 18 },
});
