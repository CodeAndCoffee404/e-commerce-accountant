import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres' own answer to "whose row is this?".
 *
 * Every table below that carries a company gets this policy, and the answer
 * stops depending on the query remembering to ask. A statement that has not
 * named a company sees no rows at all — not an error, not somebody else's:
 * `current_setting(…, true)` yields NULL when unset, the comparison is NULL,
 * and NULL is not true. Failing closed is the whole point.
 *
 * The `nullif` is not decoration. A setting made with `set_config(…, true)`
 * reverts when its transaction ends — to the empty string, not to NULL, once
 * the connection has seen it at all. Casting that empty string to uuid raises
 * an error rather than matching nothing, so every query on a reused connection
 * would fail instead of returning nothing. The test that found this is
 * tests/tenant-isolation.test.ts.
 *
 * The company is named per transaction by `withTenant` in `src/lib/db/tenant.ts`,
 * and `acrossTenants` there is the one deliberate way past this, for the three
 * places that genuinely span companies.
 */
const OWN_COMPANY = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on'`;

function tenantIsolation() {
  return pgPolicy("tenant_isolation", { for: "all", using: OWN_COMPANY, withCheck: OWN_COMPANY });
}


/* ------------------------------------------------------------------ *
 * Auth.js tables
 *
 * Shapes are dictated by @auth/drizzle-adapter. `sessions` is unused
 * while the JWT strategy is active but kept so switching to database
 * sessions later needs no migration.
 * ------------------------------------------------------------------ */



export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  /**
   * Above the companies rather than inside one.
   *
   * Not a role: roles say what a person may do in a company they belong to,
   * and this says they may see the list of companies at all and step into any
   * of them. Nobody grants it from inside a company, which is the point.
   */
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/* ------------------------------------------------------------------ *
 * Tenancy
 * ------------------------------------------------------------------ */

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "accountant",
  "viewer",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * What this company is called, and nothing more than that.
   *
   * Its own owner changes it — a company is renamed, bought, or was simply
   * typed in wrong — so nothing may be keyed to it. Everything that has to
   * point at a company points at `id`: the rows it owns, the folders its files
   * live under, who may come in. Two companies may share a name; they are
   * still two companies.
   */
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * When this company was closed, or null while it is open.
   *
   * Closed means read-only: its people sign in and read what is already there,
   * and nothing writes — no uploads, no reports built, no settings changed,
   * and the nightly job passes it by. A date rather than a flag because the
   * useful question a year later is when, not whether.
   */
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index("memberships_user_idx").on(table.userId),
    tenantIsolation(),
  ],
);

export const sectionAccess = pgEnum("section_access", ["none", "view", "edit"]);

/**
 * What each role may do with each section of the app, set by the owner.
 *
 * Only deviations from the built-in defaults are stored — see
 * `lib/access/sections.ts` — so a section added to the app later starts at its
 * default rather than at "no access", and the table stays readable: a row here
 * is a decision somebody made.
 *
 * The section is text rather than an enum because the list of sections belongs
 * to the application, and adding a screen should not need a migration.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    section: text("section").notNull(),
    access: sectionAccess("access").notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.role, table.section] }),
    tenantIsolation(),
  ],
);

/**
 * Sign-in allowlist. Google authenticates the person; this table decides
 * whether that person may enter, and which tenant they land in.
 */
export const allowedEmails = pgTable(
  "allowed_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: membershipRole("role").notNull().default("accountant"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Per company, not globally. One person can be invited to two companies —
    // an accountant who keeps the books for both — and the switcher exists for
    // exactly that. Globally unique was the old assumption that one address
    // meant one company.
    uniqueIndex("allowed_emails_tenant_email_idx").on(table.tenantId, table.email),
    tenantIsolation(),
  ],
);

/* ------------------------------------------------------------------ *
 * Accounting periods
 *
 * A period exists before anything is uploaded into it. That is the whole
 * point: on the first of the month the month opens, and the checklist for it
 * is visible and empty rather than absent. Until this table existed a period
 * was only ever a side effect of a file arriving, so a month nobody had sent
 * files for simply did not appear anywhere.
 * ------------------------------------------------------------------ */

export const periodGranularity = pgEnum("period_granularity", [
  "month",
  "quarter",
  "year",
]);

