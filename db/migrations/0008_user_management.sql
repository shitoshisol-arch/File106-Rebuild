-- User management: a 'banned' status sits alongside 'suspended' (temporary) and
-- 'deleted' (soft removal). Banned accounts cannot sign in and keep their
-- history so submissions and rewards stay auditable.
alter table users
  drop constraint if exists users_status_check;
alter table users
  add constraint users_status_check check (status in (
    'pending_verification', 'active', 'suspended', 'banned', 'deleted'
  ));
