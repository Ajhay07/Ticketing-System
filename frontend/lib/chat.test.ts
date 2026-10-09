import { describe, expect, it } from "vitest";
import { attachmentsByComment, initials, messageKind, unreadTicketIds } from "./chat";

describe("messageKind", () => {
  it("classifies internal notes first", () => {
    expect(messageKind({ visibility: "INTERNAL", author_role: "ADMIN" })).toBe("internal");
  });
  it("treats an unreadable (null) author role as staff", () => {
    expect(messageKind({ visibility: "CLIENT", author_role: null })).toBe("staff");
  });
  it("uses the role when known", () => {
    expect(messageKind({ visibility: "CLIENT", author_role: "TEAM_MEMBER" })).toBe("staff");
    expect(messageKind({ visibility: "CLIENT", author_role: "CLIENT_USER" })).toBe("client");
  });
});

describe("initials", () => {
  it("uses first and last word", () => {
    expect(initials("Arjun Kumar Rao")).toBe("AR");
    expect(initials("arjun")).toBe("A");
    expect(initials("  ")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});

describe("attachmentsByComment", () => {
  it("groups only message-bound attachments", () => {
    const a = (id: string, comment_id: string | null) => ({
      id,
      comment_id,
      file_name: id,
      mime_type: "image/png",
      file_size: 1,
      created_at: "",
    });
    const map = attachmentsByComment([a("1", "c1"), a("2", null), a("3", "c1")]);
    expect(map.get("c1")?.map((x) => x.id)).toEqual(["1", "3"]);
    expect(map.size).toBe(1);
  });
});

describe("unreadTicketIds", () => {
  it("collects tickets with unread notifications", () => {
    const ids = unreadTicketIds([
      { ticket_id: "t1", read_at: null },
      { ticket_id: "t2", read_at: "2026-01-01" },
      { ticket_id: null, read_at: null },
    ]);
    expect([...ids]).toEqual(["t1"]);
  });
});

import { commentFromRealtime, upsertComment, visiblePending, type PendingMessage } from "./chat";
import type { Comment } from "./tickets";

const base: Comment = {
  id: "c1",
  user_id: "u1",
  author_name: "Asha",
  author_role: "CLIENT_USER",
  comment: "hi",
  visibility: "CLIENT",
  created_at: "2026-10-09T10:00:00Z",
};

describe("upsertComment", () => {
  it("appends in created_at order and replaces by id without duplicating", () => {
    const later = { ...base, id: "c2", created_at: "2026-10-09T10:05:00Z" };
    const earlier = { ...base, id: "c0", created_at: "2026-10-09T09:00:00Z" };
    const list = upsertComment(upsertComment([base], later), earlier);
    expect(list.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
    expect(upsertComment(list, { ...later, comment: "edited" }).filter((c) => c.id === "c2")).toHaveLength(1);
  });
  it("handles an empty cache", () => {
    expect(upsertComment(undefined, base)).toEqual([base]);
  });
});

describe("commentFromRealtime", () => {
  const row = { id: "c9", ticket_id: "t", user_id: "u1", comment: "new", visibility: "CLIENT" as const, created_at: "2026-10-09T11:00:00Z" };
  it("reuses the author name/role already resolved by the API", () => {
    expect(commentFromRealtime(row, [base])).toMatchObject({ id: "c9", author_name: "Asha", author_role: "CLIENT_USER", comment: "new" });
  });
  it("returns null for an author not yet seen (caller refetches once)", () => {
    expect(commentFromRealtime({ ...row, user_id: "u2" }, [base])).toBeNull();
  });
  it("ignores soft-deleted rows", () => {
    expect(commentFromRealtime({ ...row, deleted_at: "2026-10-09T12:00:00Z" }, [base])).toBeNull();
  });
});

describe("visiblePending", () => {
  const p = (id: number, status: PendingMessage["status"], at: number): PendingMessage => ({
    clientId: `l${id}`, text: "x", visibility: "CLIENT", fileName: null, mutationId: id, status, error: null, submittedAt: at,
  });
  it("keeps sending and failed messages in submission order", () => {
    expect(visiblePending([p(2, "error", 20), p(1, "pending", 10)]).map((m) => m.mutationId)).toEqual([1, 2]);
  });
});
