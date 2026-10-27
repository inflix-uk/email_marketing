"use client";

import { createContext, useContext, type ReactNode } from "react";
import { can, type Permission, type Role } from "@/lib/permissions";

// The signed-in user's role, for hiding buttons in client components. The
// server actions check the role themselves; this is only so viewers don't
// see buttons that would be refused. Server components use
// `can((await requireSession()).role, ...)` or <Can> below.

const RoleContext = createContext<Role>("viewer");

export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

export function useCan(permission: Permission): boolean {
  return can(useRole(), permission);
}

/** Renders `children` only when the user's role allows `permission` (else `fallback`). */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <>{useCan(permission) ? children : fallback}</>;
}
