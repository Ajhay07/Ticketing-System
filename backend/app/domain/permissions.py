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


def can_hard_delete(principal: Principal) -> bool:
    """Spec §44: only Super Admin, and only via the privileged path."""
    return principal.role == Role.SUPER_ADMIN
