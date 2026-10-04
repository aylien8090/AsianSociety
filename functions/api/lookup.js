import { json, ensureSchema, PRICES } from "./_shared";

// "Already got a ticket?": the visitor types their email and sees where their ticket is at.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
  await ensureSchema(env);
  const t = await env.TICKETS_DB.prepare("SELECT code, name, status, tier, used_at, note FROM tickets WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if (!t) return json({ found: false });
  const tier = t.tier === "prereg" ? "prereg" : "early";
  return json({ found: true, code: t.code, name: t.name, status: t.status, tier, price: PRICES[tier], used: !!t.used_at, note: t.note || "" });
}
