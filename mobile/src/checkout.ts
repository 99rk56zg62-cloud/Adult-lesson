import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { api } from "@/api";
import { clearPending, savePending } from "@/storage";

export async function runCheckout(input: { checkoutUrl: string; sessionId: string; bookingId: string; returnUrl: string }) {
  await savePending({ bookingId: input.bookingId, sessionId: input.sessionId });
  if (Platform.OS === "web") {
    window.location.assign(input.checkoutUrl);
    return { leftApp: true as const };
  }
  const result = await WebBrowser.openAuthSessionAsync(input.checkoutUrl, input.returnUrl);
  const url = result.type === "success" ? result.url : null;
  const sessionId = sessionFromUrl(url) ?? input.sessionId;
  try {
    const confirmed = await api.confirm(sessionId);
    await clearPending();
    return { leftApp: false as const, booking: confirmed.booking, calendarSyncError: confirmed.calendarSyncError };
  } catch {
    const current = await api.booking(input.bookingId);
    if (current.booking.status === "confirmed") {
      await clearPending();
      return { leftApp: false as const, booking: current.booking, calendarSyncError: null };
    }
    return { leftApp: false as const, booking: current.booking, calendarSyncError: null, incomplete: true as const };
  }
}

function sessionFromUrl(url: string | null): string | null {
  if (!url) return null;
  const parsed = Linking.parse(url);
  const value = parsed.queryParams?.session_id;
  return typeof value === "string" ? value : null;
}
