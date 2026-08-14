import { describe, expect, it } from "vitest";

import { isOwnUpload, uploadPath, uploadPrefix } from "./paths";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("isOwnUpload", () => {
  it("accepts a path under the tenant's own prefix", () => {
    expect(isOwnUpload(`${uploadPrefix(TENANT)}abc-report.csv`, TENANT)).toBe(true);
  });

  it("refuses another tenant's uploads", () => {
    // The browser chooses this path. Without the check, naming someone else's
    // object would have it read — and deleted when the file is refused.
    expect(isOwnUpload(`${uploadPrefix(OTHER)}abc-report.csv`, TENANT)).toBe(false);
  });

  it("refuses another tenant's report artifacts", () => {
    expect(isOwnUpload(`reports/${OTHER}/run/Off-Amazon Sales.xlsx`, TENANT)).toBe(false);
  });

  it("refuses the bare prefix, which names no file", () => {
    expect(isOwnUpload(uploadPrefix(TENANT), TENANT)).toBe(false);
  });

  it("refuses a prefix that only looks like the tenant's", () => {
    expect(isOwnUpload(`uploads/${TENANT}extra/report.csv`, TENANT)).toBe(false);
  });
});

describe("uploadPath", () => {
  it("puts the file under the tenant and keeps it unique", () => {
    const first = uploadPath(TENANT, "report.csv", "id-one");
    const second = uploadPath(TENANT, "report.csv", "id-two");

    expect(first).not.toBe(second);
    expect(isOwnUpload(first, TENANT)).toBe(true);
  });

  it("strips characters that would reshape the key", () => {
    const path = uploadPath(TENANT, "../../etc/passwd", "id");

    expect(path.startsWith(uploadPrefix(TENANT))).toBe(true);
    expect(path).not.toContain("..");
    expect(path).not.toContain("/etc/");
  });

  it("keeps the tail of a very long name, where the extension is", () => {
    const path = uploadPath(TENANT, `${"a".repeat(300)}.xlsx`, "id");

    expect(path.endsWith(".xlsx")).toBe(true);
    expect(path.length).toBeLessThan(200);
  });
});
