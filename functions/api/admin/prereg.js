import { json, requireAdmin, ensureSchema } from "../_shared";

// Pre-registration list (people who get the first-release price). Managed from the dashboard.
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
  const row = await env.TICKETS_DB.prepare("SELECT COUNT(*) AS n FROM prereg").first();
  return json({ count: row ? row.n : 0 });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  await ensureSchema(env);
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 2000)
    .map(r => ({ email: String(r.email || "").trim().toLowerCase(), name: String(r.name || "").trim().slice(0, 120) }))
    .filter(r => /^\S+@\S+\.\S+$/.test(r.email));
  if (!rows.length) return json({ error: "No valid emails found in that file." }, 400);
  const statement = env.TICKETS_DB.prepare("INSERT OR REPLACE INTO prereg (email, name) VALUES (?, ?)");
  for (let i = 0; i < rows.length; i += 50) {
    await env.TICKETS_DB.batch(rows.slice(i, i + 50).map(r => statement.bind(r.email, r.name)));
  }
  const total = await env.TICKETS_DB.prepare("SELECT COUNT(*) AS n FROM prereg").first();
  return json({ imported: rows.length, count: total ? total.n : rows.length });
}
