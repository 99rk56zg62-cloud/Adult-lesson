import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const [cards, setCards] = useState<{ id: string; brand: string; last4: string; isDefault: boolean }[]>([]);
  const [savedCardId, setSavedCardId] = useState<string | null>(null);
  const [saveCard, setSaveCard] = useState(true);

  const load = useCallback(async () => {
    try {
      const [basket, cardList] = await Promise.all([api.basket(), api.cards()]);
      setItems(basket.items);
      setTotal(basket.totalLabel);
      setCards(cardList.cards);
      setSavedCardId((current) => current ?? cardList.cards.find((card) => card.isDefault)?.id ?? null);
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
      const profile = await api.profile();
      const needsGoal = items.some((item) => item.kind === "course" && !(item.courseGoal ?? "").trim());
      if (!profile.complete || needsGoal) {
        router.push("/details" as never);
        return;
      }
      const checkout = await api.checkoutBasket(paymentReturnUrl(), { savedCardId: savedCardId ?? undefined, saveCard: savedCardId ? false : saveCard });
      if (checkout.paidImmediately) {
        router.replace("/bookings");
        return;
      }
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
      <TopBar title="Basket" subtitle="One payment covers every lesson and any crash course." back />
      {items.length === 0 && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 24 }} /> : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.meta}>{BOOKING_POLICY}</Text>
        {error ? <Banner tone="danger" text={error} /> : null}
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.when}>{item.kind === "course" ? item.course?.title : item.slot?.dayLabel}</Text>
              <Text style={styles.meta}>
                {item.kind === "course"
                  ? item.course?.sessions.map((session) => `${session.dayLabel.split(" ").slice(0, 2).join(" ")} ${session.timeLabel}`).join("\n")
                  : `${item.slot?.startTimeLabel} · ${item.slot?.durationMinutes} min · ${item.slot?.partyLabel}`}
              </Text>
              {item.kind === "course" && item.balancePence > 0 ? (
                <Text style={styles.meta}>
                  Deposit today {item.depositLabel}. Balance {item.balanceLabel} due {item.balanceDueLabel}. The deposit is non-refundable.
                </Text>
              ) : null}
              {item.kind === "course" && item.balancePence === 0 ? (
                <Text style={styles.meta}>Full payment today. The course starts within 4 weeks. This payment is non-refundable.</Text>
              ) : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <Text style={styles.price}>{item.priceLabel}</Text>
              <Button label="Remove" variant="secondary" onPress={() => void api.removeBasketBooking(item.id).then(load)} />
            </View>
          </View>
        ))}
        {items.length > 0 ? (
          <>
            {cards.length > 0 ? (
              <View style={{ gap: 8 }}>
                {cards.map((card) => (
                  <Pressable key={card.id} accessibilityRole="button" onPress={() => setSavedCardId(card.id)} style={styles.payChoice}>
                    <Text style={styles.when}>{savedCardId === card.id ? "●" : "○"} Pay with saved card •••• {card.last4}</Text>
                  </Pressable>
                ))}
                <Pressable accessibilityRole="button" onPress={() => setSavedCardId(null)} style={styles.payChoice}>
                  <Text style={styles.when}>{savedCardId ? "○" : "●"} Pay with a new card</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="checkbox" onPress={() => setSaveCard((value) => !value)} style={styles.payChoice}>
                <Text style={styles.meta}>{saveCard ? "✓" : "○"} Save this card for next time</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="link" onPress={() => router.push("/details" as never)}>
              <Text style={styles.link}>Edit your details</Text>
            </Pressable>
            <Text style={styles.total}>Due today {total}</Text>
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
  link: { color: colors.atlantic, fontWeight: "700" },
  payChoice: { paddingVertical: 6 },
});
