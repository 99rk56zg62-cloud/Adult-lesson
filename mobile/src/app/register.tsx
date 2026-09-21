import { Redirect, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { messageOf } from "@/api";
import { useAuth } from "@/auth";
import { Banner, Button, Field, Phone, TopBar } from "@/components/ui";
import { colors } from "@/theme";

export default function RegisterScreen() {
  const { user, register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href="/schedule" />;

  async function submit() {
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(name, email, password);
      router.replace("/schedule");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar tone="dark" title="Create an account" subtitle="Lessons are kept against this sign-in." back />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {error ? <Banner tone="danger" text={error} /> : null}
          <Field label="Name" value={name} onChangeText={setName} autoComplete="name" placeholder="Your name" />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          <Field label="Password" value={password} onChangeText={setPassword} secure autoComplete="new-password" />
          <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secure />
          <Button label={busy ? "Creating…" : "Create account"} disabled={busy || name.trim().length < 2 || !email || password.length < 8} onPress={submit} />
          <Pressable accessibilityRole="button" onPress={() => router.replace("/login")}>
            <Text style={styles.link}>Already have an account? Sign in</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Phone>
  );
}

const styles = StyleSheet.create({
  form: { padding: 20, gap: 14, paddingBottom: 40 },
  link: { textAlign: "center", color: colors.pool, fontWeight: "700" },
});
