import { GEYSER } from "./geyser";
import type { CompanyRules } from "./types";

/**
 * The values a company's reports are computed from.
 *
 * Every company gets the same set today. That is a deliberate stopping point,
 * not an oversight: what differs between companies is known only once there is
 * a second one, and inventing the difference in advance would mean guessing at
 * somebody's Zoho account names.
 *
 * The seam is the company's identifier. `rulesFor` takes it and ignores it,
 * so the day a second company needs its own answers, this function grows a
 * branch and nothing above it changes. Nothing is stored in the database to
 * say which rules a company uses — that was the profile, and a column naming
 * a set of rules is a second identifier for something that already has one.
 */
export function rulesFor(tenantId: string): CompanyRules {
  // Deliberately unused. Taking the identifier and ignoring it is what makes
  // every caller already correct for the day a second company needs its own
  // answers; a function that took nothing would have to be found and changed
  // in a dozen places first.
  void tenantId;

  return GEYSER;
}

/**
 * What every company currently starts life with. Named apart from `rulesFor`
 * because seeding is a different question from reporting: this is the first
 * day's contents of the tables somebody then edits.
 */
export function seedsFor(tenantId: string): CompanyRules["seeds"] {
  return rulesFor(tenantId).seeds;
}
