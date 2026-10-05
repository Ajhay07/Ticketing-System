"""Ticket lifecycle state machine (spec §5, §41, §42, decision #9).

Every status transition must go through `assert_transition_allowed`. Illegal
transitions raise `IllegalTransition`, which routers translate to 409/422.
Legal transitions are intentionally a strict allow-list so new statuses or
shortcuts cannot be introduced without a deliberate change here.
"""

from __future__ import annotations

from app.core.security import Role

OPEN = "OPEN"
TRIAGED = "TRIAGED"
ASSIGNED = "ASSIGNED"
IN_PROGRESS = "IN_PROGRESS"
WAITING_FOR_CLIENT = "WAITING_FOR_CLIENT"
RESOLVED = "RESOLVED"
CLOSED = "CLOSED"
REOPENED = "REOPENED"

ALL_STATUSES = {
    OPEN,
    TRIAGED,
    ASSIGNED,
    IN_PROGRESS,
    WAITING_FOR_CLIENT,
    RESOLVED,
    CLOSED,
    REOPENED,
}

# (from_status, to_status) -> set of roles allowed to perform it.
_TRANSITIONS: dict[tuple[str, str], set[Role]] = {
    (OPEN, TRIAGED): {Role.SUPER_ADMIN, Role.ADMIN},
    (TRIAGED, ASSIGNED): {Role.SUPER_ADMIN, Role.ADMIN},
    (OPEN, ASSIGNED): {Role.SUPER_ADMIN, Role.ADMIN},  # assign + skip triage
    (ASSIGNED, IN_PROGRESS): {Role.SUPER_ADMIN, Role.ADMIN, Role.TEAM_MEMBER},
    (IN_PROGRESS, WAITING_FOR_CLIENT): {Role.SUPER_ADMIN, Role.ADMIN, Role.TEAM_MEMBER},
    (WAITING_FOR_CLIENT, IN_PROGRESS): {
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.TEAM_MEMBER,
        Role.CLIENT_ADMIN,
        Role.CLIENT_USER,
    },
    (IN_PROGRESS, RESOLVED): {Role.SUPER_ADMIN, Role.ADMIN, Role.TEAM_MEMBER},
    (WAITING_FOR_CLIENT, RESOLVED): {Role.SUPER_ADMIN, Role.ADMIN, Role.TEAM_MEMBER},
    # Client confirms fix -> closed (spec §41 "Yes, Close Ticket")
    (RESOLVED, CLOSED): {
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.CLIENT_ADMIN,
        Role.CLIENT_USER,
    },
    # Client disputes fix -> reopened (spec §41 "Still an Issue")
    (RESOLVED, REOPENED): {
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.CLIENT_ADMIN,
        Role.CLIENT_USER,
    },
    # Spec §5: CLOSED -> REOPENED -> IN_PROGRESS. Unlimited reopens (decision #9).
    (CLOSED, REOPENED): {
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.CLIENT_ADMIN,
        Role.CLIENT_USER,
    },
    (REOPENED, IN_PROGRESS): {Role.SUPER_ADMIN, Role.ADMIN, Role.TEAM_MEMBER},
    (REOPENED, ASSIGNED): {Role.SUPER_ADMIN, Role.ADMIN},
}


class IllegalTransition(Exception):
    def __init__(self, from_status: str, to_status: str) -> None:
        super().__init__(f"Cannot transition ticket from {from_status} to {to_status}")
        self.from_status = from_status
        self.to_status = to_status


def assert_transition_allowed(*, from_status: str, to_status: str, role: Role) -> None:
    allowed_roles = _TRANSITIONS.get((from_status, to_status))
    if not allowed_roles or role not in allowed_roles:
        raise IllegalTransition(from_status, to_status)


def is_terminal(status: str) -> bool:
    return status == CLOSED