/**
 * Closing is a statement, not a lock. Late files are a fact of this business —
 * a marketplace reissues an export weeks later — and refusing them would push
 * the correction outside the system, where nothing traces it. So a closed
 * period still accepts uploads; what it stops doing is asking for them.
 */
export const periodStatus = pgEnum("period_status", ["open", "closed"]);

/**
 * Where the period came from. `schedule` is the calendar opening it on the
 * first; `upload` is a back-dated file arriving for a period nobody opened;
 * `manual` is someone adding one by hand. Worth keeping apart: a period with
 * no origin but `upload` means the schedule is not running.
 */
export const periodOrigin = pgEnum("period_origin", ["schedule", "upload", "manual"]);

export const periods = pgTable(
  "periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    /** `2026.07 July`, `2026.Q3`, `2026.Y` — legacy's wording where it has one. */
    label: text("label").notNull(),
    granularity: periodGranularity("granularity").notNull(),
    /** ISO calendar dates, inclusive, as the rest of the ledger keeps them. */
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),

    status: periodStatus("status").notNull().default("open"),
    origin: periodOrigin("origin").notNull().default("schedule"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    // The label is the period's identity, and the schedule leans on that: it
    // opens periods with ON CONFLICT DO NOTHING, so a missed run catching up
    // and a run that already happened are the same operation.
    uniqueIndex("periods_label_idx").on(table.tenantId, table.label),
    // Periods are ordered by when they start, never by their label: '2026.Y'
    // and '2026.Q3' sort before '2026.07 July' as text, which would interleave
    // a year with the months inside it.
    index("periods_start_idx").on(table.tenantId, table.startDate),
    tenantIsolation(),
  ],
);

export type PeriodRow = typeof periods.$inferSelect;
export type PeriodGranularity = (typeof periodGranularity.enumValues)[number];

/* ------------------------------------------------------------------ *
 * Uploaded files
 * ------------------------------------------------------------------ */

export const datasetId = pgEnum("dataset_id", [
  "amazon_vat",
  "amazon_monthly",
  "allegro",
  "cdiscount",
  "cdiscount_orders",
  "shopify_geyser",
  "shopify_waterlift",
]);

export const sourceFileStatus = pgEnum("source_file_status", [
  "received",
  "classified",
  "parsed",
  "superseded",
  "rejected",
]);

export const sourceFiles = pgTable(
  "source_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes").notNull(),
    /** Hex digest. Re-uploading the same bytes is rejected, see the index below. */
    sha256: text("sha256").notNull(),
    blobKey: text("blob_key").notNull(),
    blobUrl: text("blob_url").notNull(),

    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),

    dataset: datasetId("dataset"),
    /** Legacy's own wording, because report selection matches on it verbatim. */
    datasetLabel: text("dataset_label"),
    countryCode: text("country_code"),

    /**
     * The period this file belongs to. The label and dates below stay as they
     * are: they are what the classifier read out of the file itself, and the
     * whole ledger — reports, dedup, the drill-down — matches on them. This
     * column adds the other direction, so a period can be asked what it holds
     * without matching text.
     *
     * `restrict` rather than `cascade`: a period holding files is not
     * something to delete by accident, and the database is the right place to
     * say so.
     */
    periodId: uuid("period_id").references(() => periods.id, { onDelete: "restrict" }),
    periodLabel: text("period_label"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    periodGranularity: periodGranularity("period_granularity"),

    headerRowIndex: integer("header_row_index"),
    /** Delimiter, encoding, marketplace, how the period was found. */
    detectionMeta: jsonb("detection_meta"),

    status: sourceFileStatus("status").notNull().default("received"),
    supersededByFileId: uuid("superseded_by_file_id"),
    rejectCode: text("reject_code"),
    rejectMessage: text("reject_message"),
  },
  (table) => [
    // Deduplication by content: the same bytes are never recorded twice.
    uniqueIndex("source_files_sha_idx").on(table.tenantId, table.sha256),
    // The slice (tenant, dataset, country, period) is the unit of replacement,
    // see PLAN §2.1.
    index("source_files_slice_idx").on(
      table.tenantId,
      table.dataset,
      table.countryCode,
      table.periodLabel,
    ),
    index("source_files_uploaded_idx").on(table.tenantId, table.uploadedAt),
    tenantIsolation(),
  ],
);

