import Decimal from "decimal.js";

import { parseDecimalValue } from "@/lib/ingest/numbers";

import { allocate, exactLines } from "@/lib/reports/invoice-lines";
import { channelRule, decideSku, splitGross, vatRateOn } from "@/lib/reports/rules";
import type {
  GeneratorResult,
  LedgerRow,
  ReportContext,
  ReportSheet,
  RulesSnapshot,
} from "@/lib/reports/types";

import { ZOHO_HEADERS } from "./amazon-zoho-invoice";
import type { CompanyRules, ShopifyProfile } from "@/modules/companies/types";

import { parseShopifyTaxRate } from "./off-amazon-sales";
import {
  arrivalCountryOf,
  isDomestic,
  isSkippedCountry,
  notASale,
  notASaleReason,
  recomputesZeroTax,
  unpaidOrderWarning,
  shopifyOf,
} from "./shopify-orders";
import type { ReportModule, UnmappedSku } from "./types";

/**
 * Shopify invoice for Zoho: one line per item sold, plus VAT split by market.
 *
 * Off-Amazon Sales reads Shopify as one row per *order* — the order total,
 * taken from the first line's order-level columns, with the rest of that
 * order's lines skipped as mere continuations. This invoice needs the
 * opposite grain: every `LedgerRow` Shopify produces is already one line
 * item (`mapShopify` writes one per `Lineitem`, first row of an order
 * included), so the product side of this module reads all of them.
 *
 * VAT stays order-level, because Shopify only reports `Taxes` once per
 * order, on that first line — so the VAT pass below still reads only the
 * rows that carry an order `Total`, exactly as `shopifyRow` does.
 *
 * A single order's other columns (`Source`, which says whether it was made
 * by hand) are likewise only written on that first line, but every one of an
 * order's lines has to be excluded together — so `orderFactsMap` resolves each
 * order's `Source` and `Total` once, up front, and every row looks them up by
 * order number rather than trusting its own (possibly blank) columns.
 */

/**
 * What a line item is, as far as SKU mapping is concerned.
 *
 * Shopify writes `Lineitem sku` when the product has one and leaves it blank
 * when it does not — 51 of July's 72 lines carried one — so the code alone
 * cannot be the key for every line. Where there is a code it is the key and
 * the name checks it; where there is none the name is the key, and a mapping
 * row for it stores the same text in both columns.
 *
 * Both passes below identify a line through this, so `unmappedSkus` asks
 * about exactly the lines `generate` would otherwise get wrong.
 */
function identify(row: LedgerRow): { key: string; name: string } | null {
  const name = row.raw["Lineitem name"]?.trim() ?? "";
  const code = row.sku?.trim() ?? "";
  const key = code === "" ? name : code;

  return key === "" ? null : { key, name };
}

type ShopifyDefaults = {
  domesticScheme: string;
  exportScheme: string;
};

/**
 * The Zoho account an order's VAT posts to: country in the middle, scheme
 * last, that capitalisation — the same shape the Amazon and Allegro invoices
 * use, so one country's tax lands on one account whichever channel sold it.
 *
 * The domestic name is built from the departure country rather than spelled
 * out, so it cannot drift away from where the goods actually ship from. The
 * four export markets big enough for their own line are a fixed list by
 * agreement: it does not grow on its own just because a new country shows up
 * in a file, and everything else pools into one account with no country to
 * place. Not the grouping a legacy-built invoice once used (Austria filed
 * under "DE", Slovenia under "FR") — that was a manual mistake, not a rule.
 */
function vatAccount(shop: ShopifyProfile, arrival: string): string {
  if (isDomestic(shop, arrival)) return `VAT ${shop.departureCountry} Regular`;

  return shop.zoho.ossBreakout.includes(arrival)
    ? `VAT ${arrival} OSS`
    : shop.zoho.pooledVatAccount;
}

/** The order the accounts print in; only the ones with money in them show. */
function vatAccountOrder(shop: ShopifyProfile): string[] {
  return [
    `VAT ${shop.departureCountry} Regular`,
    ...shop.zoho.ossBreakout.map((country: string) => `VAT ${country} OSS`),
    shop.zoho.pooledVatAccount,
  ];
}

type OrderFacts = { source: string; total: Decimal | null; paymentMethod: string };

