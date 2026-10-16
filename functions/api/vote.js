import { json, ensureSchema } from "./_shared";

// Best Dressed voting, anonymous. Nobody types an email:
//  - the list is everybody who has been CHECKED IN at the door
//  - you tap your own name once ("who are you?") so you can't vote for yourself
//  - each DEVICE can vote once (a random id kept in the phone's browser), and each person can only be the voter once
// Votes are final once cast. The dashboard only ever shows totals.
const CONFIRMED = "status IN ('paid','emailed')";
const deviceOk = d => typeof d === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(d);

async function votingOpen(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'voting_open'").first();
  return !row || row.value !== "0";
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!deviceOk(body.device)) return json({ error: "bad_device" }, 400);
  await ensureSchema(env);
  const db = env.TICKETS_DB;
  const open = await votingOpen(db);

  if (body.action === "vote") {
    if (!open) return json({ error: "closed" }, 403);
    const me = String(body.me || "").trim().toUpperCase();
    const candidate = String(body.candidate || "").trim().toUpperCase();
    if (me === candidate) return json({ error: "self" }, 400);
    const voter = await db.prepare(`SELECT code, name FROM tickets WHERE code = ? AND used_at IS NOT NULL AND ${CONFIRMED}`).bind(me).first();
    const person = await db.prepare(`SELECT code, name FROM tickets WHERE code = ? AND used_at IS NOT NULL AND ${CONFIRMED}`).bind(candidate).first();
    if (!voter || !person) return json({ error: "bad_candidate" }, 400);
    try {
      await db.prepare("INSERT INTO votes (voter_code, candidate_code, device) VALUES (?, ?, ?)").bind(voter.code, person.code, body.device).run();
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) return json({ error: "already_voted" }, 409);
      throw e;
    }
    return json({ ok: true, name: person.name });
  }

  // default: the list of checked-in people + whether this device has already voted
  const { results } = await db.prepare(`SELECT code, name FROM tickets WHERE used_at IS NOT NULL AND ${CONFIRMED} ORDER BY lower(name)`).all();
  const voted = await db.prepare("SELECT 1 AS ok FROM votes WHERE device = ?").bind(body.device).first();
  return json({ open, people: results, voted: !!voted });
}
