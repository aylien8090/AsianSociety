import { json, requireAdmin, ensureSchema } from "../_shared";

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
  // "draft" = registered but hasn't tapped "Paid!" yet. The dashboard keeps these out of the main list and counts.
  const { results } = await env.TICKETS_DB.prepare("SELECT code, email, name, year, background, phone, tier, note, status, created_at, paid_at, emailed_at, used_at FROM tickets ORDER BY created_at DESC").all();
  return json({ tickets: results });
}