/**
 * Every order's `Source`, `Total` and `Payment Method`, resolved once from
 * whichever of its lines carries them — all three are order-level columns
 * Shopify writes on the first line only, and every line of the order is judged
 * by them.
 */
function orderFactsMap(shop: ShopifyProfile, rows: readonly LedgerRow[]): Map<string, OrderFacts> {
  const map = new Map<string, OrderFacts>();

  for (const row of rows) {
    if (row.dataset !== shop.dataset) continue;

    const name = row.raw["Name"];

    if (!name) continue;

    const found = map.get(name);

    map.set(name, {
      source: row.raw["Source"] || found?.source || "",
      total: money(row.raw["Total"]) ?? found?.total ?? null,
      paymentMethod: row.raw["Payment Method"] || found?.paymentMethod || "",
    });
  }

  return map;
}

/**
 * Every order's `Subtotal` and `Shipping`, from whichever of its lines carries
 * them — Shopify writes order-level columns on the first line only.
 *
 * `Total` is what the buyer paid — goods after any order-level discount, plus
 * delivery — and it is the figure Off-Amazon Sales bills and the VAT below is
 * charged on. `Subtotal` is the same without delivery, kept only to tell a
 * discount apart from a delivery charge when checking the order adds up.
 */
function orderMoneyMap(
  shop: ShopifyProfile,
  rows: readonly LedgerRow[],
): Map<string, { total: Decimal | null; subtotal: Decimal | null }> {
  const map = new Map<string, { total: Decimal | null; subtotal: Decimal | null }>();

  for (const row of rows) {
    if (row.dataset !== shop.dataset) continue;

    const name = row.raw["Name"];

    if (!name || !row.raw["Total"] || map.has(name)) continue;

    map.set(name, { total: money(row.raw["Total"]), subtotal: money(row.raw["Subtotal"]) });
  }

  return map;
}

function money(value: string | undefined): Decimal | null {
  if (value === undefined || value.trim() === "") return null;

  try {
    return parseDecimalValue(value, { decimalSeparator: ".", column: "amount" });
  } catch {
    return null;
  }
}

function isExcludedRow(
  row: LedgerRow,
  rules: RulesSnapshot,
  facts: ReadonlyMap<string, OrderFacts>,
  arrival: string,
  shop: ShopifyProfile,
): string | null {
  const why = notASale(shop, facts.get(row.raw["Name"] ?? ""));

  if (why) return notASaleReason("Shopify invoice", why);

  if (isSkippedCountry(shop, arrival)) return `Shopify invoice: delivered to ${arrival}`;

  return null;
}

/** `INV-GeyserWebsite-01.26` — the client's own numbering, taken from a real invoice. */
function invoiceNumber(shop: ShopifyProfile, periodEnd: string): string {
  const [year, month] = periodEnd.split("-");

  return `${shop.zoho.invoicePrefix}${month}.${year.slice(2)}`;
}

type ProductLine = {
  itemName: string;
  sku: string;
  qty: Decimal;
  unitPrice: Decimal;
  /** What these rows came to in the ledger — see `exactLines`. */
  total: Decimal;
};

