import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { loadAccessFor } from "@/lib/access/queries";
import { allows } from "@/lib/access/sections";
import { enterTenant } from "@/lib/db/tenant";
import { log } from "@/lib/log";
import { listTransactions, type TransactionFilters } from "@/lib/transactions/queries";

const COLUMNS = [
  "date",
  "channel",
  "country",
  "period",
  "type",
  "sku",
  "quantity",
  "currency",
  "gross",
  "vat",
  "net",
  "natural_key",
  "needs_attention",
  "attention_reason",
  "source_file",
  "source_row",
] as const;

/**
 * The current filter, as CSV.
 *
 * Excel decides a field is a formula when it starts with `=`, `+`, `-` or `@`,
 * and a SKU or a note beginning with one of those would execute rather than
 * display. Prefixing a tab stops that without changing what the cell reads.
 */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `\t${text}` : text;

  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id || !session.tenantId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Named here rather than by requireUser: a route handler answers the
  // browser directly and never passes through it.
  enterTenant(session.tenantId);

  const access = await loadAccessFor(session.tenantId, session.role);

  if (!allows(access, "transactions", "view")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const url = new URL(request.url);
  const filters: TransactionFilters = {
    dataset: url.searchParams.get("dataset") ?? undefined,
    country: url.searchParams.get("country") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    attention: url.searchParams.get("attention") === "1",
    includeSuperseded: url.searchParams.get("superseded") === "1",
    page: 1,
    // One page, capped. An export is for a period, and a request for the whole
    // ledger at once would be a memory problem rather than a useful file.
    pageSize: 200,
  };

  const page = await listTransactions(session.tenantId, { ...filters, pageSize: 200 });
  const rows: string[] = [COLUMNS.join(",")];

  // Paged through rather than fetched at once, so a large period does not build
  // the whole result set in memory before a single byte is written.
  let current = 1;
  let collected = 0;

  while (collected < page.total) {
    const chunk = await listTransactions(session.tenantId, {
      ...filters,
      page: current,
      pageSize: 200,
    });

    if (chunk.rows.length === 0) break;

    for (const row of chunk.rows) {
      rows.push(
        [
          row.occurredOn,
          row.dataset,
          row.countryCode,
          row.periodLabel,
          row.transactionType,
          row.sku,
          row.quantity,
          row.currency,
          row.gross,
          row.vatAmount,
          row.netAmount,
          row.naturalKey,
          row.needsAttention ? "yes" : "no",
          row.attentionReason,
          row.sourceFilename,
          row.sourceRowNumber,
        ]
          .map(cell)
          .join(","),
      );
    }

    collected += chunk.rows.length;
    current += 1;
  }

  log.info("transactions.exported", {
    tenantId: session.tenantId,
    userId: session.user.id,
    rows: collected,
    filters: Object.fromEntries(url.searchParams),
  });

  const stamp = filters.period ? filters.period.replace(/\s+/g, "-") : "all";

  return new NextResponse(`﻿${rows.join("\r\n")}\r\n`, {
    headers: {
      // BOM and UTF-8: without it Excel on Windows reads accented product names
      // as mojibake.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions-${stamp}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
