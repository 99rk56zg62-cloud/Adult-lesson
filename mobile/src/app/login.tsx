import { Image } from "expo-image";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { messageOf } from "@/api";
import { useAuth } from "@/auth";
import { BUSINESS_NAME } from "@/brand";
import { Banner, Button, Field, Phone } from "@/components/ui";
import { body, colors, display, heading, strong } from "@/theme";

const logo = require("../../assets/brand/SSA_Logo_Primary_Stacked_Full-Colour_RGB.svg");

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
            <Image source={logo} style={styles.logo} contentFit="contain" accessibilityLabel="Swim School Academy" />
            <Text style={styles.name}>{BUSINESS_NAME}</Text>
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
  content: { flexGrow: 1, backgroundColor: colors.paper },
  hero: { paddingHorizontal: 24, paddingTop: 36, paddingBottom: 28, gap: 8, alignItems: "center" },
  logo: { width: 280, height: 110, marginBottom: 8 },
  name: { fontFamily: display, fontSize: 28, lineHeight: 34, color: colors.navy, textAlign: "center" },
  lead: { fontFamily: body, color: colors.muted, fontSize: 16, lineHeight: 22, textAlign: "center" },
  card: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 14,
  },
  heading: { fontFamily: heading, fontSize: 28, color: colors.ink },
  link: { fontFamily: strong, textAlign: "center", color: colors.atlantic, paddingVertical: 6 },
});
