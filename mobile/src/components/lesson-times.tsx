import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, heading, strong } from "@/theme";
import type { Slot } from "@/types";

export function LengthButtons({
  options,
  selected,
  onSelect,
  locked = false,
}: {
  options: { minutes: number; priceLabel: string }[];
  selected: number | null;
  onSelect: (minutes: number) => void;
  locked?: boolean;
}) {
  const shown = locked ? options.filter((option) => option.minutes === selected) : options;
  return (
    <View style={styles.lengthRow}>
      {shown.map((option) => {
        const active = selected === option.minutes;
        return (
          <Pressable
            key={option.minutes}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: locked }}
            disabled={locked}
            onPress={() => onSelect(option.minutes)}
            style={[styles.lengthButton, active && styles.lengthButtonOn]}
          >
            <Text style={[styles.lengthTitle, active && styles.lengthTitleOn]}>{option.minutes} minutes</Text>
            <Text style={[styles.lengthPrice, active && styles.lengthTitleOn]}>{option.priceLabel}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TimeGrid({
  slots,
  onPress,
  currentId,
  selectedId,
}: {
  slots: Slot[];
  onPress: (slot: Slot) => void;
  currentId?: string | null;
  selectedId?: string | null;
}) {
  return (
    <View style={styles.grid}>
      {slots.map((slot) => {
        const current = slot.id === currentId;
        const picked = slot.id === selectedId;
        const open = slot.bookable && !current;
        return (
          <Pressable
            key={slot.id}
            accessibilityRole="button"
            accessibilityState={{ disabled: !open, selected: picked }}
            disabled={!open}
            onPress={() => onPress(slot)}
            style={[styles.cell, open && styles.cellOpen, slot.inBasket && styles.cellBasket, picked && styles.cellPicked, !open && styles.cellOff]}
          >
            <Text style={[styles.time, !open && styles.timeOff, picked && styles.timeOn]}>{slot.startTimeLabel}</Text>
            <Text style={[styles.cellMeta, open && styles.cellMetaOpen, picked && styles.timeOn]}>
              {current ? "Current" : picked ? "Selected" : slot.inBasket ? "In basket" : open ? slot.priceLabel : "Booked"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  lengthRow: { flexDirection: "row", gap: 10 },
  lengthButton: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 4,
  },
  lengthButtonOn: { backgroundColor: colors.atlantic, borderColor: colors.atlantic },
  lengthTitle: { fontFamily: heading, fontSize: 18, fontWeight: "700", color: colors.ink },
  lengthPrice: { fontFamily: strong, fontSize: 16, color: colors.atlantic },
  lengthTitleOn: { color: colors.white },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: {
    width: "31%",
    minWidth: 96,
    flexGrow: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
  },
  cellOpen: { backgroundColor: colors.white, borderColor: colors.line },
  cellBasket: { borderColor: colors.atlantic, backgroundColor: colors.seaGlass },
  cellPicked: { backgroundColor: colors.atlantic, borderColor: colors.atlantic },
  cellOff: { backgroundColor: colors.dayIdle, borderColor: colors.line },
  time: { fontFamily: heading, fontSize: 18, fontWeight: "700", color: colors.ink },
  timeOff: { color: colors.muted },
  timeOn: { color: colors.white },
  cellMeta: { fontSize: 13, fontWeight: "700", color: colors.muted },
  cellMetaOpen: { color: colors.atlantic },
});
