import { json, requireAdmin, ensureSchema } from "../_shared";

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
  // "draft" = registered but hasn't tapped "Paid!" yet. Those never reach the dashboard.
  const { results } = await env.TICKETS_DB.prepare("SELECT code, email, name, year, background, phone, tier, vegan, note, status, created_at, paid_at, emailed_at, used_at FROM tickets WHERE status != 'draft' ORDER BY created_at DESC").all();
  return json({ tickets: results });
}
