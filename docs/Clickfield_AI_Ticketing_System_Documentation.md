# Clickfield AI — Client Ticketing & Support Platform
## Product & Technical Specification — v1.0

## 1. Product Objective

Clickfield AI needs a centralized ticketing platform to replace support requests currently coming through phone calls, WhatsApp messages, personal emails, and informal communication.

The platform must become the **single source of truth for client support and service requests**.

### Primary workflow

**Client raises issue → Ticket created → CTO notified → CTO reviews → CTO assigns team member → Team works → Client receives updates → Ticket resolved → Client closes ticket**

### Goals

The platform must be:

- Simple
- Fast
- Reliable
- Secure
- Easy for clients to use
- Easy for the CTO to manage
- Responsive on desktop, tablet, and mobile
- Email-enabled
- Multi-client
- Role-based
- Maintainable
- Cost-efficient

### Important constraint

**Do NOT build AI features in V1.**

No AI classification, AI summaries, AI agents, or LLM-based workflows are required.

The system must be completely functional using conventional software architecture.

---

# 2. Core Principle

The ticketing platform is the **source of truth**.

Email is a notification and communication layer.

The system must **not depend on email for the core ticket workflow**.

If an email notification fails:

- The ticket must still be created.
- The ticket must still appear in the dashboard.
- The CTO must still be able to assign it.
- The team must still be able to work on it.

Email failure must never cause ticket creation or ticket updates to fail.

---

# 3. User Roles

## 3.1 Super Admin

For Clickfield AI management.

Capabilities:

- Manage all clients
- Manage all users
- Manage team members
- View all tickets
- Create/edit/delete tickets
- Assign tickets
- Change ticket priority
- Change ticket status
- Configure categories
- Configure SLA settings
- View analytics
- Manage system settings

---

## 3.2 CTO / Admin

The primary operational user.

The CTO should be able to:

- View all client tickets
- Review new tickets
- Assign tickets to team members
- Change priority
- Set due dates
- Add internal notes
- Communicate with clients
- Monitor overdue tickets
- Reassign tickets
- Resolve tickets
- Reopen tickets
- View ticket history
- View client history
- View team workload

The CTO dashboard should answer:

> **What needs my attention right now?**

---

## 3.3 Team Member / Developer

Team members should only see tickets they are authorized to see.

Capabilities:

- View assigned tickets
- View ticket details
- Reply to client
- Add internal notes
- Upload files
- Change status
- Mark ticket as resolved
- View ticket history

Team members should NOT be able to:

- Delete tickets
- Delete audit history
- Manage users
- Change system settings
- View unrelated clients unless permission is granted

---

## 3.4 Client

Clients should only have access to their own organization's data.

Capabilities:

- Login
- Create tickets
- View their organization's tickets
- View ticket status
- Reply to tickets
- Upload attachments
- View ticket history
- Close/confirm resolved tickets
- Reopen tickets if necessary

Clients must NEVER be able to see:

- Other clients
- Other organizations
- Internal notes
- Internal team discussions
- Admin-only information

---

# 4. Multi-Tenant Architecture

The platform must support multiple Clickfield AI clients.

Example:

```text
Clickfield AI
│
├── Client: NK Hospital
│   ├── User A
│   └── User B
│
├── Client: ABC Company
│   ├── User A
│   └── User B
│
└── Client: XYZ Company
    └── User A
```

Every client organization must have isolated data.

A user belonging to NK Hospital must never be able to access ABC Company's tickets.

This must be enforced at the **database/security layer**, not only in frontend code.

---

# 5. Ticket Lifecycle

Recommended status flow:

```text
OPEN
  ↓
TRIAGED
  ↓
ASSIGNED
  ↓
IN PROGRESS
  ↓
WAITING FOR CLIENT
  ↓
IN PROGRESS
  ↓
RESOLVED
  ↓
CLOSED
```

Tickets may also be reopened:

```text
CLOSED
  ↓
REOPENED
  ↓
IN PROGRESS
```

## Status definitions

### Open

Ticket has been submitted but hasn't been reviewed.

### Triaged

CTO/admin has reviewed the ticket and determined what needs to happen.

### Assigned

Ticket has been assigned to a team member.

### In Progress

Team member is actively working on the issue.

### Waiting for Client

Work cannot continue because information/action is required from the client.

### Resolved

Team member believes the issue has been fixed.

### Closed

Client or authorized admin confirms the issue is complete.

