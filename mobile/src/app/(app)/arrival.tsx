import { useFocusEffect } from "expo-router";
import { createElement, useCallback, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { ContactButtons, defaultContact } from "@/components/contact-buttons";
import { Banner, Button, TopBar } from "@/components/ui";
import { colors, heading } from "@/theme";
import type { Location } from "@/types";

function mapsUrl(location: Location): string {
  const query = encodeURIComponent(`${location.name}, ${location.address}`);
  if (location.latitude != null && location.longitude != null) {
    const coords = `${location.latitude},${location.longitude}`;
    if (Platform.OS === "ios") return `http://maps.apple.com/?daddr=${coords}&q=${query}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${coords}`;
  }
  if (Platform.OS === "ios") return `http://maps.apple.com/?daddr=${query}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${query}`;
}

function embedUrl(location: Location): string | null {
  if (location.latitude == null || location.longitude == null) return null;
  const pad = 0.004;
  const { latitude: lat, longitude: lng } = location;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - pad}%2C${lat - pad}%2C${lng + pad}%2C${lat + pad}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export default function ArrivalScreen() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState(defaultContact);

  const load = useCallback(async () => {
    try {
      const [result, pages] = await Promise.all([api.locations(), api.pages()]);
      setLocations(result.locations);
      setContact({ contactEmail: pages.contactEmail, contactPhone: pages.contactPhone, contactTel: pages.contactTel });
      setSelectedId((current) => current ?? result.locations[0]?.id ?? null);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const location = locations.find((item) => item.id === selectedId) ?? locations[0] ?? null;
  const map = location ? embedUrl(location) : null;
  const steps = (location?.arrivalInstructions ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <View style={styles.screen}>
      <TopBar title="Location & arrival" subtitle="How to find the pool and what to do when you get there." />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {loading && !location ? <ActivityIndicator color={colors.pool} style={{ marginTop: 24 }} /> : null}
        {locations.length > 1 ? (
          <View style={styles.chips}>
            {locations.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => setSelectedId(item.id)}
                style={[styles.chip, item.id === location?.id && styles.chipOn]}
              >
                <Text style={[styles.chipText, item.id === location?.id && styles.chipTextOn]}>{item.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {location ? (
          <>
            <Text style={styles.name}>{location.name}</Text>
            <Text style={styles.address}>{location.address}</Text>
            {map ? (
              <View style={styles.mapFrame}>
                {Platform.OS === "web"
                  ? createElement("iframe", {
                      title: `Map of ${location.name}`,
                      src: map,
                      style: { border: 0, width: "100%", height: "100%" },
                    })
                  : <Text style={styles.address}>Open the map for directions.</Text>}
              </View>
            ) : null}
            <Button label="Open in Maps" onPress={() => void Linking.openURL(mapsUrl(location))} />
            <ContactButtons email={contact.contactEmail} phone={contact.contactPhone} tel={contact.contactTel} />
            <Text style={styles.heading}>When you arrive</Text>
            {steps.map((step) => (
              <Text key={step} style={styles.step}>
                {step}
              </Text>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 12, paddingBottom: 32 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, backgroundColor: colors.seaGlass, paddingHorizontal: 12, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.atlantic },
  chipText: { color: colors.navy, fontWeight: "700" },
  chipTextOn: { color: colors.white },
  name: { fontFamily: heading, fontSize: 26, color: colors.ink },
  address: { color: colors.ink, lineHeight: 22, fontSize: 16 },
  mapFrame: { height: 220, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  heading: { fontFamily: heading, fontSize: 22, color: colors.ink, marginTop: 8 },
  step: { color: colors.ink, lineHeight: 22, fontSize: 16, backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.line },
});
