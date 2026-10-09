import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { Comment } from "@/lib/tickets";

let resolvePost: ((c: Comment) => void) | null = null;
let rejectPost: ((e: Error) => void) | null = null;
const apiJson = vi.fn(
  () =>
    new Promise<Comment>((res, rej) => {
      resolvePost = res;
      rejectPost = rej;
    })
);
vi.mock("@/lib/tickets", async (orig) => ({
  ...(await orig<typeof import("@/lib/tickets")>()),
  apiJson: (...a: unknown[]) => apiJson(...(a as [])),
  uploadAttachment: vi.fn(),
}));

import { TicketChat } from "./TicketChat";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["comments", "t1"], []);
  const onPosted = vi.fn();
  function Harness() {
    const comments =
      useQuery({ queryKey: ["comments", "t1"], queryFn: () => [] as Comment[], staleTime: Infinity }).data ?? [];
    return (
      <TicketChat ticketId="t1" comments={comments} loading={false} attachments={[]} myUserId="me" staff={false} closed={false} onPosted={onPosted} />
    );
  }
  const r = render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>
  );
  return { qc, onPosted, r };
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: text } });
  fireEvent.submit(screen.getByLabelText("Message").closest("form")!);
}

afterEach(() => {
  cleanup();
  apiJson.mockClear();
});

describe("TicketChat optimistic send", () => {
  it("shows the message immediately as sending, clears the box, then writes the server row into the cache", async () => {
    const { qc, onPosted } = setup();
    type("Printer is on fire");
    // Visible after one scheduler tick, while the POST is still unresolved.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Printer is on fire")).toBeTruthy();
    expect(screen.getByText("Sending...")).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiJson).toHaveBeenCalledWith("/api/tickets/t1/comments", expect.objectContaining({ method: "POST" }));
    await act(async () => {
      resolvePost!({
        id: "srv1", user_id: "me", author_name: "Me", author_role: "CLIENT_USER", comment: "Printer is on fire",
        visibility: "CLIENT", created_at: "2026-10-09T10:00:00Z",
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(qc.getQueryData<Comment[]>(["comments", "t1"])?.map((c) => c.id)).toEqual(["srv1"]);
    await waitFor(() => expect(screen.queryByText("Sending...")).toBeNull());
    // Rendered once, from the server row (no duplicate optimistic bubble left behind).
    expect(screen.getAllByText("Printer is on fire")).toHaveLength(1);
    expect(onPosted).toHaveBeenCalledWith(false);
  });

  it("keeps a failed message with Retry, and Retry re-sends the same text", async () => {
    setup();
    type("Please call me");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      rejectPost!(new Error("Network down"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText(/Network down/)).toBeTruthy();
    expect(screen.getByText("Please call me")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiJson).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Sending...")).toBeTruthy();
    expect(screen.queryByText(/Network down/)).toBeNull();
    expect(screen.getAllByText("Please call me")).toHaveLength(1);
  });
});