### Reopened

Client reports that the issue is still not resolved.

---

# 6. Ticket Priority

Four priority levels:

### Low

Minor issue with little impact.

### Medium

Normal support request.

### High

Important issue affecting operations.

### Critical

Major production/business outage requiring immediate attention.

Priority must be visible throughout the dashboard.

---

# 7. Ticket Categories

Initial categories:

- Bug
- Technical Issue
- Website
- Mobile App
- Backend/API
- Database
- Hosting/Deployment
- Security
- Account/Access
- Change Request
- Feature Request
- Maintenance
- Other

Admin should be able to add/edit categories later.

---

# 8. Ticket Number

Every ticket must receive a unique human-readable ticket number.

Format:

```text
CF-000001
CF-000002
CF-000003
```

Example:

**CF-001284**

The ticket ID must remain permanent.

Do not reuse ticket numbers after deletion.

Prefer soft deletion rather than physical deletion.

---

# 9. Ticket Creation

Client clicks:

**Create New Ticket**

### Required fields

- Subject
- Description
- Category
- Priority

### Optional fields

- Attachment
- Additional details

Example:

```text
Subject:
Website login not working

Category:
Bug

Priority:
High

Description:
Users are getting an error when trying to login.
The issue started this morning.
```

After submission:

1. Ticket is created.
2. Ticket number is generated.
3. Ticket status = OPEN.
4. Client sees confirmation.
5. CTO receives email notification.
6. Client receives ticket confirmation email.

---

# 10. Ticket Detail Page

The ticket detail page is the most important screen.

Example:

```text
CF-001284

Website Login Not Working

Client:
NK Hospital

Priority:
HIGH

Status:
IN PROGRESS

Assigned To:
Arjun

Created:
04 Oct 2026, 10:32 AM

Due:
04 Oct 2026, 5:00 PM
```

Below:

### Conversation

```text
CLIENT
04 Oct 2026 10:32 AM

Login isn't working for our reception team.

--------------------------------

ARJUN
04 Oct 2026 11:15 AM

We're checking the authentication service.

--------------------------------

CLIENT
04 Oct 2026 11:20 AM

Okay.
```

The interface should resemble a clean conversation thread.

---

# 11. Internal Notes

Internal notes are critical.

A team member/CTO should be able to write:

> Checked production logs. Authentication API is returning 401 because of expired configuration.

The client must NOT see this.

Example:

```text
INTERNAL NOTE

Checked Supabase authentication logs.
Issue appears related to expired configuration.

Visible only to Clickfield AI team.
```

Internal notes must be stored separately from client-visible messages.

---

# 12. Attachments

Tickets must support attachments.

Supported examples:

- PNG
- JPG/JPEG
- PDF
- DOC/DOCX
- XLS/XLSX
- CSV
- ZIP

Recommended initial limit:

**25 MB per file**

Files should be stored in object storage rather than directly inside PostgreSQL.

Every attachment must have:

- Filename
- File size
- MIME type
- Uploaded by
- Uploaded timestamp
- Ticket ID

---

# 13. CTO Dashboard

The CTO dashboard is the primary internal dashboard.

Top-level metrics:

```text
OPEN             24
IN PROGRESS      12
WAITING CLIENT    7
OVERDUE           4
RESOLVED TODAY    8
```

### Priority Queue

```text
CRITICAL
2 tickets

HIGH
7 tickets

MEDIUM
13 tickets

LOW
9 tickets
```

### Recent Tickets

Columns:

- Ticket
- Client
- Subject
- Category
- Priority
- Assigned To
- Status
- Created
- Due
- Last Updated

---

# 14. CTO Filters

The CTO should be able to filter by:

- Status
- Priority
- Client
- Assignee
- Category
- Created date
- Due date
- Overdue
- Unassigned

Search should support:

- Ticket number
- Subject
- Client
- User
- Description

---

# 15. Unassigned Queue

Create a dedicated view:

**Unassigned Tickets**

Example:

```text
CF-001281   Website down        CRITICAL
CF-001282   Payment issue       HIGH
CF-001283   Add new user        MEDIUM
```

CTO can click:

**Assign**

and select:

```text
Arjun
Karthik
Vignesh
Ashwin
```

After assignment:

- Ticket assignee changes.
- Team member receives email notification.
- Assignment is added to audit history.

---

# 16. Team Workload

CTO should be able to see:

