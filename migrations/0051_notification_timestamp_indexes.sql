CREATE INDEX IF NOT EXISTS manager_notifications_newest_idx
  ON manager_notifications (manager_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS chef_notifications_newest_idx
  ON chef_notifications (chef_id, created_at DESC, id DESC);
