import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, messageOf } from "@/api";
import { ContactButtons, defaultContact } from "@/components/contact-buttons";
import { Banner, Button, TopBar } from "@/components/ui";
import { colors, heading } from "@/theme";

type Pages = Awaited<ReturnType<typeof api.pages>>;

export default function WeeklyScreen() {
  const [pages, setPages] = useState<Pages | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={styles.screen}>
      <TopBar title="Weekly Lessons" subtitle="Private lessons, 30 or 60 minutes." />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Banner tone="danger" text={error} /> : null}
        {!pages && !error ? <ActivityIndicator color={colors.pool} /> : null}
        {pages ? (
          <>
            <Text style={styles.body}>{pages.weeklyIntro}</Text>
            <Button label="Book a lesson" onPress={() => router.push("/schedule" as never)} />
            <ContactButtons email={email} phone={phone} tel={tel} />
            <Text style={styles.heading}>{pages.weeklyHeading}</Text>
            {pages.levels.map((level) => (
              <View key={level.id} style={styles.card}>
                <Text style={styles.title}>{level.title}</Text>
                <Text style={styles.body}>{level.body}</Text>
              </View>
            ))}
            <Text style={styles.body}>{pages.weeklyClosing}</Text>
            <ContactButtons email={email} phone={phone} tel={tel} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 14, paddingBottom: 36 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 8 },
  heading: { fontFamily: heading, fontSize: 24, color: colors.ink },
  title: { fontFamily: heading, fontSize: 22, color: colors.ink },
  body: { color: colors.ink, lineHeight: 22, fontSize: 16 },
});
