import { json, ensureSchema } from "./_shared";

// Best Dressed voting, fully anonymous:
//  - the list is everybody who has been CHECKED IN at the door
//  - nobody types or picks anything about themselves
//  - each DEVICE can vote once (a random id kept in the phone's browser)
// A phone can change its vote any time while voting is open (still only one vote per phone). The dashboard only ever shows totals.
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
    const candidate = String(body.candidate || "").trim().toUpperCase();
    const person = await db.prepare(`SELECT code, name FROM tickets WHERE code = ? AND used_at IS NOT NULL AND ${CONFIRMED}`).bind(candidate).first();
    if (!person) return json({ error: "bad_candidate" }, 400);
    // the device id is stored as the "voter", so nothing in the database says WHO voted.
    // A phone has exactly one vote; voting again just replaces it (so a mistake can be fixed).
    await db.prepare(
      "INSERT INTO votes (voter_code, candidate_code, device) VALUES (?, ?, ?) " +
      "ON CONFLICT(voter_code) DO UPDATE SET candidate_code = excluded.candidate_code, created_at = CURRENT_TIMESTAMP"
    ).bind(body.device, person.code, body.device).run();
    return json({ ok: true, code: person.code, name: person.name });
  }

  // default: the list of checked-in people + this phone's current vote (if any)
  const { results } = await db.prepare(`SELECT code, name FROM tickets WHERE used_at IS NOT NULL AND ${CONFIRMED} ORDER BY lower(name)`).all();
  const mine = await db.prepare("SELECT candidate_code FROM votes WHERE device = ?").bind(body.device).first();
  return json({ open, people: results, myVote: mine ? mine.candidate_code : null });
}
