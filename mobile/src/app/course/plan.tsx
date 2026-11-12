import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { BOOKING_POLICY } from "@/brand";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { colors, heading } from "@/theme";
import type { CourseSuggestion, PlannedSession } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function CoursePlanScreen() {
  const params = useLocalSearchParams<{ days?: string; locationId?: string }>();
  const days = Number(one(params.days)) || 3;
  const locationId = one(params.locationId) || undefined;
  const [suggestions, setSuggestions] = useState<CourseSuggestion[]>([]);
  const [priceLabel, setPriceLabel] = useState("");
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [options, setOptions] = useState<PlannedSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const plan = await api.coursePlan(days, locationId);
        if (cancelled) return;
        setSuggestions(plan.suggestions);
        setPriceLabel(plan.priceLabel);
        setSessions(plan.suggestions[0]?.sessions ?? []);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days, locationId]);

  async function openChoices(index: number) {
    setEditing(index);
    setOptions([]);
    setError(null);
    try {
      const exclude = sessions.filter((_, item) => item !== index).map((session) => session.dateKey);
      const result = await api.courseDayOptions(locationId, exclude);
      setOptions(result.sessions);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.addCourseToBasket({
        days,
        locationId,
        sessions: sessions.map((session) => ({ dateKey: session.dateKey, hour: session.hour, minute: session.minute })),
      });
      router.push("/basket" as never);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar title={`${days}-day crash course`} subtitle="90 minutes each day. You can change any day." back />
      {loading ? <ActivityIndicator color={colors.pool} style={{ marginTop: 28 }} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {!loading && suggestions.length === 0 ? (
          <Text style={styles.note}>No {days}-day run fits in the next 6 weeks. Try fewer days, or ask the pool to open more mornings.</Text>
        ) : null}
        {suggestions.length > 1 ? (
          <View style={styles.block}>
            <Text style={styles.label}>Other ideas</Text>
            {suggestions.slice(1).map((suggestion) => (
              <Pressable
                key={suggestion.label}
                accessibilityRole="button"
                onPress={() => {
                  setSessions(suggestion.sessions);
                  setEditing(null);
                }}
                style={styles.alt}
              >
                <Text style={styles.altText}>{suggestion.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {sessions.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.label}>Your days</Text>
            <Text style={styles.note}>{suggestions[0] && sessions === suggestions[0].sessions ? "This is the next free run." : "You've changed the suggested days."}</Text>
            {sessions.map((session, index) => (
              <View key={`${session.dateKey}-${session.hour}-${session.minute}`} style={styles.day}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dayTitle}>{session.dayLabel}</Text>
                  <Text style={styles.note}>{session.timeLabel}</Text>
                </View>
                <Button label={editing === index ? "Choosing…" : "Change"} variant="secondary" onPress={() => void openChoices(index)} />
              </View>
            ))}
          </View>
        ) : null}
        {editing !== null ? (
          <View style={styles.block}>
            <Text style={styles.label}>Choose another day</Text>
            {options.length === 0 ? <Text style={styles.note}>Looking for free days…</Text> : null}
            {options.map((option) => (
              <Pressable
                key={`${option.dateKey}-${option.hour}-${option.minute}`}
                accessibilityRole="button"
                onPress={() => {
                  setSessions((current) => current.map((session, index) => (index === editing ? option : session)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
                  setEditing(null);
                }}
                style={styles.alt}
              >
                <Text style={styles.altText}>
                  {option.dayLabel} · {option.timeLabel}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.note}>{BOOKING_POLICY}</Text>
        {sessions.length === days ? (
          <Button label={busy ? "Adding…" : `Add course · ${priceLabel}`} disabled={busy} onPress={() => void add()} />
        ) : null}
      </ScrollView>
    </Phone>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  block: { gap: 8 },
  label: { fontFamily: heading, fontSize: 18, color: colors.ink },
  note: { color: colors.muted, lineHeight: 20 },
  day: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  dayTitle: { fontFamily: heading, fontSize: 18, color: colors.ink },
  alt: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12 },
  altText: { color: colors.ink, fontWeight: "600" },
});
