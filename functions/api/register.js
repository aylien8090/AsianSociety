import { code, json, ensureSchema, PRICES } from "./_shared";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2) return json({ error: "Enter a valid name and email." }, 400);
  await ensureSchema(env);

  // Same email twice: show the existing ticket again instead of making a second one.
  const existing = await env.TICKETS_DB.prepare("SELECT code, name, status, tier, used_at, note FROM tickets WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if (existing) {
    const tier = existing.tier === "prereg" ? "prereg" : "early";
    return json({ existing: true, code: existing.code, name: existing.name, status: existing.status, tier, price: PRICES[tier], used: !!existing.used_at, note: existing.note || "" });
  }

  const vegan = body.vegan === "yes" ? "yes" : body.vegan === "no" ? "no" : "";
  if (!vegan) return json({ error: "Please choose Yes or No for vegan food only." }, 400);

  let tier = "early";
  if (body.prereg) {
    const listed = await env.TICKETS_DB.prepare("SELECT 1 AS ok FROM prereg WHERE email = ?").bind(email).first();
    if (!listed) return json({ error: "not_prereg" }, 404);
    tier = "prereg";
  }

  const phone = String(body.phone || "").replace(/[^\d+() -]/g, "").trim().slice(0, 30);
  for (let attempt = 0; attempt < 5; attempt++) {
    const ticketCode = code();
    try {
      await env.TICKETS_DB.prepare("INSERT INTO tickets (code, email, name, year, background, status, phone, tier, vegan) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
        .bind(ticketCode, email, name, String(body.year || "").trim().slice(0, 40), String(body.background || "").trim().slice(0, 80), phone, tier, vegan).run();
      return json({ code: ticketCode, name, status: "draft", tier, price: PRICES[tier] });
    } catch (error) {
      if (!String(error.message).includes("UNIQUE")) return json({ error: "Could not save your registration." }, 500);
    }
  }
  return json({ error: "Could not create a ticket code. Please try again." }, 500);
}
