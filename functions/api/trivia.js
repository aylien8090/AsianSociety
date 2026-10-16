import { json, ensureSchema, triviaSnapshot } from "./_shared";

const deviceOk = d => typeof d === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(d);

// Public side of the team trivia: the TV screen and the team phones read the state from here.
// If a phone passes ?device=..., the answer also says which team that phone has claimed ("mine").
export async function onRequestGet({ request, env }) {
  await ensureSchema(env);
  const snap = await triviaSnapshot(env.TICKETS_DB);
  const device = new URL(request.url).searchParams.get("device");
  if (deviceOk(device)) {
    const row = await env.TICKETS_DB.prepare("SELECT id FROM trivia_teams WHERE device = ?").bind(device).first();
    snap.mine = row ? row.id : null;
  }
  return json(snap);
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const team = Number(body.team);
  if (!Number.isInteger(team) || !deviceOk(body.device)) return json({ error: "bad_request" }, 400);
  await ensureSchema(env);
  const db = env.TICKETS_DB;
  const row = await db.prepare("SELECT id, device, multi FROM trivia_teams WHERE id = ?").bind(team).first();
  if (!row) return json({ error: "bad_team" }, 404);

  // A phone claims a team. Only ONE phone per team, unless the host allowed more or released the team.
  if (body.action === "claim") {
    // with "allow more phones" on, extra phones just join (the first phone keeps its claim)
    if (row.multi) return json({ ok: true });
    const result = await db.prepare("UPDATE trivia_teams SET device = ? WHERE id = ? AND (device IS NULL OR device = ?)").bind(body.device, team, body.device).run();
    if (result.meta.changes !== 1) return json({ ok: false, error: "taken" }, 409);
    return json({ ok: true });
  }

  // The phone gives its team back (the "change team" link), so another phone can take it.
  if (body.action === "leave") {
    await db.prepare("UPDATE trivia_teams SET device = NULL WHERE id = ? AND device = ?").bind(team, body.device).run();
    return json({ ok: true });
  }

  // A team presses its buzzer. The database decides who is first: only ONE team can ever win the update below.
  if (body.action === "buzz") {
    // only the phone that holds the team may buzz (or any phone if the host allowed more)
    if (!row.multi && row.device !== body.device) return json({ won: false, error: "not_your_team" }, 403);
    const result = await db.prepare(
      "UPDATE trivia_state SET phase = 'answering', buzzed_team = ?, event = NULL, event_team = NULL " +
      "WHERE id = 1 AND phase = 'open' AND buzzed_team IS NULL AND open_at <= ? " +
      "AND NOT EXISTS (SELECT 1 FROM trivia_attempts a WHERE a.round = trivia_state.round AND a.team_id = ?)"
    ).bind(team, Date.now(), team).run();
    return json({ won: result.meta.changes === 1 });
  }
  return json({ error: "bad_request" }, 400);
}
