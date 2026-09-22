import { Redirect, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { messageOf } from "@/api";
import { useAuth } from "@/auth";
import { Banner, Button, Field, Phone } from "@/components/ui";
import { colors, serif } from "@/theme";

export default function LoginScreen() {
  const { user, config, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href="/schedule" />;

  async function submit(nextEmail = email, nextPassword = password) {
    setBusy(true);
    setError(null);
    try {
      await signIn(nextEmail, nextPassword);
      router.replace("/schedule");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.wordmark}>Lido</Text>
            <Text style={styles.tag}>Adult swimming lessons</Text>
            <Text style={styles.lead}>Book a session up to six weeks ahead, pay by card, and keep it in your calendar.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.heading}>Sign in</Text>
            {error ? <Banner tone="danger" text={error} /> : null}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <Field label="Password" value={password} onChangeText={setPassword} secure autoComplete="password" />
            <Button label={busy ? "Signing in…" : "Sign in"} disabled={busy || !email || !password} onPress={() => submit()} />
            {config?.demoLogin ? (
              <Button
                label="Use the demo swimmer"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  setEmail(config.demoLogin!.email);
                  setPassword(config.demoLogin!.password);
                  void submit(config.demoLogin!.email, config.demoLogin!.password);
                }}
              />
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => router.push("/register")}>
              <Text style={styles.link}>Create an account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Phone>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  hero: { backgroundColor: colors.deep, paddingHorizontal: 24, paddingTop: 72, paddingBottom: 36, gap: 8 },
  wordmark: { fontFamily: serif, fontSize: 56, lineHeight: 60, color: colors.white, fontWeight: "700" },
  tag: { color: colors.sand, fontWeight: "700", letterSpacing: 0.4 },
  lead: { color: "#D7E6E4", fontSize: 16, lineHeight: 22, marginTop: 6 },
  card: {
    marginTop: -18,
    marginHorizontal: 16,
    backgroundColor: colors.paper,
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  heading: { fontFamily: serif, fontSize: 28, fontWeight: "700", color: colors.ink },
  link: { textAlign: "center", color: colors.pool, fontWeight: "700", paddingVertical: 6 },
});
