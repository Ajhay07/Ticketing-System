"use client";

import { ArrowRight } from "lucide-react";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { StatusCounts } from "@/components/StatusCounts";
import { ButtonLink } from "@/components/ui/Button";
import { Page } from "@/components/ui/Card";
import { DashboardGreeting } from "@/components/dashboard/Editorial";

/** Team dashboard. Team members see only tickets assigned to them (decision #5). */
export default function TeamDashboardPage() {
  return (
    <Page>
      <DashboardGreeting
        section="ClickfieldAI Team"
        description="Team workspace: your assigned work at a glance."
        actions={
          <ButtonLink href="/team/tickets" variant="primary">
            My Assigned Tickets
            <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        }
      />
      <StatusCounts statuses={["ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "REOPENED"]} />
      <NotificationsPanel ticketBasePath="/team/tickets" />
    </Page>
  );
}
