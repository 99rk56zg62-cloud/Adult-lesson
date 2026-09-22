import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, serif } from "@/theme";
import type { Slot } from "@/types";

export function SlotCard({ slot, onPress, selected = false }: { slot: Slot; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${slot.dayLabel} ${slot.timeLabel}, ${slot.title}, ${slot.priceLabel}, ${slot.partyLabel}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.selected, pressed && styles.pressed, !slot.bookable && styles.full]}
    >
      <View style={[styles.bar, { backgroundColor: colors.pool }]} />
      <View style={styles.body}>
        <Text style={styles.time}>{slot.timeLabel}</Text>
        <Text style={styles.title}>{slot.title}</Text>
        <Text style={styles.meta}>
          {slot.location} · {slot.instructor}
        </Text>
      </View>
      <View style={styles.side}>
        <Text style={styles.price}>{slot.priceLabel}</Text>
        <Text style={[styles.spots, slot.spotsLeft === 0 && styles.gone]}>{slot.bookable ? slot.partyLabel : "Booked"}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  selected: { borderColor: colors.pool, borderWidth: 2 },
  pressed: { opacity: 0.92 },
  full: { opacity: 0.62 },
  bar: { width: 6 },
  body: { flex: 1, paddingVertical: 14, paddingLeft: 12, paddingRight: 8, gap: 2 },
  time: { fontFamily: serif, fontSize: 18, fontWeight: "700", color: colors.ink },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  side: { alignItems: "flex-end", justifyContent: "center", paddingRight: 14, gap: 4 },
  price: { fontWeight: "700", color: colors.ink },
  spots: { color: colors.pool, fontSize: 12, fontWeight: "700" },
  scarce: { color: colors.warn },
  gone: { color: colors.muted },
});
