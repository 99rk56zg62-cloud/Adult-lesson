import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from "@expo-google-fonts/figtree";
import { Stack } from "expo-router/stack";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { AuthProvider, useAuth } from "@/auth";
import { body, colors, fonts } from "@/theme";

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
  const [fontsLoaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const style = document.createElement("style");
    style.textContent = `#root, #root input, #root button, #root textarea { font-family: ${body}, ${fonts.webFamily}; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
