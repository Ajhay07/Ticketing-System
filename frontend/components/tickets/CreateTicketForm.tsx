"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiJson,
  MAX_ATTACHMENT_BYTES,
  PRIORITIES,
  statusLabel,
  uploadAttachment,
  type Category,
  type Priority,
  type Ticket,
} from "@/lib/tickets";

const inputClass = "mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

/** Spec §33: subject, category, priority, description, optional attachment. */
export function CreateTicketForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Create New Ticket</h1>
      <p className="mb-6 text-sm text-slate-500">What do you need help with?</p>

      <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <label className={labelClass} htmlFor="subject">
          Subject
        </label>
        <input
          id="subject"
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={inputClass}
        />

        <div className="flex gap-4">
          <div className="flex-1">
            <label className={labelClass} htmlFor="category">
              Category
            </label>
            <select
              id="category"
              required
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a category</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className={labelClass} htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className={inputClass}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {statusLabel(p)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className={labelClass} htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          required
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />

        <label className={labelClass} htmlFor="attachment">
          Attachment (optional, up to 25 MB)
        </label>
        <input
          id="attachment"
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mb-4 block w-full text-sm text-slate-600"
        />

        {categories.error && <p className="mb-4 text-sm text-red-600">Could not load categories.</p>}
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {partial && (
          <p className="mb-4 text-sm text-slate-700">
            Ticket {partial.ticket_number} was created.{" "}
            <Link className="underline" href={`/client/tickets/${partial.id}`}>
              Open it
            </Link>{" "}
            to retry the attachment.
          </p>
        )}

        <button
          type="submit"
          disabled={create.isPending || partial !== null}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {create.isPending ? "Submitting..." : "Submit Ticket"}
        </button>
      </form>
    </main>
  );
}
