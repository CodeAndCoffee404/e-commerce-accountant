import { channelModule } from "@/modules/channels/registry";

import type { DatasetId } from "../datasets";
import type { MapContext, MapResult } from "./types";

/**
 * Facade over the channel modules, kept so ingestion has one stable import.
 * The mapping itself lives with each channel in src/modules/channels.
 */
export function mapTransactions(dataset: DatasetId, context: MapContext): MapResult {
  return channelModule(dataset).map(context);
}

export type { MapContext, MapResult, MappedTransaction } from "./types";
