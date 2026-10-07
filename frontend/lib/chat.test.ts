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
