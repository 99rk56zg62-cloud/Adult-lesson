import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, serif } from "@/theme";

export function Phone({ children }: { children: ReactNode }) {
  return (
    <View style={styles.surround}>
      <View style={styles.phone}>{children}</View>
    </View>
  );
}

export function TopBar({
  eyebrow = "LIDO",
  title,
  subtitle,
  tone = "light",
  back = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  tone?: "light" | "dark";
  back?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const dark = tone === "dark";
  return (
    <View style={[styles.top, { paddingTop: insets.top + 10, backgroundColor: dark ? colors.deep : colors.paper }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/schedule"))}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={22} color={dark ? colors.white : colors.ink} />
          <Text style={[styles.backText, { color: dark ? colors.white : colors.ink }]}>Back</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.eyebrow, { color: dark ? colors.sand : colors.pool }]}>{eyebrow}</Text>
      <Text style={[styles.title, { color: dark ? colors.white : colors.ink }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: dark ? "#D7E6E4" : colors.muted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" ? styles.primary : variant === "danger" ? styles.danger : styles.secondary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, variant === "secondary" ? styles.secondaryText : styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  keyboardType,
  autoComplete,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: TextInputProps["keyboardType"];
  autoComplete?: TextInputProps["autoComplete"];
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8A969A"
        secureTextEntry={secure}
        autoCapitalize={keyboardType === "email-address" || secure ? "none" : "words"}
        autoCorrect={false}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        style={styles.input}
      />
    </View>
  );
}

export function Banner({ tone, text }: { tone: "danger" | "warn" | "ok"; text: string }) {
  const palette =
    tone === "danger"
      ? { background: colors.dangerBg, color: colors.danger }
      : tone === "ok"
        ? { background: colors.okBg, color: colors.ok }
        : { background: colors.warnBg, color: colors.warn };
  return (
    <View style={[styles.banner, { backgroundColor: palette.background }]}>
      <Text style={[styles.bannerText, { color: palette.color }]}>{text}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surround: { flex: 1, backgroundColor: colors.surround },
  phone: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center", backgroundColor: colors.paper },
  top: { paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  back: { flexDirection: "row", alignItems: "center", marginLeft: -6, marginBottom: 6, alignSelf: "flex-start" },
  backText: { fontSize: 16, fontWeight: "600" },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 1.6 },
  title: { fontFamily: serif, fontSize: 34, lineHeight: 38, fontWeight: "700" },
  subtitle: { fontSize: 15, lineHeight: 21, marginTop: 4 },
  button: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primary: { backgroundColor: colors.deep },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.88 },
  buttonText: { fontSize: 16, fontWeight: "700" },
  primaryText: { color: colors.white },
  secondaryText: { color: colors.ink },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "700", color: colors.ink },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.ink,
  },
  banner: { borderRadius: 12, padding: 12 },
  bannerText: { fontSize: 14, lineHeight: 20 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.deep, borderColor: colors.deep },
  chipText: { color: colors.ink, fontWeight: "600", fontSize: 14 },
  chipTextOn: { color: colors.white },
});