/* ------------------------------------------------------------------ *
 * Transaction ledger
 * ------------------------------------------------------------------ */

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
    /** 1-based row in the source file, so any figure leads back to its line. */
    sourceRowNumber: integer("source_row_number").notNull(),

    dataset: datasetId("dataset").notNull(),
    channel: text("channel").notNull(),
    countryCode: text("country_code"),

    // Inherited from the file, not derived per row: reports select by the
    // period assigned at upload, exactly as legacy does. See PLAN §4.
    periodLabel: text("period_label").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),

    /** The channel's own identifier. Indexed for search, never for dedup. */
    naturalKey: text("natural_key"),

    occurredOn: date("occurred_on"),
    transactionType: text("transaction_type"),

    currency: text("currency"),
    // numeric, never float: a cent lost to binary rounding is a cent that has
    // to be explained to an accountant.
    gross: numeric("gross", { precision: 18, scale: 6 }),
    vatAmount: numeric("vat_amount", { precision: 18, scale: 6 }),
    netAmount: numeric("net_amount", { precision: 18, scale: 6 }),
    vatRate: numeric("vat_rate", { precision: 9, scale: 6 }),

    departureCountry: text("departure_country"),
    arrivalCountry: text("arrival_country"),
    sellerVatNumber: text("seller_vat_number"),
    buyerVatNumber: text("buyer_vat_number"),
    taxScheme: text("tax_scheme"),

    sku: text("sku"),
    quantity: numeric("quantity", { precision: 18, scale: 6 }),

    needsAttention: boolean("needs_attention").notNull().default(false),
    attentionReason: text("attention_reason"),

    /**
     * False once a later upload for the same slice supersedes this row.
     * Nothing is deleted: the drill-down from an old report has to keep
     * working, and so does the audit trail.
     */
    isCurrent: boolean("is_current").notNull().default(true),

    raw: jsonb("raw"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("transactions_slice_idx").on(
      table.tenantId,
      table.dataset,
      table.countryCode,
      table.periodStart,
      table.isCurrent,
    ),
    index("transactions_natural_key_idx").on(table.tenantId, table.naturalKey),
    // The shape of every read that matters: reports load a period's current
    // rows, the dashboard counts them, the ledger pages filter by them.
    index("transactions_period_idx").on(table.tenantId, table.periodLabel, table.isCurrent),
    index("transactions_file_idx").on(table.sourceFileId),
    tenantIsolation(),
  ],
);

/* ------------------------------------------------------------------ *
 * Reference data
 *
 * Rates, registrations and mappings are rows, not constants in code. Otherwise
 * a VAT change or a new SKU means a developer has to edit and deploy.
 * ------------------------------------------------------------------ */

/**
 * `validTo` is null while a rate is in force. Periods exist so a past month
 * recalculates at the rate that applied then — not as an audit trail, which
 * the plan deliberately leaves out.
 */
export const vatRates = pgTable(
  "vat_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    country: text("country").notNull(),
    /** Percent, so 20 means 20 %. */
    rate: numeric("rate", { precision: 9, scale: 4 }).notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    note: text("note"),
  },
  (table) => [
    // One rate per country and start date. Without this constraint a repeat
    // seed found no conflict to skip and duplicated every rate.
    uniqueIndex("vat_rates_period_idx").on(table.tenantId, table.country, table.validFrom),
    tenantIsolation(),
  ],
);

export const sellerVatNumbers = pgTable(
  "seller_vat_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    country: text("country").notNull(),
    /**
     * Which regime this registration is used under: `REGULAR` for a number the
     * company is registered with in that country, `UNION-OSS` for the one-stop
     * registration it reports distance sales under.
     *
     * The pair decides the number a report prints, which is why it is here and
     * not merely in the note: a company can hold both a local registration and
     * an OSS one, and the same sale takes one or the other depending on where
     * it went.
     */
    scheme: text("scheme").notNull().default("REGULAR"),
    vatNumber: text("vat_number").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("seller_vat_period_idx").on(
      table.tenantId,
      table.country,
      table.scheme,
      table.validFrom,
    ),
    tenantIsolation(),
  ],
);

