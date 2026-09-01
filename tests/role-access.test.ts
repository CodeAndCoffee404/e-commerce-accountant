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

    // The viewer: looks, changes nothing — including the deadline rules, which
    // are a capability rather than a screen and so read "none".
    for (const section of SECTIONS) {
      const expected =
        section.id === "team" || section.id === "settings_deadlines" ? "none" : "view";

      expect(viewer[section.id]).toBe(expected);
    }
  });

  it("offer only the levels a section can actually be set to", () => {
    // Read-only screens stop at view; a capability that lives on another
    // section's screen skips view, because being able to see it is that
    // section's answer; handing out access is never anyone else's to edit.
    expect(levelsFor(sectionDefinition("dashboard"))).toEqual(["none", "view"]);
    expect(levelsFor(sectionDefinition("reports"))).toEqual(["none", "view", "edit"]);
    expect(levelsFor(sectionDefinition("settings_deadlines"))).toEqual(["none", "edit"]);
    expect(levelsFor(sectionDefinition("team"))).toEqual(["none", "view"]);

    for (const section of SECTIONS) {
      expect(section.levels.length).toBeGreaterThan(1);
      expect(section.levels[0]).toBe("none");

      // Every default has to be a level the section offers, or the screen
      // would open on a value it cannot show.
      for (const role of ["owner", "accountant", "viewer"] as const) {
        if (role === "owner") continue;

        expect(section.levels).toContain(section.defaults[role]);
      }
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

  it("can open the team section to another role but never let it edit", () => {
    expect(resolveAccess("accountant", { team: "view" }).team).toBe("view");

    // "edit" is not a level this section offers, so it is not a decision the
    // screen could have made and the default stands.
    expect(resolveAccess("accountant", { team: "edit" }).team).toBe("none");
  });

  it("ignore a level the section does not offer", () => {
    // Deadlines are none-or-edit: a stored "view" is from an older release.
    expect(resolveAccess("viewer", { settings_deadlines: "view" }).settings_deadlines).toBe(
      "none",
    );
    expect(resolveAccess("viewer", { dashboard: "edit" }).dashboard).toBe("view");
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
    expect(allows(access, "settings_deadlines", "edit")).toBe(true);
  });
});

describe("the menu", () => {
  it("drops the rows whose sections are closed", () => {
    const access = resolveAccess("viewer", {
      dashboard: "none",
      settings_company: "none",
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
          activity: "none",
        }),
      ),
    ).toBe("/no-access");
  });

  it("gates every menu row on a section that opens a screen of its own", () => {
    for (const item of NAV_ITEMS) {
      expect(item.sections.length).toBeGreaterThan(0);

      for (const section of item.sections) {
        // A capability nested in another section opens nothing by itself, so
        // it can never be the only reason a menu row is shown.
        expect(sectionDefinition(section).nestedIn).toBeUndefined();
      }
    }
  });
});

describe("the levels themselves", () => {
  it("are ordered from nothing to everything", () => {
    expect(ACCESS_LEVELS).toEqual(["none", "view", "edit"]);
  });
});
