import type { DatasetId } from "../datasets";
import { mapAllegro } from "./allegro";
import { mapAmazonMonthly } from "./amazon-monthly";
import { mapAmazonVat } from "./amazon-vat";
import { mapCdiscount } from "./cdiscount";
import { mapShopify } from "./shopify";
import type { Mapper, MapContext, MapResult } from "./types";

const MAPPERS: Record<DatasetId, Mapper> = {
  amazon_vat: mapAmazonVat,
  amazon_monthly: mapAmazonMonthly,
  allegro: mapAllegro,
  cdiscount: mapCdiscount,
  shopify: mapShopify,
};

export function mapTransactions(dataset: DatasetId, context: MapContext): MapResult {
  return MAPPERS[dataset](context);
}

export type { MapContext, MapResult, MappedTransaction } from "./types";
