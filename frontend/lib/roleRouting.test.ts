import { describe, expect, it } from "vitest";
import { destinationForRole } from "./roleRouting";

describe("destinationForRole", () => {
  it("routes SUPER_ADMIN and ADMIN to the admin dashboard", () => {
    expect(destinationForRole("SUPER_ADMIN")).toBe("/admin/dashboard");
    expect(destinationForRole("ADMIN")).toBe("/admin/dashboard");
  });

  it("routes TEAM_MEMBER to the team dashboard", () => {
    expect(destinationForRole("TEAM_MEMBER")).toBe("/team/dashboard");
  });

  it("routes client roles and unknown roles to the client dashboard", () => {
    expect(destinationForRole("CLIENT_ADMIN")).toBe("/client/dashboard");
    expect(destinationForRole("CLIENT_USER")).toBe("/client/dashboard");
    expect(destinationForRole(undefined)).toBe("/client/dashboard");
  });
});
