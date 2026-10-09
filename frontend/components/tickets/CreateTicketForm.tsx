"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileText, Mic, Paperclip, Square, UploadCloud, X, XCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, Page, PageHeader } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { ErrorText, Input, Label, Select, Textarea } from "@/components/ui/Form";
import { Spinner } from "@/components/ui/States";
import { appendTranscript, useSpeechToText } from "@/lib/speech";
import {
  apiJson,
  formatBytes,
  PRIORITIES,
  statusLabel,
  type Category,
  type Priority,
  type Ticket,
} from "@/lib/tickets";
import {
  ACCEPT,
  addFiles,
  MAX_FILES_PER_TICKET,
  runWithConcurrency,
  UPLOAD_CONCURRENCY,
  uploadWithProgress,
} from "@/lib/uploads";

type UploadState = { status: "uploading" | "done" | "failed"; progress: number; error?: string };

/** Spec §33: subject, category, priority, description, optional attachments. */
export function CreateTicketForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<Record<number, UploadState>>({});
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<{ ticket: Ticket; failed: string[] } | null>(null);

  // Voice input appends only FINAL phrases to whatever is already typed.
  const voice = useSpeechToText((text) => setDescription((current) => appendTranscript(current, text)));

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiJson<Category[]>("/api/categories"),
    staleTime: 5 * 60_000, // reference data
  });

  const create = useMutation({
    mutationFn: async () => {
      // 1. The ticket is created (committed, notifications queued
      //    server-side) before any file is touched - unchanged behavior.
      const ticket = await apiJson<Ticket>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({ subject, category_id: categoryId, priority, description }),
      });
      // 2. Files upload with at most UPLOAD_CONCURRENCY in flight. The API
      //    validates each one on its own; one failure never blocks the rest.
      const failed: string[] = [];
      const set = (i: number, next: UploadState) => setUploads((u) => ({ ...u, [i]: next }));
      await runWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, i) => {
        set(i, { status: "uploading", progress: 0 });
        try {
          await uploadWithProgress(ticket.id, file, (p) => set(i, { status: "uploading", progress: p }));
          set(i, { status: "done", progress: 1 });
        } catch (e) {
          failed.push(file.name);
          set(i, { status: "failed", progress: 0, error: (e as Error).message });
        }
      });
      return { ticket, failed };
    },
    onSuccess: ({ ticket, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      if (failed.length > 0) {
        setPartial({ ticket, failed });
        return;
      }
      router.push(`/client/tickets/${ticket.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function pickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const { files: next, errors } = addFiles(files, Array.from(list));
    setFiles(next);
    setFileErrors(errors);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (voice.listening) voice.stop();
    setUploads({});
    create.mutate();
  }

  const busy = create.isPending;

  return (
    <Page narrow>
      <Link
        href="/client/tickets"
        className="mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tickets
      </Link>
      <PageHeader title="Create New Ticket" description="What do you need help with? Our team will respond as soon as possible." />

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              required
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary of the issue"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="category">Category</Label>
              <Select id="category" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Select a category</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {statusLabel(p)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-end justify-between gap-2">
              <Label htmlFor="description">Description</Label>
              {voice.listening && (
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#DC2626]" role="status">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#DC2626]" aria-hidden />
                  Listening...
                </span>
              )}
            </div>
            <div className="relative">
              <Textarea
                id="description"
                required
                rows={7}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened, what you expected, and any steps to reproduce."
                className="pr-14"
              />
              <button
                type="button"
                onClick={() => (voice.listening ? voice.stop() : voice.start())}
                disabled={busy}
                aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={voice.listening}
                title={voice.listening ? "Stop voice input" : "Start voice input"}
                className={cn(
                  "absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded border transition-colors duration-150 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cf-ink disabled:opacity-50",
                  voice.listening
                    ? "border-[#DC2626] bg-[#DC2626] text-white"
                    : "border-cf-border bg-white text-slate-500 hover:border-cf-ink hover:text-cf-ink"
                )}
              >
                {voice.listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
              </button>
            </div>
            {voice.listening && voice.interim && (
              <p className="mt-1.5 text-sm italic text-slate-400" aria-live="polite">
                {voice.interim}
              </p>
            )}
            {voice.error && (
              <p className="mt-1.5 text-xs text-slate-600" role="alert">
                {voice.error}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="attachment" hint={`(optional, up to ${MAX_FILES_PER_TICKET} files, 25 MB each)`}>
              Attachments
            </Label>
            {files.length > 0 && (
              <ul className="mb-2 space-y-2">
                {files.map((file, i) => {
                  const u = uploads[i];
                  return (
                    <li
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="rounded-md border border-cf-border bg-slate-50 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        {u?.status === "done" ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                        ) : u?.status === "failed" ? (
                          <XCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
                        ) : (
                          <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                          <p className="text-xs text-slate-500">
                            {formatBytes(file.size)}
                            {u?.status === "uploading" && ` · Uploading ${Math.round(u.progress * 100)}%`}
                            {u?.status === "done" && " · Uploaded"}
                            {u?.status === "failed" && ` · Failed: ${u.error ?? "upload error"}`}
                            {!u && (busy ? " · Waiting..." : " · Ready to upload")}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10 w-10 px-0"
                          aria-label={`Remove ${file.name}`}
                          disabled={busy || partial !== null}
                          onClick={() => {
                            setFiles((f) => f.filter((_, j) => j !== i));
                            setFileErrors([]);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {u?.status === "uploading" && (
                        <div
                          className="mt-2 h-1 overflow-hidden rounded bg-slate-200"
                          role="progressbar"
                          aria-label={`Uploading ${file.name}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(u.progress * 100)}
                        >
                          <div
                            className="h-full bg-cf-ink transition-[width] duration-150"
                            style={{ width: `${u.progress * 100}%` }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {files.length < MAX_FILES_PER_TICKET && partial === null && (
              <label
                htmlFor="attachment"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!busy) pickFiles(e.dataTransfer.files);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 py-6 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-brand-500 ${
                  dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50/60 hover:bg-slate-50"
                }`}
              >
                <UploadCloud className="h-6 w-6 text-slate-400" />
                <span className="mt-2 text-sm text-slate-700">
                  <span className="font-medium text-brand-700">Choose files</span> or drag them here
                </span>
                <span className="mt-1 text-xs text-slate-500">PNG, JPG, PDF, DOC/DOCX, XLS/XLSX, CSV, ZIP</span>
              </label>
            )}
            <input
              id="attachment"
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                pickFiles(e.target.files);
                e.target.value = "";
              }}
              className="sr-only"
            />
            {fileErrors.length > 0 && (
              <ul className="mt-2 space-y-0.5" role="alert">
                {fileErrors.map((m) => (
                  <li key={m}>
                    <ErrorText>{m}</ErrorText>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {categories.error && <ErrorText>Could not load categories.</ErrorText>}
          {error && <ErrorText>{error}</ErrorText>}
          {partial && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
              <Paperclip className="mr-1 inline h-4 w-4" />
              Ticket {partial.ticket.ticket_number} was created, but {partial.failed.length} of {files.length} file
              {files.length === 1 ? "" : "s"} failed to upload ({partial.failed.join(", ")}).{" "}
              <Link className="font-medium underline" href={`/client/tickets/${partial.ticket.id}`}>
                Open the ticket
              </Link>{" "}
              to attach them again.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-cf-border pt-5 sm:flex-row sm:justify-end">
            <ButtonLink href="/client/tickets">Cancel</ButtonLink>
            <Button type="submit" variant="primary" disabled={busy || partial !== null}>
              {busy && <Spinner className="text-white/80" />}
              {busy ? (files.length > 0 ? "Creating ticket and uploading..." : "Creating ticket...") : "Create ticket"}
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
