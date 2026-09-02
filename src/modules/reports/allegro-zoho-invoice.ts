import Decimal from "decimal.js";

import { parseAllegroMoney } from "@/modules/channels/allegro";

import { exactLines } from "@/lib/reports/invoice-lines";
import { allegroCurrencyRule, decideSku, splitGross, vatRateOn } from "@/lib/reports/rules";
import type {
  GeneratorResult,
  LedgerRow,
  ReportContext,
  ReportSheet,
  RulesSnapshot,
} from "@/lib/reports/types";

import { ZOHO_HEADERS } from "./amazon-zoho-invoice";
import type { ReportModule } from "./types";

/**
 * Allegro invoice for Zoho: the same idea as the Amazon one, built from the
 * same `allegro` upload Off-Amazon Sales already reads — Allegro's statement
 * mixes fees into the sales file, and only `wpłata` lines with a buyer are
 * sales here too. What is different is the shape of a sale: one statement
 * line is one order, and an order can carry more than one SKU (`oferta`,
 * pipe-separated), with the delivery fee folded into the total rather than
 * broken out. That has to be undone before anything can be summed by SKU.
 *
 * Everything ends up in EUR — the client's own choice, and it means a
 * currency without a cached ECB rate for the period aborts the whole build
 * (see below) rather than silently under-reporting one currency's revenue.
 */

const VAT_LABELS: Record<string, string> = {
  REGULAR: "VAT PL Regular",
  "UNION-OSS": "VAT OSS Other countries",
};

/** Fixed so the two VAT lines always print in the same order. */
const VAT_SCHEME_ORDER = ["REGULAR", "UNION-OSS"];

type RawItem = { sku: string; name: string; qty: number };

/** `<sku>;<name>;<N> szt.`, one or more separated by `|`. */
function parseOfferItems(raw: string | undefined): RawItem[] | null {
  if (!raw) return null;

  const items: RawItem[] = [];

  for (const part of raw.split("|")) {
    // Greedy `.+` for the name: it backtracks to the last `;<digits> szt.`,
    // so a name that happens to contain a semicolon still splits correctly.
    const match = part.match(/^(\d+);(.+);(\d+)\s*szt\.$/);

    if (!match) return null;

    items.push({ sku: match[1], name: match[2], qty: Number(match[3]) });
  }

  return items.length > 0 ? items : null;
}

/** Only `wpłata` lines with a buyer are sales — everything else is a fee. */
function isSaleRow(row: LedgerRow): boolean {
  return row.dataset === "allegro" && row.raw["operacja"] === "wpłata" && Boolean(row.raw["kupujący"]);
}

type Order = {
  sourceRowNumber: number;
  occurredOn: string;
  currency: string;
  amount: Decimal;
  delivery: Decimal;
  items: RawItem[];
};

type OrderLine = {
  currency: string;
  rawSku: string;
  qty: Decimal;
  lineTotal: Decimal;
  occurredOn: string;
};

/**
 * The reference unit price for a `(sku, currency)` pair this period: the
 * modal price among that period's single-item orders, rounded to the cent.
 * Multi-item orders split their total in proportion to this, since the file
 * never says how much of a mixed order's total belongs to which item.
 *
 * A genuine tie in frequency is broken by whichever price was seen most
 * recently — an arbitrary but deterministic rule for a case the reference
 * data never actually hit.
 */
function pickListPrice(candidates: readonly { price: Decimal; date: string }[]): Decimal | null {
  const byPrice = new Map<string, { price: Decimal; count: number; latestDate: string }>();

  for (const candidate of candidates) {
    const key = candidate.price.toFixed(2);
    const existing = byPrice.get(key);

    if (existing) {
      existing.count += 1;
      if (candidate.date > existing.latestDate) existing.latestDate = candidate.date;
    } else {
      byPrice.set(key, { price: candidate.price, count: 1, latestDate: candidate.date });
    }
  }

  let best: { price: Decimal; count: number; latestDate: string } | null = null;

  for (const entry of byPrice.values()) {
    const better =
      !best ||
      entry.count > best.count ||
      (entry.count === best.count &&
        (entry.latestDate > best.latestDate ||
          (entry.latestDate === best.latestDate && entry.price.lessThan(best.price))));

    if (better) best = entry;
  }

  return best?.price ?? null;
}

