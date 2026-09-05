import { getDb, schema } from "@/lib/db";
import { GEYSER } from "@/modules/companies/geyser";

/**
 * Gives a test company the VAT registrations its reports will ask for.
 *
 * A separate step because that is what it is in the application: seeding fills
 * a company's rates, mappings and channel defaults, and stops there. A VAT
 * number names a legal entity, so it is a row somebody enters — never one a
 * company is handed on the day it is created, which is how the second company
 * would have printed the first one's numbers.
 *
 * So a test that builds a report has to say this out loud, exactly as a real
 * company has to. Geyser's own numbers are used because these tests compare
 * against Geyser's reports; a test about a different company should pass its
 * own.
 */
export async function giveRegistrations(
  tenantId: string,
  registrations: readonly { country: string; scheme: string; vatNumber: string }[] = GEYSER.registrations,
): Promise<void> {
  await getDb()
    .insert(schema.sellerVatNumbers)
    .values(
      registrations.map((entry) => ({
        tenantId,
        country: entry.country,
        scheme: entry.scheme,
        vatNumber: entry.vatNumber,
        validFrom: "2020-01-01",
      })),
    )
    .onConflictDoNothing();
}
