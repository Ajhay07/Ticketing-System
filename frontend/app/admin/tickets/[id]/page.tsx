"use client";

import { useParams } from "next/navigation";
import { TicketDetail } from "@/components/tickets/TicketDetail";

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  return <TicketDetail ticketId={params.id} backHref="/admin/tickets" />;
}
