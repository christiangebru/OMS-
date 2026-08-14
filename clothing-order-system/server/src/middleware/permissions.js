import { UserRole } from "../constants/production.js";

/**
 * Capability matrix. Admin always passes.
 * Staff floor identities (Staff model) are separate from login roles (User.role).
 */
export const CAPABILITIES = {
  "orders.read": UserRole,
  "orders.write": ["admin", "manager", "reception"],
  "orders.delete": ["admin"],
  "customers.read": UserRole,
  "customers.write": ["admin", "manager", "reception"],
  "staff.read": UserRole,
  "staff.write": ["admin", "manager"],
  "distribution": ["admin", "manager"],
  "dashboard": ["admin", "manager", "reception"],
  "scan": UserRole,
  "labels": ["admin", "manager", "packer", "reception"]
};

export function hasCapability(role, capability) {
  if (!role) return false;
  if (role === "admin") return true;
  const allowed = CAPABILITIES[capability];
  return Array.isArray(allowed) && allowed.includes(role);
}

export function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    if (!hasCapability(req.user.role, capability)) {
      return res.status(403).json({
        message: `Forbidden: missing ${capability}`
      });
    }
    next();
  };
}