/**
 * Parses this period's `wpłata` rows into orders, ready for the split below.
 * Shared between `unmappedSkus` (which only needs the SKUs) and `generate`
 * (which needs everything) so the two never disagree about which rows and
 * which offer entries actually count.
 */
function parseOrders(
  rows: readonly LedgerRow[],
  skip: (reason: string) => void,
  warn?: (message: string) => void,
): Order[] {
  const orders: Order[] = [];

  for (const row of rows) {
    if (!isSaleRow(row)) continue;

    const items = parseOfferItems(row.raw["oferta"]);

    if (!items) {
      warn?.(`Allegro invoice: offer "${row.raw["oferta"] ?? ""}" could not be read, row ${row.sourceRowNumber}`);
      skip("Allegro invoice: offer could not be read");
      continue;
    }

    if (row.occurredOn === null) {
      skip("Allegro invoice: date could not be read");
      continue;
    }

    if (row.gross === null) {
      skip("Allegro invoice: amount could not be read");
      continue;
    }

    if (!row.currency) {
      skip("Allegro invoice: currency not determined");
      continue;
    }

    let delivery: Decimal;

    try {
      delivery = parseAllegroMoney(row.raw["dostawa"] ?? null, "dostawa") ?? new Decimal(0);
    } catch {
      warn?.(`Allegro invoice: delivery "${row.raw["dostawa"]}" could not be read, row ${row.sourceRowNumber}`);
      skip("Allegro invoice: delivery could not be read");
      continue;
    }

    orders.push({
      sourceRowNumber: row.sourceRowNumber,
      occurredOn: row.occurredOn,
      currency: row.currency,
      amount: row.gross,
      delivery,
      items,
    });
  }

  return orders;
}

/** Single-item orders, as `(sku|currency) -> the prices they were sold at`. */
function singleItemPrices(
  orders: readonly Order[],
): Map<string, { price: Decimal; date: string }[]> {
  const candidates = new Map<string, { price: Decimal; date: string }[]>();

  for (const order of orders) {
    if (order.items.length !== 1) continue;

    const item = order.items[0];
    const price = order.amount
      .minus(order.delivery)
      .dividedBy(item.qty)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const key = `${item.sku}|${order.currency}`;
    const list = candidates.get(key);

    if (list) list.push({ price, date: order.occurredOn });
    else candidates.set(key, [{ price, date: order.occurredOn }]);
  }

  return candidates;
}

/**
 * Splits every order into one line per item, in its own native currency.
 *
 * A SKU this month never sold on its own has no reference price of its own,
 * and that used to put it on the invoice at zero while its money went to
 * whatever else was in the order. Earlier months answer the question instead:
 * the nearest one that sold it alone lends its price, and the invoice says
 * which month it borrowed from.
 */
