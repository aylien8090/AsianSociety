import { json, requireAdmin, ensureSchema, code } from "../_shared";

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
  // "draft" = registered but hasn't tapped "Paid!" yet. Those never reach the dashboard.
  const { results } = await env.TICKETS_DB.prepare("SELECT code, email, name, year, background, phone, tier, vegan, pay_method, note, status, created_at, paid_at, emailed_at, used_at FROM tickets WHERE status != 'draft' ORDER BY created_at DESC").all();
  return json({ tickets: results });
}

// Organiser adds a team member directly: a free ticket that is already confirmed.
export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2) return json({ error: "Enter a name and a valid email." }, 400);
  await ensureSchema(env);
  const taken = await env.TICKETS_DB.prepare("SELECT code FROM tickets WHERE lower(email) = ?").bind(email).first();
  if (taken) return json({ error: `That email already has a ticket (${taken.code}). Use "Ticket type" on that ticket to make it a team ticket.` }, 409);
  const phone = String(body.phone || "").replace(/[^\d+() -]/g, "").trim().slice(0, 30);
  const vegan = body.vegan === "yes" ? "yes" : body.vegan === "no" ? "no" : "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const ticketCode = code();
    try {
      await env.TICKETS_DB.prepare("INSERT INTO tickets (code, email, name, year, background, status, phone, tier, vegan, paid_at) VALUES (?, ?, ?, '', '', 'paid', ?, 'team', ?, CURRENT_TIMESTAMP)")
        .bind(ticketCode, email, name, phone, vegan).run();
      return json({ ok: true, code: ticketCode });
    } catch (error) {
      if (!String(error.message).includes("UNIQUE")) return json({ error: "Could not save the team member." }, 500);
    }
  }
  return json({ error: "Could not create a ticket code. Please try again." }, 500);
}
