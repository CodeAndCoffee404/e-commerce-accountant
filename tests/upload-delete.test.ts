import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The action is a Server Action: it asks who is calling, writes an audit row
// against a real user, touches Blob storage and revalidates pages. None of that
// is what this test is about, so it is all stubbed and the database work — the
// part that is genuinely intricate — runs for real.
const session = { tenantId: "", userId: "test-user" };

// Signed in, and nothing else about access stubbed: the action asks the real
// permission code what an owner may do, and `requireUser` names the company
// for the queries below, exactly as it does in a request.
vi.mock("@/auth", () => ({
  auth: async () => ({
    user: { id: session.userId, name: "Test", email: "test@example.invalid", image: null },
    tenantId: session.tenantId,
    role: "owner" as const,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@vercel/blob", () => ({ del: async () => undefined }));
vi.mock("@/lib/audit/record", () => ({ record: async () => undefined }));

const { getDb, schema } = await import("@/lib/db");
const { classify } = await import("@/lib/ingest/classify");
const { parseSpreadsheet } = await import("@/lib/ingest/parse");
const { availablePeriods } = await import("@/lib/reports/queries");
const { ingestSourceFile } = await import("@/lib/uploads/ingest");
const { deleteUpload } = await import("@/lib/uploads/delete");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const FIXTURE = "tests/fixtures/from-csv/Allegro sales report - 2026.07 July.csv";
const PERIOD = "2026.07 July";

describe.skipIf(!HAS_DB)("deleting an upload", () => {
  // A function, not a handle: `describe.skipIf` still runs this body to collect
  // its tests, so opening the connection here would throw before the skip
  // could take effect — which is how these suites came to fail on a checkout
  // with no connection string instead of skipping. Called only from inside a
  // test that is really running.
  const db = () => getDb();

  beforeAll(inRequest(async () => {
    const [tenant] = await db()
      .insert(schema.tenants)
      .values({ name: "Delete test", slug: `del-${process.pid}` })
      .returning({ id: schema.tenants.id });

    session.tenantId = tenant.id;
  }));

  afterAll(inRequest(async () => {
    if (session.tenantId) {
      await db().delete(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
    }
  }));

  /** Uploads the same fixture again, salting the checksum so it is not a duplicate. */
  async function upload(salt: string) {
    const file = path.resolve(process.cwd(), FIXTURE);
    const bytes = readFileSync(file);
    const filename = `${path.basename(file)}${salt}`;
    const parsed = await parseSpreadsheet(bytes, path.basename(file));

    if (!parsed.ok) throw new Error(parsed.message);

    const classified = classify(parsed.grid, path.basename(file));

    if (!classified.ok) throw new Error(classified.message);

    const [row] = await db()
      .insert(schema.sourceFiles)
      .values({
        tenantId: session.tenantId,
        originalFilename: filename,
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).update(salt).digest("hex"),
        blobKey: `test/${filename}`,
        blobUrl: "https://example.invalid/test",
        dataset: classified.dataset,
        datasetLabel: classified.label,
        countryCode: classified.country,
        periodLabel: classified.period.label,
        periodStart: classified.period.start,
        periodEnd: classified.period.end,
        periodGranularity: classified.period.granularity,
        headerRowIndex: classified.headerRowIndex,
        status: "classified",
      })
      .returning({ id: schema.sourceFiles.id });

    const ingested = await ingestSourceFile(row.id, session.tenantId, parsed.grid);

    return { id: row.id, filename, rows: ingested.inserted };
  }

  function currentRows(fileId: string) {
    return db()
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.sourceFileId, fileId),
          eq(schema.transactions.isCurrent, true),
        ),
      );
  }

  it("puts the replaced upload back when the replacement is deleted", inRequest(async () => {
    const first = await upload("-first");
    const second = await upload("-second");

    // The second replaced the first, which is what makes this worth testing:
    // deleting the second must not leave the period with nothing counting.
    expect(await currentRows(first.id)).toHaveLength(0);
    expect(await currentRows(second.id)).toHaveLength(second.rows);

    const result = await deleteUpload(second.id);

    expect(result.ok).toBe(true);
    expect(result.message).toContain(first.filename);

    const [gone] = await db()
      .select({ id: schema.sourceFiles.id })
      .from(schema.sourceFiles)
      .where(eq(schema.sourceFiles.id, second.id));

    expect(gone).toBeUndefined();

    const [restored] = await db()
      .select({
        status: schema.sourceFiles.status,
        supersededBy: schema.sourceFiles.supersededByFileId,
      })
      .from(schema.sourceFiles)
      .where(eq(schema.sourceFiles.id, first.id));

    expect(restored.status).toBe("parsed");
    expect(restored.supersededBy).toBeNull();
    expect(await currentRows(first.id)).toHaveLength(first.rows);

    await deleteUpload(first.id);
  }));

  it("restores nothing when a middle link of the chain is deleted", inRequest(async () => {
    // A replaced B replaced C is the history of one period corrected twice.
    // Deleting B — already replaced itself — must not resurrect A: C still
    // counts, and a period with two current files reports every figure twice.
    const a = await upload("-chain-a");
    const b = await upload("-chain-b");
    const c = await upload("-chain-c");

    expect(await currentRows(c.id)).toHaveLength(c.rows);

    const result = await deleteUpload(b.id);

    expect(result.ok).toBe(true);
    // Nothing "counts again" — the message must not claim a restore happened.
    expect(result.message).toBe("Deleted.");

    // C is untouched, A is still out of play.
    expect(await currentRows(c.id)).toHaveLength(c.rows);
    expect(await currentRows(a.id)).toHaveLength(0);

    const [first] = await db()
      .select({
        status: schema.sourceFiles.status,
        supersededBy: schema.sourceFiles.supersededByFileId,
      })
      .from(schema.sourceFiles)
      .where(eq(schema.sourceFiles.id, a.id));

    // A now records the file that actually holds the period, not the ghost.
    expect(first.status).toBe("superseded");
    expect(first.supersededBy).toBe(c.id);

    // And deleting the current file still hands the period back down the
    // chain: with B gone, that is A.
    const afterC = await deleteUpload(c.id);

    expect(afterC.ok).toBe(true);
    expect(afterC.message).toContain(a.filename);
    expect(await currentRows(a.id)).toHaveLength(a.rows);

    await deleteUpload(a.id);
  }));

  it("refuses while a report was built from the file, and names it", inRequest(async () => {
    const file = await upload("-used");

    const [run] = await db()
      .insert(schema.reportRuns)
      .values({
        tenantId: session.tenantId,
        reportType: "off_amazon_sales",
        periodLabel: PERIOD,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        status: "succeeded",
      })
      .returning({ id: schema.reportRuns.id });

    await db()
      .insert(schema.reportRunSources)
      .values({ tenantId: session.tenantId, reportRunId: run.id, sourceFileId: file.id });

    const refused = await deleteUpload(file.id);

    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("Off-Amazon Sales");
    expect(refused.message).toContain(PERIOD);

    // Still there, still counting.
    expect(await currentRows(file.id)).toHaveLength(file.rows);

    // And once the report goes, the file can go too.
    await db().delete(schema.reportRuns).where(eq(schema.reportRuns.id, run.id));

    const allowed = await deleteUpload(file.id);

    expect(allowed.ok).toBe(true);
    expect(await currentRows(file.id)).toHaveLength(0);
  }));

  it("takes the period off the report cards once its last file is gone", inRequest(async () => {
    const file = await upload("-last");

    let state = await availablePeriods(session.tenantId);
    expect(state.off_amazon_sales.blocked).toEqual([
      { period: PERIOD, missing: ["Cdiscount", "Shopify Geyser"], endsOn: null },
    ]);

    await deleteUpload(file.id);

    state = await availablePeriods(session.tenantId);
    expect(state.off_amazon_sales.ready).toEqual([]);
    expect(state.off_amazon_sales.blocked).toEqual([]);
  }));
}, 300_000);
