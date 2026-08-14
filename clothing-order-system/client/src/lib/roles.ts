import type { UserRole } from "./types";

export type NavKey =
  | "dashboard"
  | "orders"
  | "customers"
  | "scan"
  | "distribution"
  | "staff"
  | "labels";

export const NAV_ITEMS: Array<{
  to: string;
  key: NavKey;
  label: string;
  group: "overview" | "production";
  end?: boolean;
}> = [
  { to: "/", key: "dashboard", label: "Overview", group: "overview", end: true },
  { to: "/orders", key: "orders", label: "Orders", group: "overview" },
  { to: "/customers", key: "customers", label: "Customers", group: "overview" },
  { to: "/scan", key: "scan", label: "Production floor", group: "production" },
  { to: "/distribution", key: "distribution", label: "Distribution", group: "production" },
  { to: "/staff", key: "staff", label: "Staff", group: "production" },
  { to: "/labels", key: "labels", label: "Print labels", group: "production" }
];

const ROLE_NAV: Record<UserRole, NavKey[]> = {
  admin: ["dashboard", "orders", "customers", "scan", "distribution", "staff", "labels"],
  manager: ["dashboard", "orders", "customers", "scan", "distribution", "staff", "labels"],
  reception: ["dashboard", "orders", "customers", "labels"],
  cutter: ["dashboard", "scan", "orders"],
  tailor: ["dashboard", "scan", "orders"],
  embroiderer: ["dashboard", "scan", "orders"],
  finisher: ["dashboard", "scan", "orders"],
  packer: ["dashboard", "scan", "orders", "labels"],
  delivery: ["dashboard", "scan", "orders"]
};

export const ROLE_STAGES: Partial<Record<UserRole, string[]>> = {
  cutter: ["CUTTING"],
  tailor: ["SEWING"],
  embroiderer: ["EMBROIDERY"],
  finisher: ["FINISHING"],
  packer: ["READY"],
  delivery: ["READY", "DELIVERED"]
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

export function canWriteOrders(role?: string) {
  return role === "admin" || role === "manager" || role === "reception";
}

export function navForRole(role?: UserRole) {
  return NAV_ITEMS.filter((item) => canSee(role, item.key));
}
