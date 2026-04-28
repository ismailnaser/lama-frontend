import type { AuthUser } from "./auth";

export function isDoctorRole(role: AuthUser["role"]): boolean {
  return role === "doctor" || role === "doctor_admin";
}

export function isSectionAdmin(role: AuthUser["role"]): boolean {
  return role === "admin" || role === "doctor_admin" || role === "nurse_admin";
}

export function getLandingPathForRole(role: AuthUser["role"]): string {
  return isDoctorRole(role) ? "/doctor" : "/";
}
