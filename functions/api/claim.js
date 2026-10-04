import { json, ensureSchema } from "./_shared";

// The visitor tapped "Paid!": move their ticket from hidden draft to the organiser's pending list.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const code = String(body.code || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();
  await ensureSchema(env);
  const ticket = await env.TICKETS_DB.prepare("SELECT status FROM tickets WHERE code = ? AND lower(email) = ?").bind(code, email).first();
  if (!ticket) return json({ error: "Ticket not found" }, 404);
  if (ticket.status !== "draft") return json({ ok: true, status: ticket.status });
  await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'pending' WHERE code = ? AND status = 'draft'").bind(code).run();
  return json({ ok: true, status: "pending" });
}
