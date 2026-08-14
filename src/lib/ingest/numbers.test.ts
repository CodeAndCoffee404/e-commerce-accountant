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
  it("разбирает точку как разделитель", () => {
    expect(value(parseDecimalValue("45.90", dot))).toBe("45.9");
    expect(value(parseDecimalValue("-4.48", dot))).toBe("-4.48");
  });

  it("разбирает запятую как разделитель", () => {
    expect(value(parseDecimalValue("25,13", comma))).toBe("25.13");
    expect(value(parseDecimalValue("-3.541,35", comma))).toBe("-3541.35");
  });

  it("не путает разделитель тысяч с десятичным", () => {
    // Ровно та неоднозначность, из-за которой разделитель задаётся явно.
    expect(value(parseDecimalValue("1,234", dot))).toBe("1234");
    expect(value(parseDecimalValue("1,234", comma))).toBe("1.234");
  });

  it("понимает бухгалтерские скобки как минус", () => {
    // Legacy брал модуль, и возвраты Cdiscount уходили положительными.
    expect(value(parseDecimalValue("(2.52)", dot))).toBe("-2.52");
    expect(value(parseDecimalValue("(243.26)", dot))).toBe("-243.26");
  });

  it("отбрасывает валюту рядом с суммой", () => {
    expect(value(parseDecimalValue("-24.59 zł", dot))).toBe("-24.59");
    expect(value(parseDecimalValue("1 234,56 €", comma))).toBe("1234.56");
  });

  it("считает пустое значение отсутствующим, а не нулём", () => {
    expect(parseDecimalValue("", dot)).toBeNull();
    expect(parseDecimalValue("   ", dot)).toBeNull();
    expect(parseDecimalValue("-", dot)).toBeNull();
    expect(parseDecimalValue(undefined, dot)).toBeNull();
  });

  it("падает на непонятном значении, а не возвращает ноль", () => {
    // Сердцевина бага, который здесь и чинится: тихий ноль вместо цены.
    expect(() => parseDecimalValue("н/д", dot)).toThrow(NumberFormatError);
    expect(() => parseDecimalValue("25,13", dot)).not.toThrow();
    expect(() => parseDecimalValue("12.34.56", dot)).toThrow(NumberFormatError);
    expect(() => parseDecimalValue("--5", dot)).toThrow(NumberFormatError);
  });

  it("сохраняет точность, недоступную числу с плавающей точкой", () => {
    expect(value(parseDecimalValue("0.1", dot))!.toString()).toBe("0.1");
    const sum = parseDecimalValue("0.1", dot)!.plus(parseDecimalValue("0.2", dot)!);
    expect(sum.toFixed()).toBe("0.3");
  });
});

describe("parseDecimalOrZero", () => {
  it("подставляет ноль вместо пустого значения", () => {
    expect(parseDecimalOrZero("", dot).toFixed()).toBe("0");
    expect(parseDecimalOrZero("7.65", dot).toFixed()).toBe("7.65");
  });
});

describe("parseQuantity", () => {
  it("принимает целые", () => {
    expect(parseQuantity("1", dot)).toBe(1);
    expect(parseQuantity("12", dot)).toBe(12);
  });

  it("отвергает дробное количество — это признак не той колонки", () => {
    expect(() => parseQuantity("1.5", dot)).toThrow(NumberFormatError);
  });
});

describe("toNumeric", () => {
  it("отдаёт строку без экспоненты, её и принимает numeric", () => {
    expect(toNumeric(new Decimal("0.000001"))).toBe("0.000001");
    expect(toNumeric(new Decimal("12345678.9"))).toBe("12345678.9");
    expect(toNumeric(null)).toBeNull();
  });
});