export const skuMappings = pgTable(
  "sku_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    sourceSku: text("source_sku").notNull(),
    /**
     * The item name the source is expected to carry alongside that code — a
     * checksum, not a second key. Empty means the channel does not report a
     * name worth checking, which is every channel but Shopify.
     *
     * It is part of the unique key because a code alone is not always one
     * product: Shopify sells two different items under
     * `QE-5795-1Z7V-stickerless`, and they have to be two rows billed as two
     * things rather than one row that silently swallows the other.
     */
    sourceName: text("source_name").notNull().default(""),
    targetSku: text("target_sku"),
    itemName: text("item_name"),
    /** Connectors and packaging: sold, but never invoiced through Zoho. */
    isIgnored: boolean("is_ignored").notNull().default(false),
  },
  (table) => [
    uniqueIndex("sku_mappings_source_idx").on(
      table.tenantId,
      table.channel,
      table.sourceSku,
      table.sourceName,
    ),
    tenantIsolation(),
  ],
);

/**
 * Everything else a channel needs to be read correctly: which country a
 * currency implies, which arrival countries are skipped, what the default
 * scheme is. Kept as JSON because the shape differs per channel and the
 * alternative is a table per rule.
 */
export const channelRules = pgTable(
  "channel_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    note: text("note"),
  },
  (table) => [uniqueIndex("channel_rules_key_idx").on(table.tenantId, table.channel, table.key),
    tenantIsolation(),
  ],
);

/**
 * European Central Bank reference rates, cached.
 *
 * Not tenant-scoped: a published reference rate is the same fact for everyone,
 * and duplicating it per tenant would let two tenants disagree about what the
 * ECB said on a given day.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    rateDate: date("rate_date").notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    /** Units of `quote` for one unit of `base`. */
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    source: text("source").notNull().default("ecb"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.rateDate, table.base, table.quote] })],
);

/* ------------------------------------------------------------------ *
 * Audit log
 * ------------------------------------------------------------------ */

/**
 * Who did what, kept for the life of the tenant.
 *
 * An accounting system has to answer "who changed this rate, and when" — the
 * reference tables deliberately keep no history of their own, so this is where
 * that question is answered. Entries are written, never edited or removed.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Kept even if the user is later removed, so the trail does not break. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    userEmail: text("user_email"),

    /** `upload.registered`, `report.built`, `vat_rate.saved`, … */
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    /** What changed, enough to understand the entry without another query. */
    payload: jsonb("payload"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_tenant_idx").on(table.tenantId, table.createdAt),
    tenantIsolation(),
  ],
);

export type AuditEntry = typeof auditLog.$inferSelect;

/* ------------------------------------------------------------------ *
 * Google Drive connection
 * ------------------------------------------------------------------ */

export const googleConnectionStatus = pgEnum("google_connection_status", [
  "connected",
  "needs_folder",
  "revoked",
  "error",
]);

/**
 * The client's own Drive, connected once and used for every report after.
 *
 * The scope is `drive.file`, which needs no review from Google but grants
 * access only to files this app created or that the user picked explicitly.
 * That is why the folder is chosen through Google's picker rather than by
 * pasting an id: an id alone carries no permission.
 */
export const googleConnections = pgTable(
  "google_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    googleAccountEmail: text("google_account_email").notNull(),
    /** AES-256-GCM, `v1:` prefixed. Never leaves the server in clear. */
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    scope: text("scope").notNull(),

    rootFolderId: text("root_folder_id"),
    rootFolderName: text("root_folder_name"),

    status: googleConnectionStatus("status").notNull().default("needs_folder"),
    lastError: text("last_error"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    connectedBy: text("connected_by").references(() => users.id, { onDelete: "set null" }),
  },
  // One Drive per tenant: two would make "where did the report go" ambiguous.
  (table) => [uniqueIndex("google_connections_tenant_idx").on(table.tenantId),
    tenantIsolation(),
  ],
);

export type GoogleConnection = typeof googleConnections.$inferSelect;

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export const reportType = pgEnum("report_type", [
  "sales_by_currency",
  "off_amazon_sales",
  "amazon_zoho_invoice",
  "allegro_zoho_invoice",
  "shopify_zoho_invoice",
]);