```text
TEAM MEMBER       OPEN    IN PROGRESS    OVERDUE

Arjun               4          3            1
Karthik             7          2            0
Vignesh             2          4            1
```

This helps the CTO decide who should receive the next ticket.

---

# 17. Client Dashboard

Client login should show:

```text
My Tickets

OPEN                 3
IN PROGRESS          2
WAITING FOR CLIENT   1
RESOLVED             5
```

Main button:

**+ Create New Ticket**

Ticket list:

- Ticket number
- Subject
- Status
- Priority
- Created
- Last updated

---

# 18. Client Organization

Each client should have an organization.

Example:

```text
Organization:
NK Hospital

Users:
- admin@nkhospital.com
- manager@nkhospital.com
- support@nkhospital.com
```

The organization can have multiple users.

Admin should be able to:

- Add user
- Disable user
- Change role
- Reset access
- Remove user

---

# 19. Email Notifications

Email is a core requirement.

The system must send emails for important events.

## New Ticket

Recipient:

**CTO/Admin**

Subject:

```text
[Clickfield AI] New Ticket CF-001284 — Website Login Issue
```

---

## Ticket Assigned

Recipient:

**Assigned team member**

Subject:

```text
[Clickfield AI] Ticket CF-001284 Assigned to You
```

---

## New Client Reply

Recipient:

**Assigned team member + CTO where appropriate**

Subject:

```text
[Clickfield AI] New Reply — CF-001284
```

---

## Status Changed

Client receives:

```text
Your ticket CF-001284 has been updated.

Status:
In Progress
```

---

## Ticket Resolved

Client receives:

```text
Your ticket CF-001284 has been marked as resolved.

Please review the ticket and confirm if the issue is fixed.
```

---

## Ticket Closed

Client receives:

```text
Ticket CF-001284 has been closed.
```

---

# 20. Email Provider

The system should support a transactional email provider.

Recommended:

**Resend**

Alternatives:

- SendGrid
- Amazon SES
- SMTP

The architecture should keep the email service abstract enough that the provider can be changed later.

The system must log email delivery attempts.

Example:

```text
email_notifications

ticket_id
recipient
notification_type
provider
status
sent_at
error_message
```

---

# 21. Outlook / Gmail

The CTO can receive notifications in the company's existing Outlook or Gmail inbox.

The ticketing system itself does not need to be hosted inside Outlook/Gmail.

Flow:

```text
Client
   ↓
Ticketing System
   ↓
Email Notification
   ↓
CTO Outlook/Gmail
```

The CTO then opens the ticketing system from the email using:

**Open Ticket**

---

# 22. Optional Email-to-Ticket — Phase 2

Do not make this mandatory for V1.

Later, clients can email:

```text
support@clickfieldai.com
```

The system can automatically create a ticket.

Example:

Client email:

```text
To: support@clickfieldai.com

Subject:
Website is down

The website isn't loading.
```

System creates:

```text
CF-001300

Website is down
```

This feature should be implemented only after the core portal is stable.

---

# 23. Ticket Comments

Comments must support:

- Text
- Attachments
- Timestamp
- Author
- Visibility

Visibility:

```text
CLIENT
INTERNAL
```

Never rely on frontend hiding for internal comments.

Backend/database authorization must enforce visibility.

---

# 24. Audit Log

Every important action must be recorded.

Examples:

```text
CF-001284 created by Client

Priority changed:
Medium → High

Status changed:
Open → In Progress

Assigned:
Unassigned → Arjun

Internal note added

Client reply added

Status changed:
In Progress → Resolved
```

Audit logs should include:

- User
- Action
- Previous value
- New value
- Timestamp
- Ticket ID
- IP address where appropriate

Audit logs should be immutable for normal users.

---

# 25. SLA / Due Dates

V1 should support basic SLA tracking.

Example configuration:

```text
Critical → 2 hours
High     → 8 hours
Medium   → 24 hours
Low      → 72 hours
```

These values must be configurable.

The system should calculate:

- Response deadline
- Resolution deadline
- Overdue status

Example:

```text
CF-001284

HIGH

Due:
Today 5:00 PM

Status:
⚠ OVERDUE
```

Do not automatically close overdue tickets.

---

# 26. Notifications

Notifications should include:

- Email
- In-app notification

In-app notifications:

```text
🔔 New ticket assigned to you
🔔 Client replied to CF-001284
🔔 Ticket CF-001284 is overdue
🔔 Ticket CF-001284 was resolved
```

