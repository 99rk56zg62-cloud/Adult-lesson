import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, serif } from "@/theme";
import type { DayAvailability } from "@/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type MonthCell = {
  dateKey: string;
  dayOfMonth: number;
  inMonth: boolean;
  day: DayAvailability | null;
};

export function buildMonthGrid(monthKey: string, days: DayAvailability[]): MonthCell[] {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year!, month! - 1, 1));
  // Luxon weekday: Mon=1 … Sun=7. JS getUTCDay: Sun=0 … Sat=6.
  const jsWeekday = first.getUTCDay();
  const mondayIndex = jsWeekday === 0 ? 6 : jsWeekday - 1;
  const daysInMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const byKey = new Map(days.map((day) => [day.dateKey, day]));
  const cells: MonthCell[] = [];
  for (let i = 0; i < mondayIndex; i += 1) {
    cells.push({ dateKey: `pad-start-${i}`, dayOfMonth: 0, inMonth: false, day: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    cells.push({
      dateKey,
      dayOfMonth: day,
      inMonth: true,
      day: byKey.get(dateKey) ?? null,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ dateKey: `pad-end-${cells.length}`, dayOfMonth: 0, inMonth: false, day: null });
  }
  return cells;
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, 1));
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function BookingCalendar({
  monthKey,
  days,
  selected,
  onSelect,
  onMonthChange,
}: {
  monthKey: string;
  days: DayAvailability[];
  selected: string | null;
  onSelect: (dateKey: string) => void;
  onMonthChange: (monthKey: string) => void;
}) {
  const cells = buildMonthGrid(monthKey, days);
  return (
    <View style={styles.wrap}>
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" onPress={() => onMonthChange(shiftMonth(monthKey, -1))} style={styles.navBtn}>
          <Text style={styles.navText}>Earlier</Text>
        </Pressable>
        <Text style={styles.month}>{monthLabel(monthKey)}</Text>
        <Pressable accessibilityRole="button" onPress={() => onMonthChange(shiftMonth(monthKey, 1))} style={styles.navBtn}>
          <Text style={styles.navText}>Later</Text>
        </Pressable>
      </View>
      <View style={styles.weekdays}>
        {WEEKDAYS.map((label) => (
          <Text key={label} style={styles.weekday}>
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((cell) => {
          if (!cell.inMonth) return <View key={cell.dateKey} style={styles.cell} />;
          const selectable = Boolean(cell.day?.selectable);
          const selectedDay = selected === cell.dateKey;
          const hasSessions = Boolean(cell.day && cell.day.totalCount > 0);
          return (
            <Pressable
              key={cell.dateKey}
              accessibilityRole="button"
              accessibilityState={{ disabled: !selectable, selected: selectedDay }}
              disabled={!selectable}
              onPress={() => onSelect(cell.dateKey)}
              style={[
                styles.cell,
                styles.day,
                hasSessions && !selectable && styles.full,
                selectable && styles.open,
                selectedDay && styles.selected,
              ]}
            >
              <Text style={[styles.dayNum, !selectable && styles.muted, selectedDay && styles.selectedText]}>{cell.dayOfMonth}</Text>
              {selectable ? <View style={[styles.dot, selectedDay && styles.dotOn]} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>Open dates are highlighted. Grey dates are full or have no places left.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  navText: { color: colors.pool, fontWeight: "700" },
  month: { fontFamily: serif, fontSize: 20, fontWeight: "700", color: colors.ink },
  weekdays: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", color: colors.muted, fontSize: 12, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.2857%" as const, aspectRatio: 1, padding: 2 },
  day: { borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F3EEE4" },
  open: { backgroundColor: "#E7F2F0" },
  full: { backgroundColor: "#EFE8DC", opacity: 0.55 },
  selected: { backgroundColor: colors.deep },
  dayNum: { fontWeight: "700", color: colors.ink },
  muted: { color: colors.muted },
  selectedText: { color: colors.white },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.pool, marginTop: 3 },
  dotOn: { backgroundColor: colors.sand },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
});
