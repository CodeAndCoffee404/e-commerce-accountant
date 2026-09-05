import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Filtering source files by channel.
 *
 * The filter used to offer, and match on, the name written into each row when
 * the file arrived. That is a snapshot: rename a channel and the same channel
 * appears twice — its old name on old files, its new one on new — and neither
 * entry selects the other's rows. It is now the channel itself, named on the
 * way out from the one place the rest of the application reads.
 */

const { getDb, schema } = await import("@/lib/db");
const { acrossTenants, withTenant } = await import("@/lib/db/tenant");
const { listUploads, uploadFilterOptions } = await import("@/lib/uploads/queries");
const { DATASET_NAMES } = await import("@/modules/channels/registry");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
const tenants: string[] = [];

/** A company holding one file per channel, labelled the way each was labelled then. */
async function companyWithFiles(): Promise<string> {
  return acrossTenants(async () => {
    const [row] = await getDb()
      .insert(schema.tenants)
      .values({ name: `Uploads ${stamp}` })
      .returning({ id: schema.tenants.id });

    await getDb()
      .insert(schema.sourceFiles)
      .values([
        {
          tenantId: row.id,
          originalFilename: "old.csv",
          sizeBytes: 1,
          sha256: `old-${stamp}`,
          blobKey: `k/old-${stamp}`,
          blobUrl: "https://example.invalid/1",
          dataset: "shopify_geyser",
          // The name the channel had when this file was uploaded.
          datasetLabel: "Shopify Geyser",
          status: "parsed",
        },
        {
          tenantId: row.id,
          originalFilename: "new.csv",
          sizeBytes: 1,
          sha256: `new-${stamp}`,
          blobKey: `k/new-${stamp}`,
          blobUrl: "https://example.invalid/2",
          dataset: "shopify_geyser",
          datasetLabel: "Shopify EU",
          status: "parsed",
        },
        {
          tenantId: row.id,
          originalFilename: "other.csv",
          sizeBytes: 1,
          sha256: `oth-${stamp}`,
          blobKey: `k/oth-${stamp}`,
          blobUrl: "https://example.invalid/3",
          dataset: "allegro",
          datasetLabel: "Allegro",
          status: "parsed",
        },
      ]);

    tenants.push(row.id);

    return row.id;
  });
}

describe.skipIf(!HAS_DB)("the source files filter", () => {
  afterAll(
    inRequest(async () => {
      for (const id of tenants) {
        await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
    }),
  );

  it("offers each channel once, whatever it was called at the time", async () => {
    const id = await companyWithFiles();

    const options = await withTenant(id, () => uploadFilterOptions(id));

    // Two channels, not three: the two Shopify files are the same channel
    // under two names, and offering both is offering a choice that does not
    // exist.
    expect(options.datasets).toEqual(["allegro", "shopify_geyser"]);
  });

  it("selects every file of a channel, including ones labelled with its old name", async () => {
    const id = await companyWithFiles();

    const rows = await withTenant(id, () =>
      listUploads(id, { dataset: "shopify_geyser" }).then((page) => page.map((row) => row.filename)),
    );

    expect(rows.sort()).toEqual(["new.csv", "old.csv"]);
  });

  it("names the channel the way the rest of the application does", () => {
    // The label the filter and the table both show. If this changes, both
    // change together — which is the point of taking it from here.
    expect(DATASET_NAMES.shopify_geyser).toBe("Shopify EU");
  });
});
