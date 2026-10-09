import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: string[] = [];
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/tickets", async (orig) => ({
  ...(await orig<typeof import("@/lib/tickets")>()),
  apiJson: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/categories") return [{ id: "cat1", name: "Hardware", description: null }];
    calls.push(`POST ${path} ${init?.body}`);
    return { id: "t9", ticket_number: "CF-9" };
  }),
}));
vi.mock("@/lib/uploads", async (orig) => ({
  ...(await orig<typeof import("@/lib/uploads")>()),
  uploadWithProgress: vi.fn(async (_t: string, file: File, onProgress: (p: number) => void) => {
    calls.push(`UPLOAD ${file.name}`);
    onProgress(0.5);
    if (file.name === "bad.pdf") throw new Error("File upload failed");
  }),
}));

import { CreateTicketForm } from "./CreateTicketForm";

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

afterEach(() => {
  cleanup();
  calls.length = 0;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

function file(name: string, type = "application/pdf") {
  return new File(["x".repeat(10)], name, { type, lastModified: name.length });
}

describe("CreateTicketForm: voice + multiple attachments together", () => {
  it("dictation appends to typed text, files upload after the ticket is created, failures are reported per file", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateTicketForm />
      </QueryClientProvider>
    );
    await screen.findByText("Hardware");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Printer down" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "cat1" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Typed part." } });

    // Voice: start, a final phrase, stop.
    fireEvent.click(screen.getByLabelText("Start voice input"));
    expect(screen.getByLabelText("Stop voice input")).toBeTruthy();
    expect(screen.getByText("Listening...")).toBeTruthy();
    act(() =>
      FakeRecognition.last!.onresult!({
        resultIndex: 0,
        results: Object.assign([Object.assign([{ transcript: "it shows error five" }], { isFinal: true })], { length: 1 }),
      })
    );
    fireEvent.click(screen.getByLabelText("Stop voice input"));
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Typed part. it shows error five");

    // Files: three valid + one rejected client-side; remove one.
    fireEvent.change(screen.getByLabelText(/Attachments/), {
      target: { files: [file("a.pdf"), file("bad.pdf"), file("c.png", "image/png"), file("virus.exe", "application/x-msdownload")] },
    });
    expect(screen.getByText(/virus.exe is not an allowed file type/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove c.png"));
    expect(screen.queryByText("c.png")).toBeNull();

    fireEvent.click(screen.getByText("Create ticket"));
    await screen.findByText(/failed to upload/);
    // Ticket first (with the dictated description), then each file.
    expect(calls[0]).toContain("POST /api/tickets ");
    expect(calls[0]).toContain("Typed part. it shows error five");
    expect(calls.slice(1).sort()).toEqual(["UPLOAD a.pdf", "UPLOAD bad.pdf"]);
    await waitFor(() => expect(screen.getByText(/1 of 2 files failed to upload \(bad.pdf\)/)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });
});