A user should be able to mark notifications as read.

---

# 27. Database Design

Recommended PostgreSQL schema.

## organizations

```text
id
name
slug
logo_url
status
created_at
updated_at
```

## users

```text
id
organization_id
name
email
role
avatar_url
status
created_at
updated_at
```

## tickets

```text
id
ticket_number
organization_id
created_by
assigned_to
subject
description
category_id
priority
status
due_at
resolved_at
closed_at
created_at
updated_at
```

## ticket_comments

```text
id
ticket_id
user_id
comment
visibility
created_at
updated_at
```

`visibility`:

```text
CLIENT
INTERNAL
```

## ticket_attachments

```text
id
ticket_id
comment_id
uploaded_by
file_name
storage_path
mime_type
file_size
created_at
```

## categories

```text
id
name
description
is_active
created_at
```

## notifications

```text
id
user_id
ticket_id
type
title
message
read_at
created_at
```

## audit_logs

```text
id
ticket_id
user_id
action
old_value
new_value
metadata
created_at
```

## email_logs

```text
id
ticket_id
recipient
notification_type
provider
status
provider_message_id
error_message
sent_at
created_at
```

---

# 28. Authentication

Use secure authentication.

Recommended:

**Supabase Auth**

Support:

- Email/password
- Password reset
- Email verification
- Session management
- Optional MFA later

Do not implement custom password hashing/authentication unless absolutely necessary.

---

# 29. Authorization

Use role-based access control.

Example:

```text
SUPER_ADMIN
ADMIN / CTO
TEAM_MEMBER
CLIENT_ADMIN
CLIENT_USER
```

Permissions must be enforced on the backend/database.

Frontend permissions are only for UX.

---

# 30. Database Security

If using Supabase/PostgreSQL, implement proper Row Level Security.

### Client

```text
organization_id = authenticated user's organization_id
```

Client can:

- SELECT own organization's tickets
- INSERT own organization's tickets
- INSERT comments on own tickets

Client cannot:

- SELECT other organizations
- SELECT internal comments
- UPDATE arbitrary tickets
- DELETE tickets

### Team members

- See authorized tickets
- Update assigned/authorized tickets
- Add internal notes

### Admin/CTO

- Full ticket access

---

# 31. File Security

Attachments must not be publicly accessible.

Use:

- Private storage buckets
- Signed URLs
- Access validation

Before returning a file, verify:

```text
Does this user have permission to access this ticket?
```

Never expose raw storage paths publicly.

---

# 32. Frontend Pages

## Public

```text
/login
/forgot-password
```

## Client

```text
/client/dashboard
/client/tickets
/client/tickets/new
/client/tickets/[id]
/client/profile
```

## Admin / CTO

```text
/admin/dashboard
/admin/tickets
/admin/tickets/[id]
/admin/clients
/admin/team
/admin/categories
/admin/reports
/admin/settings
```

## Team

```text
/team/dashboard
/team/tickets
/team/tickets/[id]
```

---

# 33. Ticket Creation UX

Keep the form extremely simple.

Do NOT make clients fill 20 fields.

Required:

```text
What do you need help with?

Subject
Category
Priority
Description
Attachment
```

The goal is:

**Client should be able to create a ticket in under 60 seconds.**

---

# 34. Dashboard UX

The UI should be:

- Clean
- Modern SaaS dashboard
- Desktop-first but responsive
- Mobile/tablet compatible
- Minimal animations
- Strong typography
- Clear status badges
- Clear priority indicators
- Fast to navigate

Avoid:

- Excessive gradients
- Excessive animations
- Unnecessary charts
- AI-style UI
- Complicated navigation

This is a business operations tool.

It should feel reliable.

---

# 35. Search

Global search should support:

```text
CF-001284
NK Hospital
login
payment
Arjun
```

Search results should show:

- Ticket
- Client
- Subject
- Status
- Priority

---

# 36. Sorting

Tickets should be sortable by:

- Newest
- Oldest
- Priority
- Due date
- Last updated
- Recently resolved

Default CTO sorting:

**Critical/high priority + overdue + newest**

---

# 37. Reports

V1 basic reporting:

### Ticket volume

Tickets created per:

- Day
- Week
- Month

### Resolution

- Average response time
- Average resolution time
- Tickets resolved
- Tickets reopened

### Client

- Tickets by client
- Open tickets by client
- Overdue tickets by client

