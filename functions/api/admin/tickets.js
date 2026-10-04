import { json, requireAdmin } from "../_shared";

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  const { results } = await env.TICKETS_DB.prepare("SELECT code, email, name, year, background, status, created_at, paid_at, emailed_at FROM tickets ORDER BY created_at DESC").all();
  return json({ tickets: results });
}
