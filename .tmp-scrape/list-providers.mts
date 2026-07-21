import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.PGDATABASE_URL || process.env.DATABASE_URL });
const res = await pool.query("SELECT id, name, base_url, model_type, selected_models FROM wujie_api_providers ORDER BY created_at");
for (const row of res.rows) {
  console.log(JSON.stringify({ id: row.id, name: row.name, base_url: row.base_url, model_type: row.model_type, selected_models: row.selected_models }));
}
await pool.end();
process.exit(0);
