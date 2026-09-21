import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { Banner, Button, Phone } from "@/components/ui";
import { clearPending, loadPending } from "@/storage";
import { colors, serif } from "@/theme";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function PaymentSuccessScreen() {
  const params = useLocalSearchParams<{ session_id?: string; booking_id?: string }>();
  const { ready, user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const pending = await loadPending();
        const sessionId = one(params.session_id) ?? pending?.sessionId;
        const bookingId = one(params.booking_id) ?? pending?.bookingId;
        if (sessionId) {
          const result = await api.confirm(sessionId);
          await clearPending();
          if (!cancelled) router.replace(`/booking/${result.booking.id}`);
          return;
        }
        if (bookingId) {
          const current = await api.booking(bookingId);
          if (!cancelled) router.replace(`/booking/${current.booking.id}`);
          return;
        }
        if (!cancelled) setError("We couldn't tell which payment this was. Check My lessons.");
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, params.session_id, params.booking_id]);

  return (
    <Phone>
      <View style={styles.center}>
        <Text style={styles.word}>Lido</Text>
        {error ? (
          <>
            <Banner tone="danger" text={error} />
            <Button label="My lessons" onPress={() => router.replace("/bookings")} />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.sand} />
            <Text style={styles.note}>Confirming your payment…</Text>
          </>
        )}
      </View>
    </Phone>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.deep, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  word: { fontFamily: serif, fontSize: 48, color: colors.white, fontWeight: "700" },
  note: { color: "#D7E6E4" },
});
