import { describe, expect, it } from "vitest";

import { decideSku, normaliseItemName } from "./rules";
import type { RulesSnapshot } from "./types";

type Mapping = RulesSnapshot["skuMappings"][number];

function snapshot(...skuMappings: Mapping[]): RulesSnapshot {
  return { vatRates: [], sellerVatNumbers: [], skuMappings, channelRules: [] };
}

function row(over: Partial<Mapping>): Mapping {
  return {
    channel: "shopify_geyser",
    sourceSku: "",
    sourceName: "",
    targetSku: null,
    itemName: null,
    isIgnored: false,
    ...over,
  };
}

/**
 * A mapping says what a source code means. Passing the name the source sent
 * with it turns that into something checkable, and a mapping that no longer
 * describes what arrived stops the build instead of billing under it.
 */
describe("decideSku with a name to check", () => {
  const cartridge = row({
    sourceSku: "9Z-0IH0-ECWV",
    sourceName: "Geyser EURO Cartridge - 1 Cartridge",
    targetSku: "CART-1",
    itemName: "Geyser Euro Cartridge",
  });

  it("bills the code when the name agrees", () => {
    const decision = decideSku(
      snapshot(cartridge),
      "shopify_geyser",
      "9Z-0IH0-ECWV",
      "Geyser EURO Cartridge - 1 Cartridge",
    );

    expect(decision).toEqual({
      kind: "map",
      targetSku: "CART-1",
      itemName: "Geyser Euro Cartridge",
    });
  });

  it("does not care about case or spacing, which is not what makes items different", () => {
    const decision = decideSku(
      snapshot(cartridge),
      "shopify_geyser",
      "9Z-0IH0-ECWV",
      "  geyser euro   cartridge -  1 cartridge ",
    );

    expect(decision.kind).toBe("map");
  });

  it("refuses when the code is mapped to something else now", () => {
    // The product behind the code was renamed, or the code was reused. Either
    // way the mapping no longer describes what arrived.
    const decision = decideSku(
      snapshot(cartridge),
      "shopify_geyser",
      "9Z-0IH0-ECWV",
      "Geyser EURO Cartridge - 2 Cartridges",
    );

    expect(decision).toEqual({
      kind: "mismatch",
      expectedNames: ["Geyser EURO Cartridge - 1 Cartridge"],
    });
  });

  it("refuses a row nobody finished filling in", () => {
    // An empty expected name is not a wildcard. Trusting it would hand back
    // exactly the unchecked behaviour the name was added to end.
    const decision = decideSku(
      snapshot(row({ sourceSku: "9Z-0IH0-ECWV", targetSku: "CART-1" })),
      "shopify_geyser",
      "9Z-0IH0-ECWV",
      "Geyser EURO Cartridge - 1 Cartridge",
    );

    expect(decision).toEqual({ kind: "mismatch", expectedNames: [""] });
  });

  it("tells apart two products sold under one code", () => {
    // The real case: QE-5795-1Z7V-stickerless is both of these in the same
    // month's export, and they are not the same thing to invoice.
    const rules = snapshot(
      row({
        sourceSku: "QE-5795-1Z7V-stickerless",
        sourceName: "Geyser EURO Filter",
        targetSku: "FILTER",
        itemName: "Geyser Euro Filter Only",
      }),
      row({
        sourceSku: "QE-5795-1Z7V-stickerless",
        sourceName: "Geyser EURO Kit - +1 Cartridge",
        targetSku: "FILTER-KIT",
        itemName: "Geyser Euro Filter",
      }),
    );

    const filter = decideSku(rules, "shopify_geyser", "QE-5795-1Z7V-stickerless", "Geyser EURO Filter");
    const kit = decideSku(rules, "shopify_geyser", "QE-5795-1Z7V-stickerless", "Geyser EURO Kit - +1 Cartridge");

    expect(filter).toMatchObject({ targetSku: "FILTER" });
    expect(kit).toMatchObject({ targetSku: "FILTER-KIT" });

    // And a third name under the same code is still refused, naming both.
    expect(
      decideSku(rules, "shopify_geyser", "QE-5795-1Z7V-stickerless", "Geyser EURO Something Else"),
    ).toEqual({
      kind: "mismatch",
      expectedNames: ["Geyser EURO Filter", "Geyser EURO Kit - +1 Cartridge"],
    });
  });

  it("passes an unknown code through, name or no name", () => {
    // Unmapped is unmapped: it is the gate's business, not a mismatch.
    expect(decideSku(snapshot(cartridge), "shopify_geyser", "NEW-CODE", "Anything")).toEqual({
      kind: "passthrough",
    });
  });

  it("checks the name before honouring an ignore", () => {
    const ignored = row({
      sourceSku: "0T-WMJ6-ZHLF",
      sourceName: "Adapter: Inside 16 - Outside 22 - Height 13 (China)",
      isIgnored: true,
    });

    expect(
      decideSku(snapshot(ignored), "shopify_geyser", "0T-WMJ6-ZHLF", "Adapter: Inside 16 - Outside 22 - Height 13 (China)"),
    ).toEqual({ kind: "ignore" });

    // A renamed adapter is a question, not a silent exclusion from the invoice.
    expect(
      decideSku(snapshot(ignored), "shopify_geyser", "0T-WMJ6-ZHLF", "Adapter: Inside 18 - Outside 24"),
    ).toMatchObject({ kind: "mismatch" });
  });
});

/**
 * Every other channel reports a code and nothing to check it against, and
 * their mappings must keep behaving exactly as they did.
 */
describe("decideSku without a name to check", () => {
  it("matches on the code alone and ignores the expected name entirely", () => {
    const rules = snapshot(
      row({
        channel: "amazon",
        sourceSku: "GEY-1",
        sourceName: "something nobody filled in correctly",
        targetSku: "CART-1",
        itemName: "Geyser Euro Cartridge",
      }),
    );

    expect(decideSku(rules, "amazon", "GEY-1")).toEqual({
      kind: "map",
      targetSku: "CART-1",
      itemName: "Geyser Euro Cartridge",
    });
  });

  it("falls back to the raw code when the mapping names no replacement", () => {
    const rules = snapshot(row({ channel: "allegro", sourceSku: "123" }));

    expect(decideSku(rules, "allegro", "123")).toEqual({
      kind: "map",
      targetSku: "123",
      itemName: "",
    });
  });
});

describe("normaliseItemName", () => {
  it("collapses the differences that are not differences", () => {
    expect(normaliseItemName("  Geyser   EURO  Filter\t")).toBe("geyser euro filter");
  });
});
