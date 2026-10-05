"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Paperclip, UploadCloud, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, Page, PageHeader } from "@/components/ui/Card";
import { ErrorText, Input, Label, Select, Textarea } from "@/components/ui/Form";
import { Spinner } from "@/components/ui/States";
import {
  apiJson,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  PRIORITIES,
  statusLabel,
  uploadAttachment,
  type Category,
  type Priority,
  type Ticket,
} from "@/lib/tickets";

const ACCEPT = ".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip";

/** Spec §33: subject, category, priority, description, optional attachment. */
export function CreateTicketForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<Ticket | null>(null);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiJson<Category[]>("/api/categories"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const ticket = await apiJson<Ticket>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({ subject, category_id: categoryId, priority, description }),
      });
      let attachmentError: string | null = null;
      if (file) {
        try {
          await uploadAttachment(ticket.id, file);
        } catch (e) {
          attachmentError = (e as Error).message;
        }
      }
      return { ticket, attachmentError };
    },
    onSuccess: ({ ticket, attachmentError }) => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      if (attachmentError) {
        setPartial(ticket);
        setError(`Attachment upload failed: ${attachmentError}`);
        return;
      }
      router.push(`/client/tickets/${ticket.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function pickFile(f: File | null) {
    setError(null);
    if (f && f.size > MAX_ATTACHMENT_BYTES) {
      setError("Attachments must be 25 MB or smaller.");
      return;
    }
    setFile(f);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      setError("Attachments must be 25 MB or smaller.");
      return;
    }
    create.mutate();
  }

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
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              required
              rows={7}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened, what you expected, and any steps to reproduce."
            />
          </div>

          <div>
            <Label htmlFor="attachment" hint="(optional, up to 25 MB)">
              Attachment
            </Label>
            {file ? (
              <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                <FileText className="h-5 w-5 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(file.size)}
                    {file.type ? ` · ${file.type}` : ""}
                    {create.isPending ? " · Uploading..." : " · Ready to upload"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-8 px-0"
                  aria-label={`Remove ${file.name}`}
                  disabled={create.isPending}
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
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
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 py-6 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-brand-500 ${
                  dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50/60 hover:bg-slate-50"
                }`}
              >
                <UploadCloud className="h-6 w-6 text-slate-400" />
                <span className="mt-2 text-sm text-slate-700">
                  <span className="font-medium text-brand-700">Choose a file</span> or drag it here
                </span>
                <span className="mt-1 text-xs text-slate-500">PNG, JPG, PDF, DOC/DOCX, XLS/XLSX, CSV, ZIP</span>
              </label>
            )}
            <input
              ref={fileRef}
              id="attachment"
              type="file"
              accept={ACCEPT}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </div>

          {categories.error && <ErrorText>Could not load categories.</ErrorText>}
          {error && <ErrorText>{error}</ErrorText>}
          {partial && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Paperclip className="mr-1 inline h-4 w-4" />
              Ticket {partial.ticket_number} was created.{" "}
              <Link className="font-medium underline" href={`/client/tickets/${partial.id}`}>
                Open it
              </Link>{" "}
              to retry the attachment.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
            <ButtonLink href="/client/tickets">Cancel</ButtonLink>
            <Button type="submit" variant="primary" disabled={create.isPending || partial !== null}>
              {create.isPending && <Spinner className="text-white/80" />}
              {create.isPending ? "Creating ticket..." : "Create ticket"}
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
