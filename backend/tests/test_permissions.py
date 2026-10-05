"""Unit tests for the application-layer permission matrix and ticket state
machine (spec §3, §5, §29, §30, decision #5, #9). No database required - this
is the second enforcement layer on top of RLS, and is tested independently of
it.
"""

from __future__ import annotations

import pytest

from app.core.security import Principal, Role
from app.domain import permissions, state_machine


def _principal(role: Role, *, user_id: str = "u1", organization_id: str = "org-1") -> Principal:
    return Principal(
        user_id=user_id, organization_id=organization_id, role=role, email="x@example.com", raw_token="t"
    )


def test_team_member_cannot_view_unassigned_queue() -> None:
    assert not permissions.can_view_unassigned_queue(_principal(Role.TEAM_MEMBER))


def test_admin_can_view_unassigned_queue() -> None:
    assert permissions.can_view_unassigned_queue(_principal(Role.ADMIN))


def test_team_member_sees_only_assigned_tickets() -> None:
    p = _principal(Role.TEAM_MEMBER, user_id="arjun")
    assert permissions.can_view_ticket(p, ticket_organization_id="org-1", ticket_assigned_to="arjun")
    assert not permissions.can_view_ticket(p, ticket_organization_id="org-1", ticket_assigned_to="karthik")
    assert not permissions.can_view_ticket(p, ticket_organization_id="org-1", ticket_assigned_to=None)


def test_client_cannot_view_other_org_ticket() -> None:
    p = _principal(Role.CLIENT_USER, organization_id="org-a")
    assert permissions.can_view_ticket(p, ticket_organization_id="org-a", ticket_assigned_to=None)
    assert not permissions.can_view_ticket(p, ticket_organization_id="org-b", ticket_assigned_to=None)


def test_client_cannot_view_internal_notes() -> None:
    assert not permissions.can_view_internal_note(_principal(Role.CLIENT_ADMIN))
    assert permissions.can_view_internal_note(_principal(Role.TEAM_MEMBER))


def test_only_admin_or_super_admin_assigns_tickets() -> None:
    assert permissions.can_assign_ticket(_principal(Role.ADMIN))
    assert permissions.can_assign_ticket(_principal(Role.SUPER_ADMIN))
    assert not permissions.can_assign_ticket(_principal(Role.TEAM_MEMBER))
    assert not permissions.can_assign_ticket(_principal(Role.CLIENT_ADMIN))


def test_client_admin_cannot_manage_users_in_v1() -> None:
    assert not permissions.can_manage_client_users(_principal(Role.CLIENT_ADMIN))
    assert permissions.can_manage_client_users(_principal(Role.ADMIN))


def test_only_super_admin_can_hard_delete() -> None:
    assert permissions.can_hard_delete(_principal(Role.SUPER_ADMIN))
    assert not permissions.can_hard_delete(_principal(Role.ADMIN))


# --- state machine -----------------------------------------------------


def test_legal_transition_is_allowed() -> None:
    state_machine.assert_transition_allowed(
        from_status=state_machine.OPEN, to_status=state_machine.TRIAGED, role=Role.ADMIN
    )


def test_illegal_transition_is_rejected() -> None:
    with pytest.raises(state_machine.IllegalTransition):
        state_machine.assert_transition_allowed(
            from_status=state_machine.OPEN, to_status=state_machine.CLOSED, role=Role.ADMIN
        )


def test_client_cannot_assign_ticket_via_state_machine() -> None:
    with pytest.raises(state_machine.IllegalTransition):
        state_machine.assert_transition_allowed(
            from_status=state_machine.TRIAGED, to_status=state_machine.ASSIGNED, role=Role.CLIENT_ADMIN
        )


def test_client_can_close_resolved_ticket() -> None:
    state_machine.assert_transition_allowed(
        from_status=state_machine.RESOLVED, to_status=state_machine.CLOSED, role=Role.CLIENT_USER
    )


def test_unlimited_reopen_from_closed_is_allowed() -> None:
    state_machine.assert_transition_allowed(
        from_status=state_machine.CLOSED, to_status=state_machine.REOPENED, role=Role.CLIENT_USER
    )


def test_team_member_cannot_reopen_closed_ticket() -> None:
    with pytest.raises(state_machine.IllegalTransition):
        state_machine.assert_transition_allowed(
            from_status=state_machine.CLOSED, to_status=state_machine.REOPENED, role=Role.TEAM_MEMBER
        )
