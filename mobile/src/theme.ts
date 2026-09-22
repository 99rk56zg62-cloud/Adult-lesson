import { Platform } from "react-native";

export const colors = {
  paper: "#F6F1E8",
  ink: "#14262B",
  muted: "#5C6B70",
  pool: "#0F6E6A",
  deep: "#0C2E33",
  sand: "#E7D3B0",
  white: "#FFFFFF",
  line: "#E4D8C8",
  surround: "#D9D0C3",
  danger: "#8E2F2F",
  dangerBg: "#F8E8E4",
  ok: "#1F6B45",
  okBg: "#E5F2EA",
  warn: "#8A5A00",
  warnBg: "#F8EFD9",
};

export const serif = Platform.select({
  ios: "Georgia",
  android: "serif",
  web: "Georgia, 'Iowan Old Style', Palatino, serif",
  default: "serif",
});

