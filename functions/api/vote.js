import { json, ensureSchema } from "./_shared";

// Best Dressed voting. A voter proves who they are with the email on their ticket.
// Only people who have been CHECKED IN at the door can vote, and they can vote for any other
// checked-in person (team or not), but never for themselves. One vote each, changeable while voting is open.
const CONFIRMED = "status IN ('paid','emailed')";

async function votingOpen(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'voting_open'").first();
  return !row || row.value !== "0";
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "bad_email" }, 400);
  await ensureSchema(env);
  const db = env.TICKETS_DB;

  const me = await db.prepare("SELECT code, name, status, used_at FROM tickets WHERE lower(email) = ? ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if (!me) return json({ error: "no_ticket" }, 404);
  if (me.status !== "paid" && me.status !== "emailed") return json({ error: "not_confirmed", name: me.name }, 403);
  if (!me.used_at) return json({ error: "not_checked_in", name: me.name }, 403);
  const open = await votingOpen(db);

  if (body.action === "vote") {
    if (!open) return json({ error: "closed" }, 403);
    const candidate = String(body.candidate || "").trim().toUpperCase();
    if (candidate === me.code) return json({ error: "self" }, 400);
    const person = await db.prepare(`SELECT code, name FROM tickets WHERE code = ? AND used_at IS NOT NULL AND ${CONFIRMED}`).bind(candidate).first();
    if (!person) return json({ error: "bad_candidate" }, 400);
    await db.prepare("INSERT OR REPLACE INTO votes (voter_code, candidate_code) VALUES (?, ?)").bind(me.code, person.code).run();
    return json({ ok: true, code: person.code, name: person.name });
  }

  const { results } = await db.prepare(`SELECT code, name FROM tickets WHERE used_at IS NOT NULL AND ${CONFIRMED} AND code != ? ORDER BY lower(name)`).bind(me.code).all();
  const mine = await db.prepare("SELECT candidate_code FROM votes WHERE voter_code = ?").bind(me.code).first();
  return json({ name: me.name, open, candidates: results, myVote: mine ? mine.candidate_code : null });
}
