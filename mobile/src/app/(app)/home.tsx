import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { Banner, TopBar } from "@/components/ui";
import { colors, heading } from "@/theme";
import type { Location } from "@/types";

function money(label: string | undefined, fallback: string) {
  return (label ?? fallback).replace(/\.00$/, "");
}

export default function HomeScreen() {
  const { config } = useAuth();
  const { width } = useWindowDimensions();
  const sideBySide = width >= 760;
  const [location, setLocation] = useState<Location | null>(null);
  const [basketCount, setBasketCount] = useState(0);
  const [basketTotal, setBasketTotal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [places, basket] = await Promise.all([api.locations(), api.basket()]);
      const fareham = places.locations.find((item) => item.address.includes("153 West Street"));
      setLocation(fareham ?? places.locations[0] ?? null);
      setBasketCount(basket.items.length);
      setBasketTotal(basket.totalLabel);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const fromPrice = money(config?.coursePrices?.[0]?.priceLabel, "£249");
  const halfHour = money(config?.lessonPrices?.find((item) => item.durationMinutes === 30)?.priceLabel, "£30");
  const hour = money(config?.lessonPrices?.find((item) => item.durationMinutes === 60)?.priceLabel, "£60");

  return (
    <View style={styles.screen}>
      <TopBar title="Book a swim" subtitle="Pick one path. You can change your mind from the tabs below." />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        <View style={[styles.choices, sideBySide ? styles.choicesRow : styles.choicesStack]}>
          <ChoiceCard
            title="Book a crash course"
            subtitle={`2, 3, 4 or 5 days · from ${fromPrice} · learn fast`}
            icon="school"
            tone="navy"
            onPress={() => router.push("/courses" as never)}
          />
          <ChoiceCard
            title="Book weekly lessons"
            subtitle={`30 or 60 min 1-to-1 or 1-to-2 · ${halfHour} / ${hour}`}
            icon="calendar"
            tone="sand"
            onPress={() => router.push("/schedule" as never)}
          />
        </View>
        {location ? (
          <Pressable accessibilityRole="button" onPress={() => router.push("/arrival" as never)} style={styles.location}>
            <Ionicons name="location" size={22} color={colors.atlantic} />
            <View style={styles.locationText}>
              <Text style={styles.locationName}>{location.name}</Text>
              <Text style={styles.locationAddress}>{location.address}</Text>
            </View>
            <Text style={styles.locationLink}>Arrival</Text>
          </Pressable>
        ) : null}
        <Text style={styles.note}>
          Single lessons book up to 6 weeks ahead. Crash courses book up to 6 months ahead. You can move a session until 24 hours before it starts.
        </Text>
      </ScrollView>
      {basketCount > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/basket" as never)} style={styles.basketBar}>
          <Text style={styles.basketText}>
            {basketCount} in your basket · {basketTotal}
          </Text>
          <Text style={styles.basketText}>Review</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ChoiceCard({
  title,
  subtitle,
  icon,
  tone,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "navy" | "sand";
  onPress: () => void;
}) {
  const navy = tone === "navy";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.card, navy ? styles.cardNavy : styles.cardSand, pressed && styles.pressed]}
    >
      <View style={[styles.iconCircle, navy ? styles.iconSea : styles.iconRed]}>
        <Ionicons name={icon} size={40} color={navy ? colors.navy : colors.white} />
      </View>
      <Text style={[styles.cardTitle, { color: navy ? colors.white : colors.navy }]}>{title}</Text>
      <Text style={[styles.cardSub, { color: navy ? colors.seaGlass : colors.navy }]}>{subtitle}</Text>
      <View style={styles.cardAction}>
        <Text style={[styles.cardActionText, { color: navy ? colors.white : colors.red }]}>{navy ? "See the courses" : "Choose a date"}</Text>
        <Ionicons name="arrow-forward" size={18} color={navy ? colors.white : colors.red} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sand },
  content: { padding: 20, gap: 16, paddingBottom: 28 },
  choices: { gap: 14 },
  choicesStack: { flexDirection: "column" },
  choicesRow: { flexDirection: "row", alignItems: "stretch" },
  card: {
    flex: 1,
    minHeight: 230,
    borderRadius: 24,
    padding: 22,
    gap: 12,
    justifyContent: "space-between",
  },
  cardNavy: { backgroundColor: colors.navy },
  cardSand: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.navy },
  pressed: { opacity: 0.92 },
  iconCircle: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  iconSea: { backgroundColor: colors.seaGlass },
  iconRed: { backgroundColor: colors.red },
  cardTitle: { fontFamily: heading, fontSize: 28, lineHeight: 32 },
  cardSub: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  cardAction: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  cardActionText: { fontSize: 16, fontWeight: "700" },
  location: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  locationText: { flex: 1, gap: 2 },
  locationName: { fontFamily: heading, fontSize: 16, color: colors.navy },
  locationAddress: { color: colors.navy, fontSize: 14 },
  locationLink: { color: colors.atlantic, fontWeight: "700" },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  basketBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: colors.navy,
  },
  basketText: { color: colors.white, fontWeight: "700" },
});
