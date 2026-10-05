"""Application-layer permission matrix.

This is a SECOND, independent enforcement layer on top of Postgres RLS
(supabase/migrations/0002_rls.sql). CLAUDE.md requires both layers for every
tenant-scoped resource — a bug in one must not be exploitable because the
other still blocks it. Mirrors spec §3.1-3.4, §29, §30, decision #5.
"""

from __future__ import annotations

from app.core.security import Principal, Role


def can_view_unassigned_queue(principal: Principal) -> bool:
    """Spec decision #5: unassigned queue is ADMIN/CTO/SUPER_ADMIN only."""
    return principal.role in (Role.SUPER_ADMIN, Role.ADMIN)


def can_view_ticket(
    principal: Principal, *, ticket_organization_id: str, ticket_assigned_to: str | None
) -> bool:
    if principal.role in (Role.SUPER_ADMIN, Role.ADMIN):
        return True
    if principal.role == Role.TEAM_MEMBER:
        return ticket_assigned_to == principal.user_id
    # CLIENT_ADMIN / CLIENT_USER
    return ticket_organization_id == principal.organization_id


def can_create_ticket(principal: Principal, *, target_organization_id: str) -> bool:
    if principal.role.is_internal:
        return True
    return target_organization_id == principal.organization_id


def can_view_internal_note(principal: Principal) -> bool:
    """Internal notes are never visible to clients (spec §11, §23)."""
    return principal.role.is_internal


def can_write_internal_note(principal: Principal, *, ticket_assigned_to: str | None) -> bool:
    if principal.role in (Role.SUPER_ADMIN, Role.ADMIN):
        return True
    if principal.role == Role.TEAM_MEMBER:
        return ticket_assigned_to == principal.user_id
    return False


def can_assign_ticket(principal: Principal) -> bool:
    """Spec §15: assignment is a CTO/admin action."""
    return principal.role in (Role.SUPER_ADMIN, Role.ADMIN)


def can_manage_client_users(principal: Principal) -> bool:
    """Decision #7: only SUPER_ADMIN/ADMIN manage client users in V1."""
    return principal.role in (Role.SUPER_ADMIN, Role.ADMIN)


def can_close_ticket(principal: Principal, *, ticket_organization_id: str) -> bool:
    """Spec §42: client (on their own ticket) or admin/CTO may close.
    Team members may not permanently close unless explicitly permitted (not
    granted in V1)."""
    if principal.role in (Role.SUPER_ADMIN, Role.ADMIN):
        return True
    if principal.role in (Role.CLIENT_ADMIN, Role.CLIENT_USER):
        return ticket_organization_id == principal.organization_id
    return False


def can_create_client_ticket(principal: Principal) -> bool:
    """Spec §9: tickets are created by client users, always in their own
    organization (the target org is the JWT's org, never client input)."""
    return principal.role in (Role.CLIENT_ADMIN, Role.CLIENT_USER) and can_create_ticket(
        principal, target_organization_id=principal.organization_id
    )


def can_resolve_ticket(principal: Principal, *, ticket_assigned_to: str | None) -> bool:
    """Spec §41: the developer (assignee) or admin/CTO marks a ticket resolved."""
    if principal.role in (Role.SUPER_ADMIN, Role.ADMIN):
        return True
    if principal.role == Role.TEAM_MEMBER:
        return ticket_assigned_to == principal.user_id
    return False


def can_reopen_ticket(principal: Principal, *, ticket_organization_id: str) -> bool:
    """Spec §41 "Still an Issue" / decision #9: the client (own org) or
    admin/CTO may reopen. Same population as closing."""
    return can_close_ticket(principal, ticket_organization_id=ticket_organization_id)


def can_change_ticket_status(
    principal: Principal, *, ticket_organization_id: str, ticket_assigned_to: str | None
) -> bool:
    """Generic status changes require being able to see the ticket at all;
    which specific transitions are allowed per role is decided by
    app.domain.state_machine."""
    return can_view_ticket(
        principal, ticket_organization_id=ticket_organization_id, ticket_assigned_to=ticket_assigned_to
    )


def can_write_comment(
    principal: Principal,
    *,
    visibility: str,
    ticket_organization_id: str,
    ticket_assigned_to: str | None,
) -> bool:
    """Spec §11, §23: clients may only write CLIENT-visible comments on their
    own org's tickets; INTERNAL notes follow can_write_internal_note."""
    if visibility == "INTERNAL":
        return can_write_internal_note(principal, ticket_assigned_to=ticket_assigned_to)
    return can_view_ticket(
        principal, ticket_organization_id=ticket_organization_id, ticket_assigned_to=ticket_assigned_to
    )


def can_triage_ticket(principal: Principal) -> bool:
    """Spec §3.1/§3.2: change priority, category, set due dates - CTO/admin."""
    return principal.role in (Role.SUPER_ADMIN, Role.ADMIN)


def can_soft_delete_ticket(principal: Principal) -> bool:
    """Spec §44: archive/soft delete is an admin (CTO) / super admin action.
    Clients cannot delete (spec §30); team members are not granted it."""
    return principal.role in (Role.SUPER_ADMIN, Role.ADMIN)


def can_hard_delete(principal: Principal) -> bool:
    """Spec §44: only Super Admin, and only via the privileged path."""
    return principal.role == Role.SUPER_ADMIN
