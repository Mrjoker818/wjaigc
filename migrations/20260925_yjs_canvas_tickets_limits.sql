CREATE INDEX IF NOT EXISTS wujie_document_tickets_actor_expiry_idx
  ON wujie_document_tickets (user_id, project_id, expires_at)
  WHERE consumed_at IS NULL;