export function generateShopifyZohoInvoice(
  rows: readonly LedgerRow[],
  context: ReportContext,
): GeneratorResult {
  const shop = shopifyOf(context);
  const skipped = new Map<string, number>();
  const warnings: string[] = [];

  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  const defaults = channelRule<ShopifyDefaults>(context.rules, shop.dataset, "defaults");

  if (!defaults) {
    // Every figure below depends on it — departure country decides the whole
    // VAT split. Refuse rather than build a invoice that silently bucketed
    // everything as "Other countries".
    throw new Error(
      "Shopify invoice: the shopify/defaults channel rule is missing. Settings -> Channel rules -> " +
        "Restore missing defaults, then build again.",
    );
  }

  const facts = orderFactsMap(shop, rows);

  // Named before anything is built, once per order rather than once per line:
  // an order claiming money the shop cannot have taken is somebody's mistake to
  // go and fix, and a count in the skipped list would never say which orders.
  for (const [orderName, order] of facts) {
    if (notASale(shop, order) === "unpaid") {
      warnings.push(unpaidOrderWarning("Shopify invoice", orderName, order));
    }
  }

  /* ------------------------------------------------------------------ *
   * Product lines: every line item, one row per (item, unit price).
   * ------------------------------------------------------------------ */

  const productAgg = new Map<string, ProductLine>();

  /* ------------------------------------------------------------------ *
   * What each line is worth once the order's own money reaches it.
   *
   * The base is the order's `Total`: what the buyer actually paid, after any
   * discount and with delivery in it. That is the figure Off-Amazon Sales
   * bills and the VAT below is charged on, so spreading it over the order's
   * lines is what makes the two reports the same money.
   *
   * Neither adjustment can be read off a line. A discount code comes off the
   * order and leaves `Lineitem discount` at zero; delivery is charged on the
   * order and belongs to no product. Both are spread over the order's lines in
   * proportion, to the cent, and delivery ends up inside the item price rather
   * than on a line of its own.
   *
   * Every priced line of the order shares in it, including ones that will not
   * be invoiced — an ignored item takes its share away with it rather than
   * pushing it onto the items that are billed.
   * ------------------------------------------------------------------ */

  const orderMoney = orderMoneyMap(shop, rows);
  const linesByOrder = new Map<string, LedgerRow[]>();

  for (const row of rows) {
    if (row.dataset !== shop.dataset) continue;
    if (row.gross === null || row.quantity === null || row.quantity.isZero()) continue;

    const arrival = arrivalCountryOf(shop, row);

    if (isExcludedRow(row, context.rules, facts, arrival, shop)) continue;

    const order = row.raw["Name"] ?? "";
    const found = linesByOrder.get(order);

    if (found) found.push(row);
    else linesByOrder.set(order, [row]);
  }

  const billedPerLine = new Map<string, Decimal>();

  for (const [order, lines] of linesByOrder) {
    const money = orderMoney.get(order);
    const listed = lines.reduce((total, line) => total.plus(line.gross!), new Decimal(0));

    // No readable total is no basis to adjust anything: the lines stand as the
    // file states them, and the run says so rather than inventing a base.
    if (!money?.total) {
      warnings.push(`Shopify invoice: order ${order} has no readable total; its items are billed at list price`);
      for (const line of lines) billedPerLine.set(line.id, line.gross!);
      continue;
    }

    // Goods above what the lines list for is not a discount and not delivery:
    // it would invent revenue no line item accounts for. Checked without
    // delivery, which is allowed to raise the total and nothing else is.
    if (money.subtotal?.greaterThan(listed)) {
      warnings.push(
        `Shopify invoice: order ${order} has goods of ${money.subtotal.toFixed(2)} above its ` +
          `items' ${listed.toFixed(2)}; its items are billed at list price`,
      );
      for (const line of lines) billedPerLine.set(line.id, line.gross!);
      continue;
    }

    const shares = allocate(money.total, lines.map((line) => line.gross!));

    lines.forEach((line, index) => billedPerLine.set(line.id, shares[index]));
  }

  for (const row of rows) {
    if (row.dataset !== shop.dataset) continue;

    const arrival = arrivalCountryOf(shop, row);
    const excludeReason = isExcludedRow(row, context.rules, facts, arrival, shop);

    if (excludeReason) {
      skip(excludeReason);
      continue;
    }

    const item = identify(row);

    if (!item) {
      warnings.push(
        `Shopify invoice: a line item with neither a SKU nor a name, row ${row.sourceRowNumber}`,
      );
      skip("Shopify invoice: line item has neither a SKU nor a name");
      continue;
    }

    if (row.gross === null) {
      skip("Shopify invoice: line amount could not be read");
      continue;
    }

    const quantity = row.quantity;

    if (quantity === null || quantity.isZero()) {
      skip("Shopify invoice: no quantity");
      continue;
    }

    const decision = decideSku(context.rules, shop.dataset, item.key, item.name);

    if (decision.kind === "ignore") {
      skip("Shopify invoice: item is on the ignore list");
      continue;
    }

    // Unreachable in a normal build — `unmappedSkus` stops the run and asks
    // first — but if it is ever reached, nothing here may invent what to bill.
    // A raw Shopify code in the SKU column and a blank Item Name are both a
    // line the client's catalogue does not contain, and Zoho reads Item Name
    // as a lookup: the file fails on import, or worse, does not.
    if (decision.kind !== "map") {
      warnings.push(
        decision.kind === "mismatch"
          ? `Shopify invoice: ${item.key} arrived as "${item.name}", but SKU mapping expects ` +
            `${decision.expectedNames.map((expected) => `"${expected}"`).join(" or ")}`
          : `Shopify invoice: ${item.key} ("${item.name}") has no complete SKU mapping — ` +
            "an invoice code and an item name are both needed",
      );
      skip("Shopify invoice: no complete SKU mapping for this item");
      continue;
    }

    // Grouped by the exact unit price, not the rounded one — two sales at
    // genuinely different prices are two invoice lines, same reasoning as
    // the Amazon invoice.
    // What this line is worth once the order's discount and delivery have
    // reached it — the same money Off-Amazon Sales bills as the order's total.
    const billed = billedPerLine.get(row.id) ?? row.gross;
    const unitPrice = billed.dividedBy(quantity);
    const { targetSku: sku, itemName } = decision;
    const key = `${sku}|${unitPrice.toFixed(10)}`;
    const existing = productAgg.get(key);

    if (existing) {
      existing.qty = existing.qty.plus(quantity);
      existing.total = existing.total.plus(billed);
    } else productAgg.set(key, { itemName, sku, qty: quantity, unitPrice, total: billed });
  }

  /* ------------------------------------------------------------------ *
   * VAT lines: one order = one Taxes figure, read once per order.
   * ------------------------------------------------------------------ */

  const vatAgg = new Map<string, Decimal>();
  for (const row of rows) {
    if (row.dataset !== shop.dataset) continue;

    const orderTotal = row.raw["Total"];

    if (!orderTotal) continue; // a continuation line — the order total lives on the first row

    const arrival = arrivalCountryOf(shop, row);
    const excludeReason = isExcludedRow(row, context.rules, facts, arrival, shop);

    // Already tallied in `skipped` above, once per line, in the product
    // pass — this is the same order's first line, not a new row to count.
    if (excludeReason) continue;

    if (row.occurredOn === null) {
      warnings.push(`Shopify invoice: order date could not be read, row ${row.sourceRowNumber}`);
      skip("Shopify invoice: order date could not be read");
      continue;
    }

    let total: Decimal | null;

    try {
      total = parseDecimalValue(orderTotal, { decimalSeparator: ".", column: "Total" });
    } catch {
      total = null;
    }

    if (total === null) {
      warnings.push(
        `Shopify invoice: order total "${orderTotal}" could not be read, row ${row.sourceRowNumber}`,
      );
      skip("Shopify invoice: order total could not be read");
      continue;
    }

    // Same read as Off-Amazon Sales: trust the tax Shopify already charged
    // and the buyer's own invoice shows, except in the countries where a
    // reported zero is known to be wrong and has to be recomputed from the
    // rate instead.
    const labelled = parseShopifyTaxRate(row.raw["Tax 1 Name"]);
    const fallbackRate = vatRateOn(context.rules, arrival, row.occurredOn);
    const rate = labelled ?? fallbackRate;

    const reported = row.raw["Taxes"];
    let reportedVat: Decimal | null = null;

    try {
      reportedVat = parseDecimalValue(reported, { decimalSeparator: ".", column: "Taxes" });
    } catch {
      warnings.push(`Shopify invoice: tax "${reported}" could not be read, row ${row.sourceRowNumber}`);
    }

    const computedVat = rate === null ? null : splitGross(total, rate).vat;
    const vat =
      reportedVat === null || (reportedVat.isZero() && recomputesZeroTax(shop, arrival))
        ? computedVat
        : reportedVat;

    if (vat === null) {
      warnings.push(`Shopify invoice: no VAT rate for ${arrival}, row ${row.sourceRowNumber}`);
      skip(`Shopify invoice: no VAT rate for ${arrival}`);
      continue;
    }

    const account = vatAccount(shop, arrival);

    vatAgg.set(account, (vatAgg.get(account) ?? new Decimal(0)).plus(vat));
  }

  /* ------------------------------------------------------------------ *
   * Assemble the sheet.
   * ------------------------------------------------------------------ */

  const invoiceDate = `${context.period.end} 00:00:00`;
  const invoiceNo = invoiceNumber(shop, context.period.end);
  const output: (string | number | null)[][] = [];

  const productRows = [...productAgg.values()].sort((a, b) => {
    const bySku = a.sku.localeCompare(b.sku);

    return bySku !== 0 ? bySku : a.unitPrice.comparedTo(b.unitPrice);
  });

  for (const product of productRows) {
    // One line, or two a cent apart where no single cent price multiplies back
    // to what the item actually came to. See `exactLines`.
    for (const line of exactLines(product.total, product.qty)) {
      output.push([
        invoiceDate,
        invoiceNo,
        shop.zoho.customerName,
        "EUR",
        "1",
        product.itemName,
        product.sku,
        "",
        line.quantity.toFixed(),
        line.price.toFixed(2),
        shop.zoho.salesAccount,
      ]);
    }
  }

  for (const account of vatAccountOrder(shop)) {
    const amount = vatAgg.get(account);

    // Omitted, not printed as zero: an account nothing sold under this period
    // is not a real line on the invoice.
    if (!amount) continue;

    output.push([
      invoiceDate,
      invoiceNo,
      shop.zoho.customerName,
      "EUR",
      "1",
      // Item Name and SKU stay empty, and the name goes in Item Desc: Zoho
      // reads Item Name as a lookup into the item list, and there is no
      // product called "VAT PL Regular" — the import fails on the whole file
      // rather than on the line. The Amazon invoice has always written its
      // VAT lines this way.
      "",
      "",
      account,
      "1",
      amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      account,
    ]);
  }

  const sheet: ReportSheet = {
    name: "Shopify invoice for Zoho",
    headers: [...ZOHO_HEADERS],
    rows: output,
  };

  return {
    sheets: [sheet],
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    warnings,
  };
}