### Team

- Tickets assigned
- Tickets resolved
- Open workload
- Average resolution time

---

# 38. Client Detail Page — CTO

When CTO opens a client:

```text
NK Hospital

Active Users: 4

Open Tickets: 6
In Progress: 3
Resolved This Month: 18

Recent Tickets
...
```

Also show:

- Contact information
- Users
- Ticket history
- Projects/services if added later

---

# 39. Ticket Assignment

Assignment must support:

```text
Unassigned
      ↓
Select team member
      ↓
Confirm assignment
```

Optional:

**Assign + change status to In Progress**

This saves one action for the CTO.

---

# 40. Ticket Reassignment

CTO can reassign.

Example:

```text
Arjun
↓
Karthik
```

The system must:

1. Update assignee.
2. Create audit record.
3. Notify new assignee.
4. Optionally notify old assignee.

---

# 41. Ticket Resolution

Developer clicks:

**Mark as Resolved**

System asks for:

```text
Resolution Summary

What was done?
```

Example:

> Fixed authentication configuration and deployed the updated API.

Client receives notification.

Client sees:

```text
Issue resolved?

[Yes, Close Ticket]

[Still an Issue]
```

If client selects **Still an Issue**, ticket becomes:

**REOPENED**

---

# 42. Closing Rules

Client can close a resolved ticket.

Admin/CTO can also close tickets.

Team members should not permanently close tickets unless explicitly permitted.

---

# 43. Prevent Accidental Closure

When closing:

```text
Are you sure you want to close CF-001284?

[Cancel]
[Close Ticket]
```

---

# 44. Delete Policy

Tickets should NOT normally be deleted.

Use:

**Archive / Soft Delete**

Reason:

Ticket history may be important for:

- Client disputes
- Billing
- SLA
- Audit
- Internal accountability

Only Super Admin should have permission to permanently delete data, if ever required.

---

# 45. Reliability Requirements

The system must handle:

- Duplicate requests
- Email failures
- Network interruptions
- Refreshes
- Concurrent updates
- Large attachments
- Multiple users editing the same ticket

Ticket creation should be transactional.

Correct flow:

```text
Create Ticket
      ↓
Database transaction
      ↓
Ticket committed
      ↓
Queue notification
      ↓
Send email
```

Incorrect flow:

```text
Send email
↓
Create ticket
```

---

# 46. Email Retry System

If email fails:

```text
Attempt 1 → Failed
Attempt 2 → Failed
Attempt 3 → Success
```

Store the failure.

The CTO must not lose the ticket because an email provider is temporarily unavailable.

---

# 47. Performance Requirements

Target:

- Dashboard initial load < 2 seconds under normal conditions
- Ticket detail page < 1.5 seconds
- Ticket creation < 2 seconds excluding file upload
- Search response < 500ms for normal queries

Use:

- Pagination
- Database indexes
- Efficient queries
- Lazy loading attachments
- Server-side filtering

Do not load every ticket into the browser.

---

# 48. Pagination

Ticket lists must be paginated.

Recommended:

```text
25 tickets/page
```

Allow:

```text
25
50
100
```

---

# 49. Database Indexes

At minimum index:

```text
tickets.ticket_number
tickets.organization_id
tickets.status
tickets.priority
tickets.assigned_to
tickets.created_at
tickets.updated_at
tickets.due_at
```

Composite indexes can be added based on real query patterns.

---

# 50. API Structure

Example REST API:

```text
POST   /api/tickets
GET    /api/tickets
GET    /api/tickets/:id
PATCH  /api/tickets/:id
POST   /api/tickets/:id/comments
POST   /api/tickets/:id/attachments
POST   /api/tickets/:id/assign
POST   /api/tickets/:id/resolve
POST   /api/tickets/:id/close
POST   /api/tickets/:id/reopen
```

Admin:

```text
GET    /api/admin/clients
POST   /api/admin/clients
PATCH  /api/admin/clients/:id

GET    /api/admin/team
POST   /api/admin/team

GET    /api/admin/reports
```

---

# 51. Suggested Architecture

```text
                    ┌─────────────────────┐
                    │      CLIENT         │
                    │   Web / Mobile      │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      NEXT.JS        │
                    │    Web Application  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      API / BFF      │
                    │     FastAPI         │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       ┌────────────┐   ┌────────────┐   ┌────────────┐
       │ PostgreSQL │   │  Storage   │   │   Redis    │
       │  Supabase  │   │ Attachments│   │ Queue/Jobs │
       └────────────┘   └────────────┘   └─────┬──────┘
                                                │
                                                ▼
                                         ┌─────────────┐
                                         │ Email Worker │
                                         │   Resend     │
                                         └─────────────┘
```

