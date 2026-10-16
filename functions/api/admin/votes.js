import { json, requireAdmin, ensureSchema } from "../_shared";

async function snapshot(db) {
  const open = await db.prepare("SELECT value FROM settings WHERE key = 'voting_open'").first();
  const { results } = await db.prepare("SELECT t.code, t.name, COUNT(v.voter_code) AS votes FROM tickets t LEFT JOIN votes v ON v.candidate_code = t.code WHERE t.used_at IS NOT NULL AND t.status IN ('paid','emailed') GROUP BY t.code ORDER BY votes DESC, lower(t.name)").all();
  const voters = await db.prepare("SELECT COUNT(*) AS n FROM votes").first();
  return { open: !open || open.value !== "0", checkedIn: results.length, voters: voters ? voters.n : 0, results };
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
  } else if (body.action === "reset") {
    await db.prepare("DELETE FROM votes").run();
  } else return json({ error: "Unknown action" }, 400);
  return json(await snapshot(db));
}
