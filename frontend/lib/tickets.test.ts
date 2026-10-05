import { describe, expect, it } from "vitest";
import {
  canClose,
  canReopen,
  canResolve,
  formatBytes,
  statusLabel,
  statusTargets,
  ticketListPath,
} from "./tickets";

describe("statusLabel", () => {
  it("humanizes enum values", () => {
    expect(statusLabel("WAITING_FOR_CLIENT")).toBe("Waiting For Client");
    expect(statusLabel("OPEN")).toBe("Open");
  });
});

describe("ticketListPath", () => {
  it("includes pagination and only set filters", () => {
    expect(ticketListPath({ page: 2, pageSize: 50 })).toBe("/api/tickets?page=2&page_size=50");
    expect(ticketListPath({ page: 1, pageSize: 25, status: "OPEN", priority: "" })).toBe(
      "/api/tickets?page=1&page_size=25&status=OPEN"
    );
  });
});

describe("transition helpers mirror the backend state machine (UX only)", () => {
  it("clients cannot resolve, staff can from in-progress", () => {
    expect(canResolve("IN_PROGRESS", "CLIENT_USER")).toBe(false);
    expect(canResolve("IN_PROGRESS", "TEAM_MEMBER")).toBe(true);
    expect(canResolve("OPEN", "ADMIN")).toBe(false);
  });

  it("team members cannot close; clients can close a resolved ticket", () => {
    expect(canClose("RESOLVED", "TEAM_MEMBER")).toBe(false);
    expect(canClose("RESOLVED", "CLIENT_USER")).toBe(true);
    expect(canClose("IN_PROGRESS", "CLIENT_USER")).toBe(false);
  });

  it("reopen from resolved or closed", () => {
    expect(canReopen("CLOSED", "CLIENT_ADMIN")).toBe(true);
    expect(canReopen("REOPENED", "CLIENT_ADMIN")).toBe(false);
    expect(canReopen("CLOSED", "TEAM_MEMBER")).toBe(false);
  });

  it("offers only allowed generic status targets", () => {
    expect(statusTargets("WAITING_FOR_CLIENT", "CLIENT_USER")).toEqual(["IN_PROGRESS"]);
    expect(statusTargets("OPEN", "TEAM_MEMBER")).toEqual([]);
    expect(statusTargets("OPEN", "ADMIN")).toEqual(["TRIAGED"]);
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
