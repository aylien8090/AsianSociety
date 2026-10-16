import { json, requireAdmin, ensureSchema, code } from "../_shared";

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
  // "draft" = registered but hasn't tapped "Paid!" yet. They are sent to the dashboard too, but the
  // dashboard keeps them out of the list, counts and new-registration ping. Searching finds them.
  const { results } = await env.TICKETS_DB.prepare("SELECT code, email, name, year, background, phone, tier, vegan, pay_method, note, status, created_at, paid_at, emailed_at, used_at FROM tickets ORDER BY created_at DESC").all();
  return json({ tickets: results });
}

// Organiser adds a person by hand (works even though online ticket sales are closed).
// body: name, email, phone?, vegan?, tier? (default "team"), paid? (default true), checkedIn? (default false)
export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2) return json({ error: "Enter a name and a valid email." }, 400);
  const tier = ["early", "prereg", "regular", "late", "team", "teamdisc", "referral"].includes(body.tier) ? body.tier : "team";
  const paid = body.paid !== false;
  const checkedIn = paid && body.checkedIn === true;
  await ensureSchema(env);
  const taken = await env.TICKETS_DB.prepare("SELECT code FROM tickets WHERE lower(email) = ?").bind(email).first();
  if (taken) return json({ error: `That email already has a ticket (${taken.code}). Search for it and change its ticket type instead.` }, 409);
  const phone = String(body.phone || "").replace(/[^\d+() -]/g, "").trim().slice(0, 30);
  const vegan = body.vegan === "yes" ? "yes" : body.vegan === "no" ? "no" : "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const ticketCode = code();
    try {
      await env.TICKETS_DB.prepare(
        "INSERT INTO tickets (code, email, name, year, background, status, phone, tier, vegan, paid_at, used_at) VALUES (?, ?, ?, '', '', ?, ?, ?, ?, " +
        (paid ? "CURRENT_TIMESTAMP" : "NULL") + ", " + (checkedIn ? "CURRENT_TIMESTAMP" : "NULL") + ")")
        .bind(ticketCode, email, name, paid ? "paid" : "pending", phone, tier, vegan).run();
      return json({ ok: true, code: ticketCode });
    } catch (error) {
      if (!String(error.message).includes("UNIQUE")) return json({ error: "Could not save that person." }, 500);
    }
  }
  return json({ error: "Could not create a ticket code. Please try again." }, 500);
}
