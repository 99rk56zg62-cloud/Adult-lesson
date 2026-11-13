import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api, messageOf } from "@/api";
import { useAuth } from "@/auth";
import { Banner, Button, Field, Phone, TopBar } from "@/components/ui";
import { colors, heading } from "@/theme";
import type { Booking, SwimmerProfile } from "@/types";

const EMPTY: SwimmerProfile = {
  fullName: "",
  addressLine1: "",
  addressLine2: "",
  town: "",
  postcode: "",
  dateOfBirth: "",
  phone: "",
  emergencyName: "",
  emergencyRelationship: "",
  emergencyPhone: "",
  medicalNone: false,
  medicalNotes: "",
  swimmingLevel: "",
};

export default function DetailsScreen() {
  const [form, setForm] = useState<SwimmerProfile>(EMPTY);
  const [levels, setLevels] = useState<{ id: string; label: string }[]>([]);
  const [consentText, setConsentText] = useState("");
  const [consent, setConsent] = useState(false);
  const [courses, setCourses] = useState<Booking[]>([]);
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ready, user } = useAuth();

  useEffect(() => {
    if (!ready || !user) return;
    void (async () => {
      try {
        const [profile, basket] = await Promise.all([api.profile(), api.basket()]);
        setLevels(profile.swimmingLevels);
        setConsentText(profile.consentText);
        if (profile.profile) {
          setForm(profile.profile);
          setConsent(true);
        }
        const courseItems = basket.items.filter((item) => item.kind === "course");
        setCourses(courseItems);
        setGoals(Object.fromEntries(courseItems.map((item) => [item.id, item.courseGoal ?? ""])));
        setComments(Object.fromEntries(courseItems.map((item) => [item.id, item.courseComments ?? ""])));
      } catch (caught) {
        setError(messageOf(caught));
      }
    })();
  }, [ready, user]);

  function set<K extends keyof SwimmerProfile>(key: K, value: SwimmerProfile[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveProfile({ ...form, medicalNotes: form.medicalNone ? "" : form.medicalNotes, consent });
      for (const course of courses) {
        await api.saveCourseNotes(course.id, { goal: goals[course.id] ?? "", comments: comments[course.id] ?? "" });
      }
      router.replace("/basket" as never);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Phone>
      <TopBar title="Your details" subtitle="We keep these on your account and fill them in next time." back />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        <Text style={styles.heading}>About you</Text>
        <Field label="Full name" value={form.fullName} onChangeText={(value) => set("fullName", value)} />
        <Field label="Address line 1" value={form.addressLine1} onChangeText={(value) => set("addressLine1", value)} />
        <Field label="Address line 2" value={form.addressLine2} onChangeText={(value) => set("addressLine2", value)} />
        <Field label="Town" value={form.town} onChangeText={(value) => set("town", value)} />
        <Field label="Postcode" value={form.postcode} onChangeText={(value) => set("postcode", value)} autoComplete="postal-code" />
        <Field label="Date of birth" value={form.dateOfBirth} onChangeText={(value) => set("dateOfBirth", value)} placeholder="YYYY-MM-DD" />
        <Field label="Phone" value={form.phone} onChangeText={(value) => set("phone", value)} keyboardType="phone-pad" />
        <Text style={styles.heading}>Emergency contact</Text>
        <Field label="Name" value={form.emergencyName} onChangeText={(value) => set("emergencyName", value)} />
        <Field label="Relationship" value={form.emergencyRelationship} onChangeText={(value) => set("emergencyRelationship", value)} />
        <Field label="Phone" value={form.emergencyPhone} onChangeText={(value) => set("emergencyPhone", value)} keyboardType="phone-pad" />
        <Text style={styles.heading}>Swimming and health</Text>
        <Text style={styles.label}>Swimming level</Text>
        <View style={styles.levels}>
          {levels.map((level) => (
            <Pressable
              key={level.id}
              accessibilityRole="button"
              onPress={() => set("swimmingLevel", level.id)}
              style={[styles.level, form.swimmingLevel === level.id && styles.levelOn]}
            >
              <Text style={[styles.levelText, form.swimmingLevel === level.id && styles.levelTextOn]}>{level.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: form.medicalNone }} onPress={() => set("medicalNone", !form.medicalNone)} style={styles.check}>
          <Text style={styles.checkBox}>{form.medicalNone ? "✓" : ""}</Text>
          <Text style={styles.checkText}>No medical conditions</Text>
        </Pressable>
        {form.medicalNone ? null : (
          <View style={styles.notes}>
            <Text style={styles.label}>Medical history / conditions</Text>
            <TextInput
              value={form.medicalNotes}
              onChangeText={(value) => set("medicalNotes", value)}
              multiline
              style={styles.area}
              placeholder="Anything we should know to keep you safe"
            />
          </View>
        )}
        {courses.map((course) => (
          <View key={course.id} style={styles.notes}>
            <Text style={styles.heading}>This crash course</Text>
            <Text style={styles.label}>What would you like to achieve on the crash course?</Text>
            <TextInput value={goals[course.id] ?? ""} onChangeText={(value) => setGoals((current) => ({ ...current, [course.id]: value }))} multiline style={styles.area} />
            <Text style={styles.label}>Any other comments</Text>
            <TextInput
              value={comments[course.id] ?? ""}
              onChangeText={(value) => setComments((current) => ({ ...current, [course.id]: value }))}
              multiline
              style={styles.area}
              placeholder="Optional"
            />
          </View>
        ))}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent((value) => !value)} style={styles.check}>
          <Text style={styles.checkBox}>{consent ? "✓" : ""}</Text>
          <Text style={styles.checkText}>{consentText || "I confirm these details are accurate and consent to Swim School Academy storing them to keep me safe in lessons"}</Text>
        </Pressable>
        <Button label={busy ? "Saving…" : "Save details"} disabled={busy} onPress={() => void save()} />
      </ScrollView>
    </Phone>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  heading: { fontFamily: heading, fontSize: 22, color: colors.ink, marginTop: 8 },
  label: { fontWeight: "700", color: colors.ink },
  levels: { gap: 8 },
  level: { borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: 12 },
  levelOn: { backgroundColor: colors.atlantic, borderColor: colors.atlantic },
  levelText: { color: colors.ink, fontWeight: "700" },
  levelTextOn: { color: colors.white },
  check: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.navy,
    textAlign: "center",
    color: colors.navy,
    fontWeight: "700",
  },
  checkText: { flex: 1, color: colors.ink, lineHeight: 20 },
  notes: { gap: 6 },
  area: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.white,
    color: colors.ink,
    textAlignVertical: "top",
  },
});
