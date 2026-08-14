import type { Classification, Grid } from "@/lib/ingest/classify";
import type { DatasetId } from "@/lib/ingest/datasets";
import type { Mapper } from "@/lib/ingest/mappers/types";

/** One channel rule seeded for a new tenant; Restore missing defaults re-adds it. */
export type ChannelRuleSeed = {
  channel: string;
  key: string;
  value: unknown;
  note: string;
};

/**
 * One sales channel, complete: how its export is recognised, how its rows
 * become transactions, and the rules its reports cannot work without.
 *
 * The contract the whole system holds a module to: a grid in, a verdict or a
 * refusal out; raw rows in, normalised transactions out. Everything else is
 * private. The core runs modules through this interface and never learns
 * their names — a new channel is a new file and a registry line, not a change
 * to anything that already works.
 */
export type ChannelModule = {
  id: DatasetId;
  /** Short name for chips and lists. */
  shortName: string;
  /**
   * Recognise the grid as this channel, or decline with null so the next
   * module is tried. A non-null refusal ends the search: the layout matched,
   * so no other module could own the file — only something else was wrong.
   */
  classify: (grid: Grid, filename: string) => Classification | null;
  /** Raw grid rows → normalised transactions. */
  map: Mapper;
  defaultRules: readonly ChannelRuleSeed[];
};
