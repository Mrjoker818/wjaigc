-- 删除前像与原命令回执同事务保存。历史命令保持 NULL，不能伪造恢复证明。
ALTER TABLE wujie_canvas_asset_commands
  ADD COLUMN IF NOT EXISTS remove_snapshot JSONB;
