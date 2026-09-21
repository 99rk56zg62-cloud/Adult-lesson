import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/auth";
import { colors } from "@/theme";

export default function AppLayout() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.pool} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  return (
    <View style={styles.surround}>
      <View style={styles.phone}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.pool,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: {
              backgroundColor: colors.white,
              borderTopColor: colors.line,
              height: 64,
              paddingTop: 6,
            },
            tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
          }}
        >
          <Tabs.Screen
            name="schedule"
            options={{
              title: "Schedule",
              tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="bookings"
            options={{
              title: "Lessons",
              tabBarIcon: ({ color, size }) => <Ionicons name="water-outline" color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="account"
            options={{
              title: "Account",
              tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
            }}
          />
        </Tabs>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surround: { flex: 1, backgroundColor: colors.surround },
  phone: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center", backgroundColor: colors.paper },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper },
});