/**
 * The line items this period's invoice would bill that SKU mapping cannot
 * answer for: no row at all, or rows that disagree about what the code is.
 *
 * It mirrors `generate`'s own row filter exactly, for the reason the other
 * invoices do — a looser or stricter check here would silently change what
 * actually gets invoiced — and identifies a line the same way, so what is
 * asked about is precisely what would otherwise go out wrong.
 */
function unmappedSkus(
  rows: readonly LedgerRow[],
  rules: RulesSnapshot,
  company: CompanyRules,
): UnmappedSku[] {
  const shop = company.shopify;

  // Nothing to ask about: this company has no shop, and `generate` refuses for
  // the same reason before it builds anything.
  if (!shop) return [];

  const found = new Map<string, UnmappedSku>();
  const facts = orderFactsMap(shop, rows);

  for (const row of rows) {
    if (row.dataset !== shop.dataset) continue;

    const arrival = arrivalCountryOf(shop, row);

    if (isExcludedRow(row, rules, facts, arrival, shop)) continue;

    const item = identify(row);

    if (!item) continue;
    if (row.gross === null) continue;
    if (row.quantity === null || row.quantity.isZero()) continue;

    const decision = decideSku(rules, shop.dataset, item.key, item.name);

    if (decision.kind === "map" || decision.kind === "ignore") continue;

    // The pair is the identity, not the code: one code can be two products,
    // and each needs its own answer.
    const key = `${item.key}\u0000${item.name}`;

    found.set(key, {
      key,
      sourceSku: item.key,
      sourceName: item.name,
      problem:
        decision.kind === "mismatch"
          ? "mismatch"
          : decision.kind === "incomplete"
            ? "incomplete"
            : "unmapped",
      expectedNames: decision.kind === "mismatch" ? decision.expectedNames : [],
    });
  }

  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const shopifyZohoInvoiceModule: ReportModule = {
  definition: {
    id: "shopify_zoho_invoice",
    label: "Shopify invoice for Zoho",
    datasets: ["shopify_geyser"],
    // Dated and numbered by month, like the Amazon and Allegro invoices — a
    // quarter has no meaning for either.
    granularity: ["month"],
    requiresEveryDataset: true,
    description:
      "Geyser's Shopify orders aggregated by item into invoice lines for Zoho, VAT split by market.",
    needs: "One Geyser Shopify sales report for the month.",
    why:
      "Built without it, that month's Shopify revenue and VAT are simply missing from what Zoho " +
      "sees — not understated, absent.",
    requiredRules: [{ channel: "shopify_geyser", key: "defaults" }],
  },
  unmappedSkus,
  generate: generateShopifyZohoInvoice,
};
