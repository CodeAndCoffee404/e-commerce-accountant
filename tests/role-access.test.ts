import { describe, expect, it } from "vitest";

import {
  ACCESS_LEVELS,
  allows,
  defaultAccess,
  levelsFor,
  resolveAccess,
  SECTIONS,
  sectionDefinition,
} from "@/lib/access/sections";
import { landingRoute, NAV_ITEMS, visibleNavItems } from "@/lib/navigation";

describe("the defaults", () => {
  it("reproduce what each role could do before access was configurable", () => {
    const owner = defaultAccess("owner");
    const accountant = defaultAccess("accountant");
    const viewer = defaultAccess("viewer");

    // The owner: everything, up to whatever the section offers.
    for (const section of SECTIONS) {
      expect(owner[section.id]).toBe(section.editMeans ? "edit" : "view");
    }

    // The accountant: files and reports, deadlines, but not company settings
    // and not the team.
    expect(accountant.source_files).toBe("edit");
    expect(accountant.reports).toBe("edit");
    expect(accountant.settings_deadlines).toBe("edit");
    expect(accountant.settings_company).toBe("view");
    expect(accountant.team).toBe("none");

    // The viewer: looks, changes nothing.
    for (const section of SECTIONS) {
      expect(viewer[section.id]).toBe(section.id === "team" ? "none" : "view");
    }
  });

  it("offer an edit level only where there is something to edit", () => {
    for (const section of SECTIONS) {
      expect(levelsFor(section)).toEqual(
        section.editMeans ? ["none", "view", "edit"] : ["none", "view"],
      );
    }
  });
});

describe("stored overrides", () => {
  it("replace the default for that section and leave the rest alone", () => {
    const access = resolveAccess("accountant", { settings_company: "edit", reports: "none" });

    expect(access.settings_company).toBe("edit");
    expect(access.reports).toBe("none");
    expect(access.source_files).toBe("edit");
  });

  it("cannot take anything away from an owner", () => {
    const access = resolveAccess("owner", { settings_company: "none", team: "none" });

    expect(access.settings_company).toBe("edit");
    expect(access.team).toBe("edit");
  });

  it("cannot hand the team section to anyone else", () => {
    const access = resolveAccess("accountant", { team: "edit" });

    expect(access.team).toBe("none");
  });

  it("start a section nobody has ruled on at its default", () => {
    expect(resolveAccess("viewer", {}).reports).toBe("view");
  });
});

describe("allows", () => {
  it("reads as a floor, not an equality", () => {
    const access = resolveAccess("accountant", {});

    expect(allows(access, "reports", "view")).toBe(true);
    expect(allows(access, "reports", "edit")).toBe(true);
    expect(allows(access, "settings_company", "view")).toBe(true);
    expect(allows(access, "settings_company", "edit")).toBe(false);
    expect(allows(access, "team", "view")).toBe(false);
  });
});

describe("the menu", () => {
  it("drops the rows whose sections are closed", () => {
    const access = resolveAccess("viewer", {
      dashboard: "none",
      settings_company: "none",
      settings_deadlines: "none",
      activity: "none",
    });

    const keys = visibleNavItems(access).map((item) => item.key);

    expect(keys).not.toContain("dashboard");
    // Settings has four sections behind it; with all of them closed for a
    // viewer (team already is), the row goes too.
    expect(keys).not.toContain("settings");
    expect(keys).toContain("reports");
  });

  it("lands someone on a section they can actually open", () => {
    expect(landingRoute(resolveAccess("accountant", {}))).toBe("/dashboard");
    expect(landingRoute(resolveAccess("viewer", { dashboard: "none" }))).toBe("/source-files");
    expect(
      landingRoute(
        resolveAccess("viewer", {
          dashboard: "none",
          source_files: "none",
          transactions: "none",
          reports: "none",
          settings_company: "none",
          settings_deadlines: "none",
          activity: "none",
        }),
      ),
    ).toBe("/no-access");
  });

  it("gates every menu row on a section that exists", () => {
    for (const item of NAV_ITEMS) {
      expect(item.sections.length).toBeGreaterThan(0);

      for (const section of item.sections) {
        expect(() => sectionDefinition(section)).not.toThrow();
      }
    }
  });
});

describe("the levels themselves", () => {
  it("are ordered from nothing to everything", () => {
    expect(ACCESS_LEVELS).toEqual(["none", "view", "edit"]);
  });
});
