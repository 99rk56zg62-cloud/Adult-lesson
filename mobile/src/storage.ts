import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const memory = new Map<string, string>();

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage.setItem(key, value);
      return;
    } catch {
      memory.set(key, value);
      return;
    }
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

const TOKEN = "lido.token";
const PENDING = "lido.pendingPayment";

export function loadToken() {
  return getItem(TOKEN);
}

export function saveToken(token: string) {
  return setItem(TOKEN, token);
}

export function clearToken() {
  return removeItem(TOKEN);
}

export type PendingPayment = { bookingId: string; sessionId: string };

export async function savePending(value: PendingPayment) {
  await setItem(PENDING, JSON.stringify(value));
}

export async function loadPending(): Promise<PendingPayment | null> {
  const raw = await getItem(PENDING);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingPayment;
    if (!parsed.bookingId || !parsed.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPending() {
  return removeItem(PENDING);
}
