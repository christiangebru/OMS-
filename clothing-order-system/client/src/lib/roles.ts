import type { UserRole } from "./types";

export type NavKey =
  | "dashboard"
  | "orders"
  | "customers"
  | "production"
  | "scan"
  | "distribution"
  | "staff"
  | "labels";

export const NAV_ITEMS: Array<{
  to: string;
  key: NavKey;
  label: string;
  group: "main" | "production" | "people";
  end?: boolean;
}> = [
  { to: "/", key: "dashboard", label: "Overview", group: "main", end: true },
  { to: "/orders", key: "orders", label: "Orders", group: "main" },
  { to: "/customers", key: "customers", label: "Customers", group: "main" },
  { to: "/production", key: "production", label: "Floor", group: "production" },
  { to: "/scan", key: "scan", label: "Scanner", group: "production" },
  { to: "/distribution", key: "distribution", label: "Distribution", group: "production" },
  { to: "/labels", key: "labels", label: "Labels", group: "production" },
  { to: "/staff", key: "staff", label: "Staff", group: "people" }
];

const ROLE_NAV: Record<UserRole, NavKey[]> = {
  admin: ["dashboard", "orders", "customers", "production", "scan", "distribution", "staff", "labels"],
  manager: ["dashboard", "orders", "customers", "production", "scan", "distribution", "staff", "labels"],
  reception: ["dashboard", "orders", "customers", "scan", "labels"],
  cutter: ["dashboard", "production", "scan", "orders"],
  tailor: ["dashboard", "production", "scan", "orders"],
  embroiderer: ["dashboard", "production", "scan", "orders"],
  finisher: ["dashboard", "production", "scan", "orders"],
  packer: ["dashboard", "production", "scan", "orders", "labels"],
  delivery: ["dashboard", "production", "scan", "orders"]
};

export const ROLE_STAGES: Partial<Record<UserRole, string[]>> = {
  cutter: ["CUTTING", "SEWING_CUTTING"],
  tailor: ["SEWING", "SEWING_CUTTING", "FINAL_SEWING"],
  embroiderer: ["EMBROIDERY"],
  finisher: ["FINISHING"],
  packer: ["PACKAGING", "SHOWROOM", "READY"],
  delivery: ["SHOWROOM", "READY", "DELIVERED"]
};

export function canSee(role: UserRole | undefined, key: NavKey) {
  if (!role) return false;
  return (ROLE_NAV[role] || ROLE_NAV.manager).includes(key);
}

export function isManagerRole(role?: string) {
  return role === "admin" || role === "manager";
}

export function isFloorRole(role?: string) {
  return Boolean(role && ROLE_STAGES[role as UserRole]);
}

export function canWriteStaff(role?: string) {
  return role === "admin" || role === "manager";
}

export function canWriteOrders(role?: string) {
  return role === "admin" || role === "manager" || role === "reception";
}

export function canDeleteOrders(role?: string) {
  return role === "admin";
}

export function navForRole(role?: UserRole) {
  return NAV_ITEMS.filter((item) => canSee(role, item.key));
}
