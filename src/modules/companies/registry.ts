import { GEYSER } from "./geyser";
import type { CompanyProfile } from "./types";

/**
 * Every company shape this application knows how to build reports for.
 *
 * The company row stores only the key. Adding a company is therefore two
 * steps, in this order: a profile here, reviewed like any other code, and then
 * the company itself in the admin screen. Doing it the other way round would
 * create a company whose reports cannot be built — which is a better failure
 * than the alternative, where a company created without a profile of its own
 * quietly inherits somebody else's VAT numbers.
 */
const PROFILES: readonly CompanyProfile[] = [GEYSER];

export const COMPANY_KEYS = PROFILES.map((profile) => profile.key);

export class UnknownCompanyError extends Error {
  constructor(key: string) {
    super(
      `No company profile named "${key}". Its reports cannot be built until one is added ` +
        "in src/modules/companies, which is a code change with a golden test — deliberately, " +
        "because these are the values reports are computed from.",
    );
    this.name = "UnknownCompanyError";
  }
}

export function companyProfile(key: string): CompanyProfile {
  const profile = PROFILES.find((candidate) => candidate.key === key);

  if (!profile) throw new UnknownCompanyError(key);

  return profile;
}