---

# 52. Recommended Stack

## Frontend

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
TanStack Query
```

## Backend

```text
FastAPI
Python
Pydantic
```

## Database

```text
PostgreSQL
Supabase
```

## Authentication

```text
Supabase Auth
```

## Storage

```text
Supabase Storage
```

Cloudflare R2 can be considered later if storage/egress economics justify it.

## Email

```text
Resend
```

## Background jobs

For V1, a lightweight job/queue architecture is sufficient.

If the existing Clickfield AI infrastructure already uses Redis/Celery, it can be reused.

---

# 53. Security Requirements

Security is a first-class requirement.

Implement:

- HTTPS
- Secure authentication
- Role-based authorization
- Database-level tenant isolation
- RLS where applicable
- Private file storage
- Signed file URLs
- Input validation
- Output encoding
- Rate limiting
- CSRF protection where applicable
- Secure cookies
- Session expiry
- Audit logs
- Password reset security
- Email verification
- File type validation
- File size validation

Never trust:

- Client-provided organization IDs
- Client-provided user IDs
- Client-provided role
- Client-provided permissions

Always derive authorization from the authenticated session.

---

# 54. Rate Limiting

Protect public/authenticated endpoints.

Examples:

- Login
- Password reset
- Ticket creation
- Comment creation
- File upload

Prevent abuse and accidental request storms.

---

# 55. Backup

Database backups must be enabled.

Recommended:

- Daily backups minimum
- Point-in-time recovery if available
- Storage redundancy

Attachments must also have an appropriate backup/recovery strategy.

---

# 56. Environment Variables

Never commit secrets.

Example:

```text
DATABASE_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

RESEND_API_KEY=

NEXT_PUBLIC_APP_URL=

STORAGE_BUCKET=
```

Use separate environments:

```text
Development
Staging
Production
```

---

# 57. Deployment

Recommended:

```text
Frontend → Vercel

Backend → VPS / Cloud Run / Azure / suitable container host

Database → Supabase PostgreSQL

Storage → Supabase Storage / R2

Email → Resend
```

Dockerize the backend.

Use CI/CD.

---

# 58. CI/CD

Every pull request should run:

```text
Typecheck
Lint
Unit Tests
Build
```

Production deployment should happen only after successful checks.

---

# 59. Testing

Minimum tests:

### Authentication

- Login
- Logout
- Password reset
- Unauthorized access

### Ticket

- Create
- Read
- Update
- Assign
- Comment
- Resolve
- Close
- Reopen

### Authorization

Test that:

```text
Client A cannot access Client B's ticket.
```

This test is mandatory.

### Attachments

- Upload valid file
- Reject invalid file
- Reject oversized file
- Verify access control

### Email

- New ticket notification
- Assignment notification
- Client reply notification
- Resolution notification

---

# 60. Critical Security Test

This MUST be explicitly tested.

Create:

```text
Organization A
Organization B
```

Create:

```text
Ticket A → Organization A
Ticket B → Organization B
```

Login as Organization A user.

Attempt:

```text
GET /tickets/TICKET_B
```

Expected:

```text
403 Forbidden
```

or equivalent secure denial.

Never return Ticket B data.

---

# 61. MVP Scope

V1 MUST contain:

### Authentication

- Login
- Logout
- Password reset

### Organizations

- Client organizations
- Client users

### Tickets

- Create
- View
- Update
- Assign
- Status
- Priority
- Category
- Comments
- Attachments

### CTO

- Dashboard
- Ticket queue
- Assignment
- Client management
- Team management

### Team

- Assigned tickets
- Comments
- Internal notes
- Resolution

### Client

- Dashboard
- Create ticket
- View tickets
- Reply
- Close/reopen

### Notifications

- Email notifications
- In-app notifications

### Security

- RBAC
- Tenant isolation
- Audit logs
- Private attachments

---

# 62. NOT in V1

Do not unnecessarily expand scope.

Not required:

- AI
- AI chatbot
- AI ticket classification
- AI summaries
- Voice support
- WhatsApp integration
- Mobile native applications
- Complex billing
- Advanced CRM
- Marketing automation
- Customer success module
- AI agents

These can be considered later.

---

# 63. Phase 2

After V1 is stable:

### Email-to-Ticket

```text
support@clickfieldai.com
```

### Advanced SLA

- Business hours
- Holiday calendars
- Escalations

### Customer satisfaction

After ticket closure:

```text
How was the support?

