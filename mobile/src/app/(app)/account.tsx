import * as WebBrowser from "expo-web-browser";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { Banner, Button, TopBar } from "@/components/ui";
import { accountReturnUrl } from "@/return-url";
import { colors, serif } from "@/theme";
import type { CalendarStatus } from "@/types";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function AccountScreen() {
  const { user, config, signOut } = useAuth();
  const params = useLocalSearchParams<{ calendar?: string; message?: string }>();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const notice = one(params.message);

  const load = useCallback(async () => {
    try {
      setStatus(await api.calendarStatus());
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

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const returnUrl = accountReturnUrl();
      const { url } = await api.connectCalendar(returnUrl);
      if (Platform.OS === "web") {
        window.location.assign(url);
        return;
      }
      await WebBrowser.openAuthSessionAsync(url, returnUrl);
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.disconnectCalendar());
      setConfirmDisconnect(false);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <TopBar tone="dark" title="Account" subtitle={user ? user.email : ""} />
      <ScrollView contentContainerStyle={styles.content}>
        {notice ? <Banner tone={one(params.calendar) === "connected" ? "ok" : "warn"} text={notice} /> : null}
        {error ? <Banner tone="danger" text={error} /> : null}
        <View style={styles.card}>
          <Text style={styles.kicker}>Signed in</Text>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.meta}>{user?.email}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.kicker}>Payment</Text>
          <Text style={styles.body}>
            {config?.paymentsMode === "stripe"
              ? "New bookings are paid on Stripe Checkout. In test mode, card 4242 4242 4242 4242 works with any future expiry."
              : "This API is in local test-payment mode, so booking won't charge a card. Set STRIPE_SECRET_KEY to use Stripe Checkout."}
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.kicker}>Google Calendar</Text>
          {status?.connected ? (
            <Text style={styles.body}>Connected{status.email ? ` as ${status.email}` : ""}. New and rearranged lessons are added automatically.</Text>
          ) : (
            <Text style={styles.body}>
              {status?.setupHint ??
                "Connect once and lessons are added for you. Until then, each booking has an Add to Google Calendar link."}
            </Text>
          )}
          {status?.configured && !status.connected ? (
            <Button label={busy ? "Opening Google…" : "Connect Google Calendar"} disabled={busy} onPress={connect} />
          ) : null}
          {status?.connected && !confirmDisconnect ? (
            <Button label="Disconnect" variant="secondary" disabled={busy} onPress={() => setConfirmDisconnect(true)} />
          ) : null}
          {confirmDisconnect ? (
            <>
              <Text style={styles.body}>Events already on your calendar stay there.</Text>
              <Button label={busy ? "Disconnecting…" : "Confirm disconnect"} variant="danger" disabled={busy} onPress={disconnect} />
            </>
          ) : null}
        </View>
        <View style={styles.card}>
          <Text style={styles.kicker}>Staff admin</Text>
          <Text style={styles.body}>
            Pool managers set weekly availability and one-off sessions in the admin area
            {config?.adminUrl ? ` at ${config.adminUrl}` : ""}. Sign in there with the ADMIN_TOKEN from the API environment
            (default outside production: lido-dev-admin).
          </Text>
        </View>
        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => {
            void signOut().then(() => router.replace("/login"));
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 8 },
  kicker: { color: colors.pool, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  name: { fontFamily: serif, fontSize: 26, fontWeight: "700", color: colors.ink },
  meta: { color: colors.muted },
  body: { color: colors.ink, lineHeight: 21 },
});
