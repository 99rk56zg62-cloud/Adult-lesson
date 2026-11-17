import fs from "node:fs";
import path from "node:path";
import type { ExpoConfig } from "expo/config";

function readConst(file: string, name: string): string {
  const text = fs.readFileSync(path.join(__dirname, file), "utf8");
  const match = text.match(new RegExp(`const ${name} = "([^"]+)"`));
  if (!match?.[1]) throw new Error(`Missing ${name} in ${file}`);
  return match[1];
}

const businessName = readConst("src/brand.ts", "BUSINESS_NAME");
const sand = readConst("src/theme.ts", "sand");
const icon = "./assets/brand/ssa-shark-icon-sand-square.png";

const config: ExpoConfig = {
  name: businessName,
  slug: "lido",
  version: "1.0.0",
  orientation: "portrait",
  icon,
  scheme: "lido",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "com.lido.lessons",
    icon,
  },
  android: {
    package: "com.lido.lessons",
    adaptiveIcon: {
      backgroundColor: sand,
      foregroundImage: icon,
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "single",
    favicon: icon,
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: sand,
        image: icon,
        imageWidth: 200,
      },
    ],
    "expo-secure-store",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
