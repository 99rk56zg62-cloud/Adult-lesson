import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { runCheckout } from "@/checkout";
import { Banner, Button, Phone, TopBar } from "@/components/ui";
import { paymentReturnUrl } from "@/return-url";
import { colors, levelColor, serif } from "@/theme";
import type { Slot } from "@/types";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function SlotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { config } = useAuth();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.slot(one(id));
        if (!cancelled) setSlot(result.slot);
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function book() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const checkout = await api.createBooking(slot.id, paymentReturnUrl());
      const result = await runCheckout({
        checkoutUrl: checkout.checkoutUrl,
        sessionId: checkout.sessionId,
        bookingId: checkout.booking.id,
        returnUrl: paymentReturnUrl(),
      });
      if (result.leftApp) return;
      if (result.booking.status === "confirmed") {
        router.replace(`/booking/${result.booking.id}`);
        return;
      }
      setInfo("Payment wasn't completed. The space stays held for a short time — you can finish it from My lessons.");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar tone="dark" title={slot?.title ?? "Lesson"} subtitle={slot ? `${slot.dayLabel} · ${slot.timeLabel}` : " "} back />
      {!slot && !error ? <ActivityIndicator color={colors.pool} style={{ marginTop: 32 }} /> : null}
      {error ? (
        <View style={styles.pad}>
          <Banner tone="danger" text={error} />
        </View>
      ) : null}
      {slot ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.level, { backgroundColor: levelColor(slot.level) }]}>
            <Text style={styles.levelText}>{slot.level}</Text>
          </View>
          <Text style={styles.place}>{slot.location}</Text>
          <Text style={styles.address}>{slot.address}</Text>
          <Text style={styles.blurb}>{slot.blurb}</Text>
          <View style={styles.facts}>
            <Fact label="When" value={`${slot.dayLabel}, ${slot.timeLabel}`} />
            <Fact label="Length" value={`${slot.durationMinutes} minutes`} />
            <Fact label="Teacher" value={slot.instructor} />
            <Fact label="Spaces" value={slot.spotsLabel} />
            <Fact label="Price" value={slot.priceLabel} />
          </View>
          <Text style={styles.note}>Bring a costume and towel. Goggles help. Hats are available at the pool. 25 metre pool, with changing rooms on site.</Text>
          {slot.soon && slot.bookable ? (
            <Banner tone="warn" text="This session starts soon. After you book, it can't be rearranged — changes close 24 hours before the start." />
          ) : null}
          {slot.unavailableReason ? <Banner tone="warn" text={slot.unavailableReason} /> : null}
          {info ? <Banner tone="warn" text={info} /> : null}
          <Button
            label={busy ? "Opening payment…" : slot.bookable ? `Book · ${slot.priceLabel}` : "Can't book this session"}
            disabled={!slot.bookable || busy}
            onPress={book}
          />
          <Text style={styles.payNote}>
            {config?.paymentsMode === "stripe"
              ? "You'll pay on Stripe's secure page. The lesson appears in My lessons after the payment succeeds."
              : "This server is using a local test payment, so you won't be charged. Set a Stripe test key for Checkout."}
          </Text>
        </ScrollView>
      ) : null}
    </Phone>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 20 },
  content: { padding: 20, gap: 12, paddingBottom: 36 },
  level: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  levelText: { color: colors.white, fontWeight: "700", fontSize: 12 },
  place: { fontFamily: serif, fontSize: 28, fontWeight: "700", color: colors.ink },
  address: { color: colors.muted, marginTop: -6 },
  blurb: { fontSize: 16, lineHeight: 23, color: colors.ink },
  facts: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 6 },
  fact: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  factLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  factValue: { color: colors.ink, fontSize: 16, marginTop: 2 },
  note: { color: colors.muted, lineHeight: 20 },
  payNote: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
