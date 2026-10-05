import { describe, expect, it } from "vitest";
import { describeAuditEntry, formatMinutes } from "./admin";
import { ticketListPath } from "./tickets";

describe("describeAuditEntry", () => {
  it("renders status transitions like the spec examples", () => {
    expect(
      describeAuditEntry({ action: "status_changed", old_value: { status: "OPEN" }, new_value: { status: "IN_PROGRESS" } })
    ).toBe("Status changed: open → in progress");
  });
  it("renders priority changes", () => {
    expect(
      describeAuditEntry({ action: "priority_changed", old_value: { priority: "MEDIUM" }, new_value: { priority: "HIGH" } })
    ).toBe("Priority changed: medium → high");
  });
  it("falls back to the action name", () => {
    expect(describeAuditEntry({ action: "something_new", old_value: null, new_value: null })).toBe("something new");
  });
});

describe("formatMinutes", () => {
  it("formats durations", () => {
    expect(formatMinutes(null)).toBe("-");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(90)).toBe("1.5 h");
    expect(formatMinutes(4320)).toBe("3.0 d");
  });
});

describe("ticketListPath search/sort params", () => {
  it("adds search, sort, overdue, unassigned and client filters", () => {
    const path = ticketListPath({
      page: 1,
      pageSize: 25,
      q: "  CF-000001 ",
      sort: "priority",
      overdue: true,
      unassigned: true,
      organizationId: "org-1",
    });
    expect(path).toBe(
      "/api/tickets?page=1&page_size=25&q=CF-000001&sort=priority&overdue=true&assigned_to=unassigned&organization_id=org-1"
    );
  });
  it("omits the default sort", () => {
    expect(ticketListPath({ page: 1, pageSize: 25, sort: "default" })).toBe("/api/tickets?page=1&page_size=25");
  });
});
