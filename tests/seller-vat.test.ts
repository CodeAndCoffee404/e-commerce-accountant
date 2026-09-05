import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { Period } from "@/lib/ingest/period";
import { sellerVatOn } from "@/lib/reports/rules";
import type { LedgerRow, ReportContext, RulesSnapshot } from "@/lib/reports/types";
import { GEYSER } from "@/modules/companies/geyser";
import { generateOffAmazonSales, OFF_AMAZON_HEADERS } from "@/modules/reports/off-amazon-sales";

/**
 * Whose VAT number a report prints.
 *
 * It used to be a literal inside the channel modules, which meant every company
 * created from a profile started life holding Geyser's registrations and would
 * have printed them on its first report with nothing to notice. The number now
 * comes from the company's own registrations, looked up by where the sale is
 * taxed and the regime it is reported under.
 */

const PERIOD: Period = {
  label: "2026.06 June",
  granularity: "month",
  start: "2026-06-01",
  end: "2026-06-30",
};

const VAT_COLUMN = OFF_AMAZON_HEADERS.indexOf("seller VAT number");

function rules(overrides: Partial<RulesSnapshot> = {}): RulesSnapshot {
  return {
    vatRates: [{ country: "PL", rate: "23", validFrom: "2020-01-01", validTo: null }],
    sellerVatNumbers: [
      {
        country: "PL",
        scheme: "REGULAR",
        vatNumber: "PL5263307678",
        validFrom: "2020-01-01",
        validTo: null,
      },
      {
        country: "EE",
        scheme: "UNION-OSS",
        vatNumber: "EE102013089",
        validFrom: "2020-01-01",
        validTo: null,
      },
    ],
    skuMappings: [],
    channelRules: [
      {
        channel: "allegro",
        key: "currency_map",
        value: { PLN: { country: "PL", scheme: "REGULAR" } },
      },
      {
        channel: "allegro",
        key: "operation_types",
        value: { "wpłata": "B2C SALE", zwrot: "REFUND" },
      },
    ],
    ...overrides,
  };
}

function context(snapshot: RulesSnapshot): ReportContext {
  return { period: PERIOD, rules: snapshot, fx: {}, company: GEYSER };
}

function allegroRow(): LedgerRow {
  return {
    id: "allegro-1",
    dataset: "allegro",
    channel: "allegro",
    countryCode: null,
    occurredOn: "2026-06-15",
    transactionType: "SALE",
    currency: "PLN",
    gross: new Decimal("123"),
    vatAmount: null,
    netAmount: null,
    sku: null,
    quantity: null,
    sourceFileId: "file",
    sourceRowNumber: 1,
    raw: { operacja: "wpłata", "kupujący": "a buyer is present" },
  };
}

describe("looking up the company's own registration", () => {
  it("takes a REGULAR number from the country the sale is taxed in", () => {
    expect(sellerVatOn(rules(), { scheme: "REGULAR", country: "PL" }, "2026-06-15")).toBe(
      "PL5263307678",
    );
  });

  it("takes the one-stop number whatever country the goods went to", () => {
    // The point of the shape: one-stop is registered in a single member state
    // and covers every distance sale, so there is no such thing as "the OSS
    // registration of Czechia" to ask for.
    expect(sellerVatOn(rules(), { scheme: "UNION-OSS" }, "2026-06-15")).toBe("EE102013089");
  });

  it("does not hand back a number from the other regime", () => {
    // The failure this exists to prevent: a local registration standing in for
    // a one-stop one is as plausible-looking on an invoice as the right number,
    // and would be found by a tax office rather than by us.
    const onlyRegular = rules({
      sellerVatNumbers: [
        {
          country: "PL",
          scheme: "REGULAR",
          vatNumber: "PL5263307678",
          validFrom: "2020-01-01",
          validTo: null,
        },
      ],
    });

    expect(sellerVatOn(onlyRegular, { scheme: "UNION-OSS" }, "2026-06-15")).toBeNull();
    expect(sellerVatOn(onlyRegular, { scheme: "REGULAR", country: "CZ" }, "2026-06-15")).toBeNull();
  });

  it("prints the registration that was in force in the month being reported", () => {
    const changed = rules({
      sellerVatNumbers: [
        {
          country: "PL",
          scheme: "REGULAR",
          vatNumber: "PL-OLD",
          validFrom: "2020-01-01",
          validTo: "2026-05-31",
        },
        {
          country: "PL",
          scheme: "REGULAR",
          vatNumber: "PL-NEW",
          validFrom: "2026-06-01",
          validTo: null,
        },
      ],
    });

    expect(sellerVatOn(changed, { scheme: "REGULAR", country: "PL" }, "2026-05-20")).toBe("PL-OLD");
    expect(sellerVatOn(changed, { scheme: "REGULAR", country: "PL" }, "2026-06-15")).toBe("PL-NEW");
  });
});

describe("Off-Amazon Sales and the seller's number", () => {
  it("prints the company's own registration", () => {
    const result = generateOffAmazonSales([allegroRow()], context(rules()));

    expect(result.sheets[0].rows).toHaveLength(1);
    expect(result.sheets[0].rows[0][VAT_COLUMN]).toBe("PL5263307678");
  });

  it("stops the row rather than printing somebody else's number", () => {
    // A company that holds no Polish registration: the row is refused, by name,
    // instead of falling back to whichever number the seed data happened to
    // carry — which is exactly what a second company used to inherit.
    const none = rules({ sellerVatNumbers: [] });
    const result = generateOffAmazonSales([allegroRow()], context(none));

    expect(result.sheets[0].rows).toHaveLength(0);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      "Allegro: no REGULAR VAT registration in PL",
    ]);
    expect(result.warnings.join(" ")).toContain("REGULAR VAT registration in PL");
  });
});

describe("what a new company is seeded with", () => {
  it("carries no VAT number in its channel-rule seeds", () => {
    // The numbers a report prints used to live in the channel-rule seeds, which
    // every company is handed wholesale on its first day — so a second company
    // inherited the first one's registrations and nothing said so. Every number
    // the seeds know is looked for in the seeded rules, so putting one back
    // into a channel module fails here rather than in a client's books.
    const known = GEYSER.seeds.sellerVatNumbers.map((entry) => entry.vatNumber);

    expect(known.length).toBeGreaterThan(0);

    const seeded = JSON.stringify(GEYSER.seeds.channelRules);

    for (const number of known) {
      expect(seeded.includes(number), `the channel-rule seeds carry ${number}`).toBe(false);
    }
  });

  it("gives every registration a scheme, since that is half of what finds it", () => {
    for (const entry of GEYSER.seeds.sellerVatNumbers) {
      expect(["REGULAR", "UNION-OSS"], entry.vatNumber).toContain(entry.scheme);
    }
  });
});
