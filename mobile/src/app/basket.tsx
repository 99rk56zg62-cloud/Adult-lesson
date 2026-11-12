import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { runCheckout } from "@/checkout";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { paymentReturnUrl } from "@/return-url";
import { BOOKING_POLICY } from "@/brand";
import { colors, heading } from "@/theme";
import type { Booking } from "@/types";

export default function BasketScreen() {
  const [items, setItems] = useState<Booking[]>([]);
  const [total, setTotal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const basket = await api.basket();
      setItems(basket.items);
      setTotal(basket.totalLabel);
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

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const checkout = await api.checkoutBasket(paymentReturnUrl());
      const result = await runCheckout({
        checkoutUrl: checkout.checkoutUrl,
        sessionId: checkout.sessionId,
        bookingId: checkout.booking.id,
        returnUrl: paymentReturnUrl(),
      });
      if (!result.leftApp && result.booking.status === "confirmed") router.replace("/bookings");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar title="Basket" subtitle="One payment covers every lesson." back />
      {items.length === 0 && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 24 }} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.meta}>{BOOKING_POLICY}</Text>
        {error ? <Banner tone="danger" text={error} /> : null}
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.when}>{item.slot?.dayLabel}</Text>
              <Text style={styles.meta}>
                {item.slot?.startTimeLabel} · {item.slot?.durationMinutes} min · {item.slot?.partyLabel}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <Text style={styles.price}>{item.priceLabel}</Text>
              <Button label="Remove" variant="secondary" onPress={() => void api.removeFromBasket(item.slot?.id ?? "").then(load)} />
            </View>
          </View>
        ))}
        {items.length > 0 ? (
          <>
            <Text style={styles.total}>Total {total}</Text>
            <Button label={busy ? "Opening payment…" : `Pay ${total}`} disabled={busy} onPress={() => void pay()} />
          </>
        ) : null}
      </ScrollView>
    </Phone>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  row: { flexDirection: "row", gap: 12, backgroundColor: colors.white, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.line },
  when: { fontFamily: heading, fontSize: 18, color: colors.ink },
  meta: { color: colors.muted, marginTop: 4 },
  price: { fontWeight: "700", color: colors.ink },
  total: { fontFamily: heading, fontSize: 28, color: colors.ink },
});
