import { code, json } from "./_shared";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2) return json({ error: "Enter a valid name and email." }, 400);

  for (let attempt = 0; attempt < 5; attempt++) {
    const ticketCode = code();
    try {
      await env.TICKETS_DB.prepare("INSERT INTO tickets (code, email, name, year, background) VALUES (?, ?, ?, ?, ?)")
        .bind(ticketCode, email, name, String(body.year || "").trim(), String(body.background || "").trim()).run();
      return json({ code: ticketCode });
    } catch (error) {
      if (!String(error.message).includes("UNIQUE")) return json({ error: "Could not save your registration." }, 500);
    }
  }
  return json({ error: "Could not create a ticket code. Please try again." }, 500);
}