function buildOrderLines(
  orders: readonly Order[],
  history: readonly Order[] = [],
  warn?: (message: string) => void,
): OrderLine[] {
  const listPrice = new Map<string, Decimal>();

  for (const [key, group] of singleItemPrices(orders)) {
    const picked = pickListPrice(group);

    if (picked) listPrice.set(key, picked);
  }

  // Earlier months, newest first, each month judged on its own: a price is the
  // mode of that month, not of everything before this one, so a long-ago
  // repricing cannot outvote what the SKU last actually sold for.
  const byMonth = new Map<string, Order[]>();

  for (const order of history) {
    const month = order.occurredOn.slice(0, 7);
    const list = byMonth.get(month);

    if (list) list.push(order);
    else byMonth.set(month, [order]);
  }

  const months = [...byMonth.keys()].sort().reverse();

  const borrow = (key: string): Decimal | null => {
    for (const month of months) {
      const group = singleItemPrices(byMonth.get(month) ?? []).get(key);
      const picked = group ? pickListPrice(group) : null;

      if (picked) {
        warn?.(
          `Allegro invoice: ${key.split("|")[0]} never sold on its own this month — ` +
            `priced from ${month}, where it did`,
        );

        return picked;
      }
    }

    return null;
  };

  for (const order of orders) {
    if (order.items.length < 2) continue;

    for (const item of order.items) {
      const key = `${item.sku}|${order.currency}`;

      if (listPrice.has(key)) continue;

      const borrowed = borrow(key);

      if (borrowed) listPrice.set(key, borrowed);
    }
  }

  const lines: OrderLine[] = [];

  for (const order of orders) {
    if (order.items.length === 1) {
      const item = order.items[0];

      lines.push({
        currency: order.currency,
        rawSku: item.sku,
        qty: new Decimal(item.qty),
        lineTotal: order.amount,
        occurredOn: order.occurredOn,
      });
      continue;
    }

    const bases = order.items.map(
      (item) => listPrice.get(`${item.sku}|${order.currency}`)?.times(item.qty) ?? new Decimal(0),
    );
    const totalBase = bases.reduce((sum, base) => sum.plus(base), new Decimal(0));
    const totalQty = order.items.reduce((sum, item) => sum + item.qty, 0);

    // One item without a price would otherwise be allocated nothing while the
    // rest of the order absorbed its money — a zero-priced line in Zoho and a
    // neighbouring SKU billed for goods that are not its own. With any price
    // missing, the whole order splits by quantity instead: an assumption, but
    // one that never invents a zero.
    const byQuantity =
      totalBase.isZero() ||
      order.items.some((item) => !listPrice.has(`${item.sku}|${order.currency}`));

    let allocated = new Decimal(0);

    order.items.forEach((item, index) => {
      const isLast = index === order.items.length - 1;
      // The last item takes the remainder rather than its own computed share,
      // so the split always reconciles to the order's real total to the cent
      // — never off by the rounding on every share before it.
      const share = isLast
        ? order.amount.minus(allocated)
        : byQuantity
          ? order.amount
              .times(item.qty)
              .dividedBy(totalQty)
              .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : order.amount
              .times(bases[index])
              .dividedBy(totalBase)
              .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      if (!isLast) allocated = allocated.plus(share);

      lines.push({
        currency: order.currency,
        rawSku: item.sku,
        qty: new Decimal(item.qty),
        lineTotal: share,
        occurredOn: order.occurredOn,
      });
    });
  }

  return lines;
}

function invoiceNumber(periodEnd: string): string {
  const [year, month] = periodEnd.split("-");

  return `INV-Allegro-${month}.${year.slice(2)}`;
}

