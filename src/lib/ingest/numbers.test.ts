import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  NumberFormatError,
  parseDecimalOrZero,
  parseDecimalValue,
  parseQuantity,
  toNumeric,
} from "./numbers";

const dot = { decimalSeparator: "." as const, column: "Total" };
const comma = { decimalSeparator: "," as const, column: "Summe" };

function value(result: Decimal | null): string | null {
  return result === null ? null : result.toFixed();
}

describe("parseDecimalValue", () => {
  it("reads a dot as the decimal separator", () => {
    expect(value(parseDecimalValue("45.90", dot))).toBe("45.9");
    expect(value(parseDecimalValue("-4.48", dot))).toBe("-4.48");
  });

  it("reads a comma as the decimal separator", () => {
    expect(value(parseDecimalValue("25,13", comma))).toBe("25.13");
    expect(value(parseDecimalValue("-3.541,35", comma))).toBe("-3541.35");
  });

  it("does not confuse a thousands separator with a decimal one", () => {
    // Exactly the ambiguity that makes the separator an argument, not a guess.
    expect(value(parseDecimalValue("1,234", dot))).toBe("1234");
    expect(value(parseDecimalValue("1,234", comma))).toBe("1.234");
  });

  it("reads accounting brackets as a minus", () => {
    // Legacy took the absolute value, so Cdiscount refunds went out positive.
    expect(value(parseDecimalValue("(2.52)", dot))).toBe("-2.52");
    expect(value(parseDecimalValue("(243.26)", dot))).toBe("-243.26");
  });

  it("drops the currency written next to the amount", () => {
    expect(value(parseDecimalValue("-24.59 zł", dot))).toBe("-24.59");
    expect(value(parseDecimalValue("1 234,56 €", comma))).toBe("1234.56");
  });

  it("treats an empty value as absent, not as zero", () => {
    expect(parseDecimalValue("", dot)).toBeNull();
    expect(parseDecimalValue("   ", dot)).toBeNull();
    expect(parseDecimalValue("-", dot)).toBeNull();
    expect(parseDecimalValue(undefined, dot)).toBeNull();
  });

  it("throws on a value it does not understand instead of returning zero", () => {
    // The heart of the bug being fixed here: a silent zero in place of a price.
    expect(() => parseDecimalValue("n/a", dot)).toThrow(NumberFormatError);
    expect(() => parseDecimalValue("25,13", dot)).not.toThrow();
    expect(() => parseDecimalValue("12.34.56", dot)).toThrow(NumberFormatError);
    expect(() => parseDecimalValue("--5", dot)).toThrow(NumberFormatError);
  });

  it("keeps precision a float cannot", () => {
    expect(value(parseDecimalValue("0.1", dot))!.toString()).toBe("0.1");
    const sum = parseDecimalValue("0.1", dot)!.plus(parseDecimalValue("0.2", dot)!);
    expect(sum.toFixed()).toBe("0.3");
  });
});

describe("parseDecimalOrZero", () => {
  it("puts zero in place of an empty value", () => {
    expect(parseDecimalOrZero("", dot).toFixed()).toBe("0");
    expect(parseDecimalOrZero("7.65", dot).toFixed()).toBe("7.65");
  });
});

describe("parseQuantity", () => {
  it("accepts whole numbers", () => {
    expect(parseQuantity("1", dot)).toBe(1);
    expect(parseQuantity("12", dot)).toBe(12);
  });

  it("rejects a fractional quantity — a sign the wrong column was read", () => {
    expect(() => parseQuantity("1.5", dot)).toThrow(NumberFormatError);
  });
});

describe("toNumeric", () => {
  it("returns a string without an exponent, which is what numeric accepts", () => {
    expect(toNumeric(new Decimal("0.000001"))).toBe("0.000001");
    expect(toNumeric(new Decimal("12345678.9"))).toBe("12345678.9");
    expect(toNumeric(null)).toBeNull();
  });
});
