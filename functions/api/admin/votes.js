import { json, requireAdmin, ensureSchema } from "../_shared";

// Results = votes from phones + votes the organiser added by hand. Guests never see any of this.
async function snapshot(db) {
  const open = await db.prepare("SELECT value FROM settings WHERE key = 'voting_open'").first();
  const { results } = await db.prepare(
    "SELECT t.code, t.name, COUNT(v.voter_code) AS phone_votes, COALESCE(m.votes, 0) AS manual " +
    "FROM tickets t LEFT JOIN votes v ON v.candidate_code = t.code LEFT JOIN manual_votes m ON m.candidate_code = t.code " +
    "WHERE t.used_at IS NOT NULL AND t.status IN ('paid','emailed') GROUP BY t.code " +
    "ORDER BY (COUNT(v.voter_code) + COALESCE(m.votes, 0)) DESC, lower(t.name)"
  ).all();
  const voters = await db.prepare("SELECT COUNT(*) AS n FROM votes").first();
  const rows = results.map(r => ({ code: r.code, name: r.name, phoneVotes: r.phone_votes, manual: r.manual, votes: r.phone_votes + r.manual }));
  return { open: !open || open.value !== "0", checkedIn: rows.length, voters: voters ? voters.n : 0, manualTotal: rows.reduce((n, r) => n + r.manual, 0), results: rows };
}

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
  return json(await snapshot(env.TICKETS_DB));
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  await ensureSchema(env);
  const db = env.TICKETS_DB;
  if (body.action === "open" || body.action === "close") {
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('voting_open', ?)").bind(body.action === "open" ? "1" : "0").run();
  } else if (body.action === "manual") {
    // add or take away votes by hand for one person (never goes below 0)
    const code = String(body.code || "").trim().toUpperCase();
    const delta = Math.max(-100, Math.min(100, Math.trunc(Number(body.delta) || 0)));
    const person = await db.prepare("SELECT code FROM tickets WHERE code = ? AND used_at IS NOT NULL AND status IN ('paid','emailed')").bind(code).first();
    if (!person) return json({ error: "That person is not checked in." }, 404);
    const current = await db.prepare("SELECT votes FROM manual_votes WHERE candidate_code = ?").bind(code).first();
    const next = Math.max(0, (current ? current.votes : 0) + delta);
    await db.prepare("INSERT OR REPLACE INTO manual_votes (candidate_code, votes) VALUES (?, ?)").bind(code, next).run();
  } else if (body.action === "reset") {
    await db.prepare("DELETE FROM votes").run();
    await db.prepare("DELETE FROM manual_votes").run();
  } else return json({ error: "Unknown action" }, 400);
  return json(await snapshot(db));
}
