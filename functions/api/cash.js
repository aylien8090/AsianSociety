import { json, ensureSchema } from "./_shared";

// The visitor chose to pay with cash. Their seat is reserved and the ticket stays
// unpaid (pending, flagged "cash") until the organiser receives the cash and marks it paid.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const code = String(body.code || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();
  await ensureSchema(env);
  const ticket = await env.TICKETS_DB.prepare("SELECT status FROM tickets WHERE code = ? AND lower(email) = ?").bind(code, email).first();
  if (!ticket) return json({ error: "Ticket not found" }, 404);
  if (ticket.status === "paid" || ticket.status === "emailed") return json({ ok: true, status: ticket.status, cash: false });
  await env.TICKETS_DB.prepare("UPDATE tickets SET pay_method = 'cash', status = 'pending' WHERE code = ?").bind(code).run();
  return json({ ok: true, status: "pending", cash: true });
}
