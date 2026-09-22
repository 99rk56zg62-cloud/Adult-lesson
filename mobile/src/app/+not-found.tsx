import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button, Phone } from "@/components/ui";
import { colors, serif } from "@/theme";

export default function NotFound() {
  return (
    <Phone>
      <View style={styles.center}>
        <Text style={styles.title}>That page isn't here</Text>
        <Button label="Back to the schedule" onPress={() => router.replace("/schedule")} />
      </View>
    </Phone>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  title: { fontFamily: serif, fontSize: 32, fontWeight: "700", color: colors.ink },
});
