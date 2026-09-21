import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/auth";
import { Phone } from "@/components/ui";
import { colors } from "@/theme";

export default function Index() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <Phone>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.pool} />
        </View>
      </Phone>
    );
  }
  if (!user) return <Redirect href="/login" />;
  return <Redirect href="/schedule" />;
}
