import * as Linking from "expo-linking";
import { Platform } from "react-native";

function appUrl(path: string): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return Linking.createURL(path.replace(/^\//, ""));
}

export function paymentReturnUrl() {
  return appUrl("/payment/success");
}

export function accountReturnUrl() {
  return appUrl("/account");
}