⭐ ⭐ ⭐ ⭐ ⭐
```

### Knowledge Base

Clients can search documentation before raising tickets.

### Canned Responses

Team members can use predefined replies.

### Recurring Tickets

Useful for maintenance contracts.

---

# 64. Phase 3

Potential future modules:

```text
Client Management
Projects
Tasks
Contracts
Subscriptions
Invoices
Documents
Asset Management
Knowledge Base
Service Level Management
```

This could eventually become:

**Clickfield AI Client Operations Platform**

But do NOT build these now.

---

# 65. Example Real-World Workflow

### Step 1

NK Hospital logs in.

### Step 2

Clicks:

**Create Ticket**

### Step 3

Enters:

```text
Subject:
Reception login not working

Category:
Bug

Priority:
High

Description:
Reception team cannot log in.
```

### Step 4

Ticket generated:

```text
CF-001284
```

### Step 5

CTO receives email:

```text
New Ticket CF-001284
NK Hospital
High Priority
```

### Step 6

CTO opens dashboard.

Sees:

```text
UNASSIGNED

CF-001284
Reception login not working
NK Hospital
HIGH
```

### Step 7

CTO assigns:

**Arjun**

### Step 8

Arjun receives email.

### Step 9

Arjun investigates.

Adds internal note:

```text
Authentication service configuration issue identified.
```

### Step 10

Arjun fixes the issue.

Changes status:

**Resolved**

Adds:

```text
Authentication configuration has been corrected.
Please verify login from the reception system.
```

### Step 11

NK Hospital receives email.

### Step 12

Client confirms:

**Issue Fixed**

### Step 13

Ticket becomes:

**Closed**

Complete history remains permanently available.

---

# 66. Definition of Done

V1 is considered complete only when:

- Client can create a ticket.
- CTO receives notification.
- Ticket appears in CTO dashboard.
- CTO can assign ticket.
- Team member receives notification.
- Team member can work on ticket.
- Client can communicate through ticket.
- Internal notes remain private.
- Attachments work securely.
- Status changes work.
- Resolution workflow works.
- Client can close/reopen.
- Email notifications work.
- Audit logs work.
- Multiple organizations are isolated.
- Unauthorized users cannot access other clients' tickets.
- Dashboard works on desktop/tablet/mobile.
- Database backups are configured.
- Production deployment is documented.
- Automated tests pass.

---

# 67. Developer Priority

Build in this order:

## Phase 1 — Foundation

1. Project setup
2. Authentication
3. Database
4. Organizations
5. Users
6. Roles/permissions

## Phase 2 — Core Ticketing

7. Ticket creation
8. Ticket list
9. Ticket detail
10. Status
11. Priority
12. Categories
13. Assignment
14. Comments
15. Internal notes
16. Attachments

## Phase 3 — CTO Operations

17. CTO dashboard
18. Unassigned queue
19. Team workload
20. Client management
21. Search/filter
22. Audit history

## Phase 4 — Notifications

23. Email service
24. New ticket emails
25. Assignment emails
26. Reply emails
27. Resolution emails
28. In-app notifications

## Phase 5 — Reliability

29. Error handling
30. Email retry
31. Logging
32. Rate limiting
33. Backup
34. Monitoring

## Phase 6 — Testing

35. Unit tests
36. Integration tests
37. Authorization tests
38. Tenant-isolation tests
39. E2E tests

## Phase 7 — Production

40. Staging deployment
41. Production deployment
42. Domain
43. SSL
44. Monitoring
45. Final security review

---

# 68. Final Product Principle

The system should answer these questions instantly:

### For the client

> **"Did Clickfield AI receive my issue?"**

### For the CTO

> **"What problems need my attention?"**

### For the team member

> **"What do I need to work on?"**

### For Clickfield AI

> **"What is the complete history of every client issue?"**

If the platform does those four things reliably, V1 is successful.

**Build reliability first. Features second.**

No AI is required.

No unnecessary complexity is required.

The objective is simple:

> **Stop clients from calling or WhatsApping individual Clickfield AI team members for work. Every request should become a trackable ticket.**
