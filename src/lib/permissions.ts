// Roles and what each one may do. Pure (no database, no Next.js), so it is
// shared by server actions, route handlers, client components and tests.
//
// - admin:  everything.
// - editor: create, edit, send, delete and export campaigns, templates,
//           contacts and lists - but not Settings (email sending, sender,
//           company) and not the team.
// - viewer: read-only. Sees campaigns, reports and contacts; can't send,
//           edit, delete or export recipient data.
//
// Everyone may change their own email/password and sign themselves out.

export const ROLES = ["admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Can do everything, including Settings and Team.",
  editor: "Can create, edit and send campaigns, templates, contacts and lists.",
  viewer: "Can only look at campaigns, reports and contacts.",
};

export const PERMISSIONS = [
  /** See campaigns, reports, contacts, lists, templates. */
  "view",
  /** Create or change campaigns, templates, contacts, lists (incl. imports and images). */
  "edit",
  /** Send, schedule, pause, resume, cancel campaigns and send tests. */
  "send",
  /** Delete campaigns, templates, contacts, lists. */
  "delete",
  /** Download recipient/contact data (CSV exports). */
  "export",
  /** App settings: email sending, sender, company address, app URL. */
  "settings",
  /** Invite and remove teammates, change roles. */
  "team",
  /** Read the activity log. */
  "audit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(PERMISSIONS),
  editor: new Set<Permission>(["view", "edit", "send", "delete", "export"]),
  viewer: new Set<Permission>(["view"]),
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The role stored on a user. Accounts created before roles existed have none
 * and count as admin (so nobody loses access by upgrading). A stored value
 * that isn't a known role gets the least access.
 */
export function roleOf(user: { role?: unknown } | null | undefined): Role {
  const role = user?.role;
  if (role === undefined || role === null) return "admin";
  return isRole(role) ? role : "viewer";
}

/** May someone with this role do this? Unknown roles may do nothing. */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role || !isRole(role)) return false;
  return GRANTS[role].has(permission);
}

/** Mongo filter matching admin accounts (including those with no role stored). */
export const ADMIN_FILTER = { $or: [{ role: "admin" as const }, { role: null }] };

/** Thrown by requirePermission() when the signed-in user's role doesn't allow an action. */
export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super("You don't have permission to do that. Ask an admin to change your role.");
    this.name = "PermissionError";
  }
}
