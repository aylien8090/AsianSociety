import { json, ensureSchema } from "./_shared";

// Best Dressed voting, fully anonymous:
//  - the list is everybody who has been CHECKED IN at the door
//  - nobody types or picks anything about themselves
//  - each DEVICE can vote once (a random id kept in the phone's browser)
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
    const candidate = String(body.candidate || "").trim().toUpperCase();
    const person = await db.prepare(`SELECT code, name FROM tickets WHERE code = ? AND used_at IS NOT NULL AND ${CONFIRMED}`).bind(candidate).first();
    if (!person) return json({ error: "bad_candidate" }, 400);
    try {
      // the device id is stored as the "voter", so nothing in the database says WHO voted
      await db.prepare("INSERT INTO votes (voter_code, candidate_code, device) VALUES (?, ?, ?)").bind(body.device, person.code, body.device).run();
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
