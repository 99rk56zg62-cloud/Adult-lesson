import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View } from "react-native";
import { AuthProvider, useAuth } from "@/auth";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { ready } = useAuth();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.surround }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surround } }} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
