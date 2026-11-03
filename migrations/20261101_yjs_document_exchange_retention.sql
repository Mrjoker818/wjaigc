-- Additive maintenance index; the original receipt migration remains unchanged.
CREATE INDEX wujie_document_exchange_sessions_retention_idx
  ON wujie_document_exchange_sessions(retain_until, session_hash);
