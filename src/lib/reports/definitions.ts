/**
 * Facade over the report modules, kept so the rest of the application has one
 * stable import for "what reports exist". The truth lives in
 * src/modules/reports — one folder per report, assembled by the registry.
 */
export {
  REPORT_DEFINITIONS,
  reportDefinition,
  reportModule,
} from "@/modules/reports/registry";
export type { ReportDefinition, ReportTypeId } from "@/modules/reports/types";
