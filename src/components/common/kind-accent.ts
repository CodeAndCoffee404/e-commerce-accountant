"use client";

import { theme } from "antd";

export type EntityKind = "report" | "upload";

/**
 * The one place the two entity colours are decided: reports carry the app's
 * primary blue, uploads a purple of their own. Both come from theme tokens
 * rather than literals, so the pair keeps its contrast under the dark
 * algorithm as well as the light one.
 *
 * `tint` is the wash behind an icon or a card header, `accent` the colour of
 * the glyph itself, `ink` a text-strength shade for the rare label that has
 * to be read at small size.
 */
export function useKindAccent(kind: EntityKind): {
  accent: string;
  tint: string;
  ink: string;
} {
  const { token } = theme.useToken();

  return kind === "report"
    ? { accent: token.colorPrimary, tint: token.colorPrimaryBg, ink: token.colorPrimaryText }
    : { accent: token.purple6, tint: token.purple1, ink: token.purple7 };
}