export const reportStatus = pgEnum("report_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

/**
 * A report as a task, not a file.
 *
 * The snapshots are the point: regenerating a period has to give the same
 * numbers, and it will not if the rates or the exchange rate have moved since.
 * What the run used is recorded with it.
 */
export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    reportType: reportType("report_type").notNull(),
    /**
     * For report types that come in tenant-defined variants (custom slices):
     * the key of the definition this run was built from. The definition itself
     * is in rules_snapshot, so the run stays explainable after an edit.
     */
    variant: text("variant"),
    /** The period built, alongside the copy of its bounds the run was made under. */
    periodId: uuid("period_id").references(() => periods.id, { onDelete: "restrict" }),
    periodLabel: text("period_label").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),

    status: reportStatus("status").notNull().default("queued"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),

    /** The rules and the rates as they stood when the report was built. */
    rulesSnapshot: jsonb("rules_snapshot"),
    fxSnapshot: jsonb("fx_snapshot"),
    /** Rows in, rows out, what was skipped and why. */
    stats: jsonb("stats"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("report_runs_lookup_idx").on(
      table.tenantId,
      table.reportType,
      table.periodLabel,
      table.createdAt,
    ),
    tenantIsolation(),
  ],
);

/**
 * Which uploads fed a run — the "sources" line of the report card.
 *
 * The tenant is repeated here although both ends of the row already carry it.
 * It is not for the queries, which reach these rows through their run: it is so
 * that the row can be checked on its own. A rule that says "this row belongs to
 * that company" cannot be written against a column the table does not have, and
 * a join is a place the check can be forgotten.
 */
export const reportRunSources = pgTable(
  "report_run_sources",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reportRunId: uuid("report_run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.reportRunId, table.sourceFileId] }),
    index("report_run_sources_tenant_idx").on(table.tenantId, table.sourceFileId),
    tenantIsolation(),
  ],
);

export const artifactKind = pgEnum("artifact_kind", ["xlsx", "gsheet"]);
export const driveStatus = pgEnum("drive_status", ["pending", "synced", "failed"]);

/**
 * A file a run produced. The tenant is carried here for the same reason as on
 * `report_run_sources`: an artifact is fetched by its own id, and the check
 * that it is this company's should not depend on remembering to join.
 */
export const reportArtifacts = pgTable(
  "report_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reportRunId: uuid("report_run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),

    kind: artifactKind("kind").notNull(),
    filename: text("filename").notNull(),
    blobKey: text("blob_key"),
    sizeBytes: integer("size_bytes"),

    driveFileId: text("drive_file_id"),
    driveUrl: text("drive_url"),
    driveStatus: driveStatus("drive_status"),
    driveSyncedAt: timestamp("drive_synced_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("report_artifacts_run_idx").on(table.reportRunId),
    index("report_artifacts_tenant_idx").on(table.tenantId),
    tenantIsolation(),
  ],
);

/**
 * The rule that turns a filed period into a statutory deadline, one row per
 * (report, periodicity) a tenant actually files.
 *
 * A rule, not a date: the tenant sets "the 5th of the following month" once,
 * and every period — past, present and future — is due on it. Editing a rule
 * changes every period's deadline the moment it is read, because nothing
 * stores the computed date; see `computeDeadline`.
 */
export const reportDeadlines = pgTable(
  "report_deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    reportType: reportType("report_type").notNull(),
    granularity: periodGranularity("granularity").notNull(),

    /** 1-31. Clamped to the target month's last day when it does not exist. */
    deadlineDay: integer("deadline_day").notNull(),
    /** 1-12. Only meaningful — and only stored — for yearly reports. */
    deadlineMonth: integer("deadline_month"),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("report_deadlines_idx").on(table.tenantId, table.reportType, table.granularity),
    tenantIsolation(),
  ],
);

export type ReportDeadlineRow = typeof reportDeadlines.$inferSelect;

export type ReportRun = typeof reportRuns.$inferSelect;
export type ReportArtifact = typeof reportArtifacts.$inferSelect;
export type VatRate = typeof vatRates.$inferSelect;
export type SellerVatNumber = typeof sellerVatNumbers.$inferSelect;
export type SkuMapping = typeof skuMappings.$inferSelect;
export type ChannelRule = typeof channelRules.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type SourceFile = typeof sourceFiles.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = (typeof membershipRole.enumValues)[number];
export type RolePermission = typeof rolePermissions.$inferSelect;
