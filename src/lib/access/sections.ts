import type { MembershipRole } from "@/lib/db/schema";

/**
 * What a role may do with a section.
 *
 * Three levels rather than a permission per button: the screens only ever ask
 * two questions — may this person open it, and may they change anything on it.
 */
export const ACCESS_LEVELS = ["none", "view", "edit"] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export type SectionId =
  | "dashboard"
  | "source_files"
  | "transactions"
  | "reports"
  | "settings_company"
  | "settings_deadlines"
  | "team"
  | "activity";

export type SectionDefinition = {
  id: SectionId;
  label: string;
  /** What the section is, in the owner's words, on the access screen. */
  description: string;
  /**
   * The levels this section can be set to, and the only ones the matrix
   * offers. A section with nothing to change stops at "view"; one that is a
   * capability inside another section skips "view", because seeing it is the
   * other section's business.
   */
  levels: readonly AccessLevel[];
  /** What "edit" buys here. Absent on sections that only ever read. */
  editMeans?: string;
  /**
   * A capability that lives on another section's screen. Granting it without
   * a view of that section leaves it unreachable, which the access screen
   * says out loud rather than leaving to be discovered.
   */
  nestedIn?: SectionId;
  /**
   * Editing stays with the owner whatever the table says. An owner who could
   * hand the access screen to someone else could be locked out of their own
   * account by them.
   */
  editIsOwnerOnly?: true;
  defaults: Record<MembershipRole, AccessLevel>;
};

/**
 * Every section of the app that access can be set for.
 *
 * The defaults reproduce exactly what each role could do before access became
 * configurable, so a tenant that never opens the access screen sees no change.
 */
export const SECTIONS: readonly SectionDefinition[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Where the month stands, what needs attention, recent activity.",
    levels: ["none", "view"],
    defaults: { owner: "view", accountant: "view", viewer: "view" },
  },
  {
    id: "source_files",
    label: "Source files",
    description: "The uploaded exports and what was parsed out of them.",
    levels: ["none", "view", "edit"],
    editMeans: "Upload and delete files",
    defaults: { owner: "edit", accountant: "edit", viewer: "view" },
  },
  {
    id: "transactions",
    label: "Transactions",
    description: "Every parsed row, as one ledger.",
    levels: ["none", "view"],
    defaults: { owner: "view", accountant: "view", viewer: "view" },
  },
  {
    id: "reports",
    label: "Reports",
    description: "Prepared reports and the runs that produced them.",
    levels: ["none", "view", "edit"],
    editMeans: "Build and re-build reports",
    defaults: { owner: "edit", accountant: "edit", viewer: "view" },
  },
  {
    id: "settings_company",
    label: "Company settings",
    description:
      "VAT rates, SKU mapping, seller VAT numbers, exchange rates, channel rules, report configuration, periods and Google Drive.",
    levels: ["none", "view", "edit"],
    editMeans: "Change company settings",
    defaults: { owner: "edit", accountant: "view", viewer: "view" },
  },
  {
    // Two levels, not three: the deadline rules are edited on the report cards
    // under Company settings, so whether they can be *seen* is that section's
    // answer, and only whether they can be changed is this one's.
    id: "settings_deadlines",
    label: "Filing deadlines",
    description: "The rule that turns a closed period into a due date, on the report cards.",
    levels: ["none", "edit"],
    editMeans: "Change deadline rules",
    nestedIn: "settings_company",
    defaults: { owner: "edit", accountant: "edit", viewer: "none" },
  },
  {
    id: "team",
    label: "Team and access",
    description: "Who may sign in, their role, and this access table itself.",
    // Readable by anyone the owner lets read it; changeable by the owner only,
    // so "edit" is not on offer for the other roles at all.
    levels: ["none", "view"],
    editMeans: "Invite people and set access",
    editIsOwnerOnly: true,
    defaults: { owner: "edit", accountant: "none", viewer: "none" },
  },
  {
    id: "activity",
    label: "Activity log",
    description: "The trail of what was changed, by whom.",
    levels: ["none", "view"],
    defaults: { owner: "view", accountant: "view", viewer: "view" },
  },
] as const;

export const SECTION_IDS = SECTIONS.map((section) => section.id);

export type AccessMap = Record<SectionId, AccessLevel>;

export function isSectionId(value: string): value is SectionId {
  return SECTION_IDS.includes(value as SectionId);
}

export function isAccessLevel(value: string): value is AccessLevel {
  return (ACCESS_LEVELS as readonly string[]).includes(value);
}

export function sectionDefinition(id: SectionId): SectionDefinition {
  const found = SECTIONS.find((section) => section.id === id);

  if (!found) throw new Error(`Unknown section: ${id}`);

  return found;
}

/** The levels this section can actually be set to. */
export function levelsFor(section: SectionDefinition): readonly AccessLevel[] {
  return section.levels;
}

export function defaultAccess(role: MembershipRole): AccessMap {
  return Object.fromEntries(
    SECTIONS.map((section) => [section.id, section.defaults[role]]),
  ) as AccessMap;
}

/**
 * Applies stored overrides on top of the defaults.
 *
 * Only deviations are stored, so a section added to the app later starts at
 * its default for every role rather than at "none" — a new screen nobody can
 * open would look like a bug, not a policy.
 */
export function resolveAccess(
  role: MembershipRole,
  overrides: Partial<Record<SectionId, AccessLevel>>,
): AccessMap {
  const resolved = defaultAccess(role);

  for (const section of SECTIONS) {
    const override = overrides[section.id];

    if (!override) continue;

    // The owner's own access is never stored and never read: an owner locked
    // out of Team could not undo it from inside the app.
    if (role === "owner") continue;

    // A level this section does not offer — left behind by an older release,
    // or written by something other than the access screen — is not a
    // decision the screen could have made, so the default stands.
    if (!section.levels.includes(override)) continue;

    resolved[section.id] = override;
  }

  return resolved;
}

export function allows(access: AccessMap, section: SectionId, level: AccessLevel): boolean {
  return RANK[access[section]] >= RANK[level];
}

export const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: "No access",
  view: "View only",
  edit: "Full access",
};
