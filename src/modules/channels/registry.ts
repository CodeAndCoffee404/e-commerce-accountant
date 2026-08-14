import type { DatasetId } from "@/lib/ingest/datasets";

import { allegroModule } from "./allegro";
import { amazonMonthlyModule } from "./amazon-monthly/module";
import { amazonVatModule } from "./amazon-vat";
import { cdiscountModule } from "./cdiscount";
import { shopifyModule } from "./shopify";
import type { ChannelModule, ChannelRuleSeed } from "./types";

/**
 * Every sales channel the system can read. The core iterates this list and
 * never names a module: adding a channel is a new file here plus one line
 * below, and nothing that already works is touched.
 *
 * The order is the order classification tries them. Amazon Monthly goes
 * first: its header sits below a preamble, and checking the fixed-row
 * channels against a preamble row can only ever miss.
 */
export const CHANNEL_MODULES: readonly ChannelModule[] = [
  amazonMonthlyModule,
  amazonVatModule,
  allegroModule,
  cdiscountModule,
  shopifyModule,
];

export function channelModule(id: DatasetId): ChannelModule {
  const found = CHANNEL_MODULES.find((module) => module.id === id);

  if (!found) throw new Error(`Unknown channel: ${id}`);

  return found;
}

/** Short names for the UI, one source for every list and chip. */
export const DATASET_NAMES: Record<DatasetId, string> = Object.fromEntries(
  CHANNEL_MODULES.map((module) => [module.id, module.shortName]),
) as Record<DatasetId, string>;

/** The rules a fresh tenant starts with, assembled from the modules. */
export const CHANNEL_RULES: readonly ChannelRuleSeed[] = CHANNEL_MODULES.flatMap(
  (module) => module.defaultRules,
);