export function generateAllegroZohoInvoice(
  rows: readonly LedgerRow[],
  context: ReportContext,
): GeneratorResult {
  const skipped = new Map<string, number>();
  const warnings: string[] = [];

  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const orders = parseOrders(rows, skip, (message) => warnings.push(message));
  // Earlier months are read for prices only, so their unreadable rows are not
  // this month's problem: nothing is skipped or warned about on their behalf.
  const history = parseOrders(context.history ?? [], () => {});
  const lines = buildOrderLines(orders, history, (message) => warnings.push(message));

  const productAgg = new Map<string, { qty: Decimal; netEur: Decimal }>();
  const vatAgg = new Map<string, Decimal>();

  // A control total, independent of the per-line conversion above: the raw
  // amounts added together across every currency, PLN and HUF and all,
  // nonsensical as a sum but useful as a magnitude anchor. Every currency
  // Allegro settles in here is worth less than one euro, so a correct
  // conversion can only ever shrink that mixed sum, never grow past it by
  // much — a rate applied backwards (this report's actual production bug:
  // dividing by an already-inverted rate instead of multiplying) inflates it
  // by that rate squared instead, which blows past any reasonable multiple
  // of the raw total. See the fix for the real incident this guards against.
  let rawTotal = new Decimal(0);
  let eurTotal = new Decimal(0);

  for (const line of lines) {
    rawTotal = rawTotal.plus(line.lineTotal);

    const rule = allegroCurrencyRule(context.rules, line.currency);

    // Defensive only: `unmappedCurrencies` below refuses the build first on
    // exactly this condition, from the same rules snapshot.
    if (!rule) {
      skip(`Allegro invoice: currency ${line.currency} has no rule`);
      continue;
    }

    const rate = vatRateOn(context.rules, rule.country, line.occurredOn);

    if (!rate) {
      warnings.push(`Allegro invoice: no VAT rate for ${rule.country}, row dated ${line.occurredOn}`);
      skip(`Allegro invoice: no VAT rate for ${rule.country}`);
      continue;
    }

    const { vat, net } = splitGross(line.lineTotal, rate);

    const fx = context.fx[line.currency];

    if (!fx) {
      // Every euro cent of this report depends on a rate — unlike Amazon's
      // invoice, where a missing rate just leaves one row's exchange-rate
      // cell blank, here it would make the amount itself uncomputable. Refuse
      // the whole build rather than print a wrong or partial total.
      throw new Error(
        `Allegro invoice: no ${line.currency} exchange rate as at ${context.period.end}. ` +
          "Settings -> Exchange rates -> Load full history, then build again.",
      );
    }

    // `fx.rate` (from `euroRateOn`) is already inverted to euros per unit of
    // the currency, so converting into euro multiplies — dividing here would
    // apply the ECB rate backwards.
    const fxRate = new Decimal(fx.rate);
    const netEur = net.times(fxRate);
    const vatEur = vat.times(fxRate);

    eurTotal = eurTotal.plus(netEur).plus(vatEur);

    // VAT is owed on every sale regardless of whether its SKU is one the
    // invoice itself lists — an ignored SKU is a bookkeeping choice, not a
    // tax exemption.
    vatAgg.set(rule.scheme, (vatAgg.get(rule.scheme) ?? new Decimal(0)).plus(vatEur));

    const decision = decideSku(context.rules, "allegro", line.rawSku);

    if (decision.kind === "ignore") {
      skip("Allegro invoice: SKU is on the ignore list");
      continue;
    }

    const existing = productAgg.get(line.rawSku);

    if (existing) {
      existing.qty = existing.qty.plus(line.qty);
      existing.netEur = existing.netEur.plus(netEur);
    } else {
      productAgg.set(line.rawSku, { qty: line.qty, netEur });
    }
  }

  // Every current Allegro currency (PLN, CZK, HUF) is worth well under one
  // euro, so a correct conversion only ever shrinks `rawTotal`, never grows
  // past it — the factor of 5 leaves generous room for a future currency
  // genuinely stronger than the euro without weakening the check on the
  // ones that broke it: a rate applied backwards inflates by roughly its
  // own square, which cleared this bound by several orders of magnitude in
  // the actual incident (HUF alone: ~378² ≈ 143,000x).
  const SANITY_FACTOR = 5;

  if (eurTotal.greaterThan(rawTotal.times(SANITY_FACTOR))) {
    throw new Error(
      `Allegro invoice: total came to €${eurTotal.toFixed(2)}, more than ${SANITY_FACTOR}x the ` +
        `${rawTotal.toFixed(2)} of raw amounts summed across every currency this period (not a ` +
        "real figure, since currencies don't add like that, but a large gap from it means an " +
        "exchange rate or the conversion itself is very likely wrong). Refusing rather than " +
        "printing a total nobody would trust — check Settings -> Exchange rates.",
    );
  }

  const invoiceDate = `${context.period.end} 00:00:00`;
  const invoiceNo = invoiceNumber(context.period.end);
  const output: (string | number | null)[][] = [];

  const productRows = [...productAgg.entries()]
    .map(([rawSku, agg]) => {
      const decision = decideSku(context.rules, "allegro", rawSku);

      return {
        sku: decision.kind === "map" ? decision.targetSku : rawSku,
        itemName: decision.kind === "map" ? decision.itemName : "",
        qty: agg.qty,
        netEur: agg.netEur,
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  for (const product of productRows) {
    // One line, or two a cent apart where no single cent price multiplies back
    // to what the SKU actually came to. See `exactLines`.
    for (const line of exactLines(product.netEur, product.qty)) {
      output.push([
        invoiceDate,
        invoiceNo,
        "Allegro",
        "EUR",
        "1",
        product.itemName,
        product.sku,
        "",
        line.quantity.toFixed(),
        line.price.toFixed(2),
        "Allegro Sales",
      ]);
    }
  }

  for (const scheme of VAT_SCHEME_ORDER) {
    const amount = vatAgg.get(scheme);

    // Omitted, not printed as zero: a scheme nothing sold under this period
    // is not a real line on the invoice.
    if (!amount) continue;

    const label = VAT_LABELS[scheme] ?? `VAT ${scheme}`;

    output.push([
      invoiceDate,
      invoiceNo,
      "Allegro",
      "EUR",
      "1",
      // Item Name and SKU stay empty, and the name goes in Item Desc: Zoho
      // reads Item Name as a lookup into the item list, and there is no
      // product called "VAT PL Regular" — the import fails on the whole file
      // rather than on the line. The Amazon invoice has always written its
      // VAT lines this way.
      "",
      "",
      label,
      "1",
      amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      label,
    ]);
  }

  const sheet: ReportSheet = {
    name: "Allegro invoice for Zoho",
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
 * Distinct Allegro currencies this period's sales settle in that
 * `currency_map` has no rule for — checked before a build the same way an
 * unmapped SKU is, since a currency with no rule can neither pick a VAT rate
 * nor a VAT scheme bucket.
 */
function unmappedCurrencies(rows: readonly LedgerRow[], rules: RulesSnapshot): string[] {
  const found = new Set<string>();

  for (const row of rows) {
    if (!isSaleRow(row)) continue;
    if (!row.currency) continue;
    if (allegroCurrencyRule(rules, row.currency)) continue;

    found.add(row.currency);
  }

  return [...found].sort();
}

/**
 * Distinct Allegro offer IDs this period's sales would invoice under that
 * have no row in SKU mapping yet. Mirrors `parseOrders`'s own row filter
 * rather than sharing it, same reasoning as the Amazon module: a stricter or
 * looser check here would risk silently changing what actually invoices.
 */
function unmappedSkus(rows: readonly LedgerRow[], rules: RulesSnapshot): string[] {
  const found = new Set<string>();

  for (const row of rows) {
    if (!isSaleRow(row)) continue;

    const items = parseOfferItems(row.raw["oferta"]);

    if (!items) continue;

    for (const item of items) {
      if (decideSku(rules, "allegro", item.sku).kind === "passthrough") found.add(item.sku);
    }
  }

  return [...found].sort();
}

export const allegroZohoInvoiceModule: ReportModule = {
  definition: {
    id: "allegro_zoho_invoice",
    label: "Allegro invoice for Zoho",
    datasets: ["allegro"],
    // Dated and numbered by month, like the Amazon invoice — a quarter has no
    // meaning for either.
    granularity: ["month"],
    requiresEveryDataset: true,
    description: "Allegro sales aggregated by SKU into invoice lines for Zoho, converted to EUR.",
    needs: "One Allegro sales report for the month.",
    why:
      "Built without it, that month's Allegro revenue and VAT are simply missing from what Zoho " +
      "sees — not understated, absent.",
    requiredRules: [{ channel: "allegro", key: "currency_map" }],
    // A year back, for reference prices only. A SKU that sells solo at least
    // once a year keeps its own price in a mixed order; one that never does
    // was never priced by this report to begin with.
    historyMonths: 12,
  },
  unmappedSkus,
  unmappedCurrencies,
  generate: generateAllegroZohoInvoice,
};
