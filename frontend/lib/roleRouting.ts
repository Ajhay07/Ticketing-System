/**
 * Pure UX routing helper: which dashboard shell a role lands on. This has no
 * bearing on authorization - it just avoids showing a CLIENT user an empty
 * admin shell. See CLAUDE.md rule 3.
 */
export function destinationForRole(role: string | undefined): string {
  if (role === "SUPER_ADMIN" || role === "ADMIN") {
    return "/admin/dashboard";
  }
  if (role === "TEAM_MEMBER") {
    return "/team/dashboard";
  }
  return "/client/dashboard";
}
