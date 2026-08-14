import type { AdapterAccountType } from "next-auth/adapters";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
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
 * Приём файлов
 * ------------------------------------------------------------------ */

export const datasetId = pgEnum("dataset_id", [
  "amazon_vat",
  "amazon_monthly",
  "allegro",
  "cdiscount",
  "shopify",
]);

export const periodGranularity = pgEnum("period_granularity", ["month", "quarter"]);

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
    // Дедупликация по содержимому: тот же файл повторно не заводится.
    uniqueIndex("source_files_sha_idx").on(table.tenantId, table.sha256),
    // Срез (тенант, набор, страна, период) — единица замещения, см. PLAN §2.1.
    index("source_files_slice_idx").on(
      table.tenantId,
      table.dataset,
      table.countryCode,
      table.periodLabel,
    ),
    index("source_files_uploaded_idx").on(table.tenantId, table.uploadedAt),
  ],
);

export type SourceFile = typeof sourceFiles.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = (typeof membershipRole.enumValues)[number];
