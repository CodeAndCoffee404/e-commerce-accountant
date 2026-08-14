import { describe, expect, it } from "vitest";

import { parseEcbFeed } from "./fx";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
                 xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-07-31'>
      <Cube currency='USD' rate='1.0842'/>
      <Cube currency='GBP' rate='0.84255'/>
      <Cube currency='SEK' rate='11.1745'/>
      <Cube currency='PLN' rate='4.2758'/>
      <Cube currency='CZK' rate='25.183'/>
      <Cube currency='HUF' rate='395.28'/>
    </Cube>
    <Cube time='2026-07-30'>
      <Cube currency='USD' rate='1.0855'/>
      <Cube currency='GBP' rate='0.8431'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("parseEcbFeed", () => {
  it("reads every day and every currency", () => {
    const quotes = parseEcbFeed(FEED);

    expect(quotes).toHaveLength(8);
    expect(new Set(quotes.map((quote) => quote.rateDate))).toEqual(
      new Set(["2026-07-31", "2026-07-30"]),
    );
  });

  it("keeps the rate as a string, with nothing lost to a double", () => {
    const quotes = parseEcbFeed(FEED);
    const huf = quotes.find((quote) => quote.quote === "HUF" && quote.rateDate === "2026-07-31");

    expect(huf?.rate).toBe("395.28");
    expect(quotes.find((quote) => quote.quote === "GBP")?.rate).toBe("0.84255");
  });

  it("sets the base — ECB quotes are always against the euro", () => {
    expect(parseEcbFeed(FEED).every((quote) => quote.base === "EUR")).toBe(true);
  });

  it("returns nothing rather than rubbish for an empty or foreign document", () => {
    expect(parseEcbFeed("")).toEqual([]);
    expect(parseEcbFeed("<html><body>Service unavailable</body></html>")).toEqual([]);
  });

  it("survives double quotes and a self-closing day", () => {
    const alternative = `<Cube time="2026-01-02"><Cube currency="USD" rate="1.1"></Cube></Cube>`;

    expect(parseEcbFeed(alternative)).toEqual([
      { rateDate: "2026-01-02", base: "EUR", quote: "USD", rate: "1.1" },
    ]);
  });
});
