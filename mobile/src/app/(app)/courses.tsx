import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { ContactButtons, defaultContact } from "@/components/contact-buttons";
import { Banner, Button, TopBar } from "@/components/ui";
import { colors, heading } from "@/theme";

type Pages = Awaited<ReturnType<typeof api.pages>>;

const PHRASES = ["whole swimming facility", "payment plan options", "only an email away"] as const;

export default function CoursesScreen() {
  const [pages, setPages] = useState<Pages | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);

  const load = useCallback(async () => {
    try {
      setPages(await api.pages());
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

  const email = pages?.contactEmail ?? defaultContact.contactEmail;
  const phone = pages?.contactPhone ?? defaultContact.contactPhone;
  const tel = pages?.contactTel ?? defaultContact.contactTel;

  function openPhrase(phrase: string) {
    if (phrase === "whole swimming facility") {
      router.push("/arrival" as never);
      return;
    }
    if (phrase === "payment plan options") {
      setShowPlan(true);
      return;
    }
    void Linking.openURL(`mailto:${email}`);
  }

  return (
    <View style={styles.screen}>
      <TopBar title="Crash Courses" subtitle="Choose a course, then pick the days." />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {!pages && !error ? <ActivityIndicator color={colors.pool} /> : null}
        {pages ? (
          <>
            <LinkedCopy text={pages.courseIntro} onPhrase={openPhrase} />
            <ContactButtons email={email} phone={phone} tel={tel} />
            <Text style={styles.note}>Call {phone} or email {email}.</Text>
            {pages.packages.map((course) => (
              <View key={course.days} style={styles.card}>
                {course.recommended ? <Text style={styles.badge}>Recommended for you</Text> : null}
                <Text style={styles.title}>{course.title}</Text>
                <Text style={styles.body}>{course.body}</Text>
                <Text style={styles.price}>
                  {course.priceLabel} · deposit {course.depositLabel}, then {course.balanceLabel}
                </Text>
                <Button
                  label="Book this course"
                  onPress={() => router.push({ pathname: "/course/plan", params: { days: String(course.days) } } as never)}
                />
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => router.push("/weekly" as never)} style={styles.card}>
              <Text style={styles.kicker}>Private Weekly Lessons</Text>
              <Text style={styles.body}>{pages.weeklyCard}</Text>
              <Text style={styles.link}>See weekly lessons</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
      {showPlan && pages ? (
        <View style={styles.sheet}>
          <View style={styles.sheetCard}>
            <Text style={styles.title}>Payment plan</Text>
            <Text style={styles.body}>{pages.paymentPlan}</Text>
            <Button label="Close" variant="secondary" onPress={() => setShowPlan(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function LinkedCopy({ text, onPhrase }: { text: string; onPhrase: (phrase: string) => void }) {
  const parts = text.split(new RegExp(`(${PHRASES.join("|")})`, "g"));
  return (
    <Text style={styles.body}>
      {parts.map((part, index) =>
        (PHRASES as readonly string[]).includes(part) ? (
          <Text key={`${part}-${index}`} style={styles.inlineLink} onPress={() => onPhrase(part)}>
            {part}
          </Text>
        ) : (
          <Text key={`${index}-${part.slice(0, 12)}`}>{part}</Text>
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 14, paddingBottom: 36 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 10 },
  kicker: { color: colors.pool, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.seaGlass,
    color: colors.navy,
    fontWeight: "700",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
  },
  title: { fontFamily: heading, fontSize: 22, color: colors.ink },
  body: { color: colors.ink, lineHeight: 22, fontSize: 16 },
  price: { color: colors.navy, fontWeight: "700" },
  link: { color: colors.atlantic, fontWeight: "700" },
  inlineLink: { color: colors.atlantic, fontWeight: "700", textDecorationLine: "underline" },
  note: { color: colors.muted, fontSize: 13 },
  sheet: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(40,50,76,0.45)", justifyContent: "flex-end", padding: 16 },
  sheetCard: { backgroundColor: colors.paper, borderRadius: 18, padding: 18, gap: 12 },
});
