-- Clickfield AI Ticketing System
-- Migration 0005: TEAM_REPLY notification type
-- Spec refs: §19, §26, §65 (step: team replies, client is notified).
--
-- Phase 2 already enqueues a "TEAM_REPLY" job when staff post a
-- client-visible reply, but neither enum in 0001 had a matching value, so no
-- in-app row or email_logs row could be written for it. Extend both enums.
-- (ADD VALUE IF NOT EXISTS keeps this idempotent; the new values are not used
-- inside this migration, so running it in one transaction is safe.)

alter type notification_type add value if not exists 'TEAM_REPLY';
alter type email_notification_type add value if not exists 'TEAM_REPLY';
