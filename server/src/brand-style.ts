import { BUSINESS_NAME } from "../../mobile/src/brand.js";
import { colors, fonts } from "../../mobile/src/theme.js";

export { BUSINESS_NAME };

export function brandFontLinks(): string {
  return `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${fonts.googleStylesheet}" />`;
}

/** CSS variables sourced from the app theme so admin and payment pages stay in step. */
export const brandCss = `
  :root {
    --red: ${colors.red};
    --navy: ${colors.navy};
    --sand: ${colors.sand};
    --atlantic: ${colors.atlantic};
    --sea-glass: ${colors.seaGlass};
    --paper: ${colors.paper};
    --ink: ${colors.ink};
    --muted: ${colors.muted};
    --white: ${colors.white};
    --line: ${colors.line};
    --surround: ${colors.surround};
    --danger: ${colors.danger};
    --danger-bg: ${colors.dangerBg};
    --ok: ${colors.ok};
    --ok-bg: ${colors.okBg};
    --warn: ${colors.warn};
    --warn-bg: ${colors.warnBg};
    --header-muted: ${colors.headerMuted};
    --font: ${fonts.webFamily};
  }
`;
