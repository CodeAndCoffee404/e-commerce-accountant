import type { AdapterAccountType } from "next-auth/adapters";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  (table) => [primaryKey({ columns: [table.tenantId, table.role, table.section] })],
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
  (table) => [uniqueIndex("allowed_emails_email_idx").on(table.email)],
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
    vatNumber: text("vat_number").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("seller_vat_period_idx").on(table.tenantId, table.country, table.validFrom),
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
  (table) => [uniqueIndex("channel_rules_key_idx").on(table.tenantId, table.channel, table.key)],
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
  (table) => [index("audit_log_tenant_idx").on(table.tenantId, table.createdAt)],
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
  (table) => [uniqueIndex("google_connections_tenant_idx").on(table.tenantId)],
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
  ],
);

/** Which uploads fed a run — the "sources" line of the report card. */
export const reportRunSources = pgTable(
  "report_run_sources",
  {
    reportRunId: uuid("report_run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.reportRunId, table.sourceFileId] })],
);

export const artifactKind = pgEnum("artifact_kind", ["xlsx", "gsheet"]);
export const driveStatus = pgEnum("drive_status", ["pending", "synced", "failed"]);

export const reportArtifacts = pgTable(
  "report_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
  (table) => [index("report_artifacts_run_idx").on(table.reportRunId)],
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
