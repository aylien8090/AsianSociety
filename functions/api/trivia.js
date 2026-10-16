import { json, ensureSchema, triviaSnapshot } from "./_shared";

// Public side of the team trivia: the TV screen and the team phones read the state from here.
export async function onRequestGet({ env }) {
  await ensureSchema(env);
  return json(await triviaSnapshot(env.TICKETS_DB));
}

// A team presses its buzzer. The database decides who is first: only ONE team can ever win the update below.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (body.action !== "buzz") return json({ error: "bad_request" }, 400);
  const team = Number(body.team);
  if (!Number.isInteger(team)) return json({ error: "bad_team" }, 400);
  await ensureSchema(env);
  const db = env.TICKETS_DB;
  const exists = await db.prepare("SELECT 1 AS ok FROM trivia_teams WHERE id = ?").bind(team).first();
  if (!exists) return json({ error: "bad_team" }, 404);
  // buzzing before the get-ready countdown ends does not count
  const result = await db.prepare(
    "UPDATE trivia_state SET phase = 'answering', buzzed_team = ?, event = NULL, event_team = NULL " +
    "WHERE id = 1 AND phase = 'open' AND buzzed_team IS NULL AND open_at <= ? " +
    "AND NOT EXISTS (SELECT 1 FROM trivia_attempts a WHERE a.round = trivia_state.round AND a.team_id = ?)"
  ).bind(team, Date.now(), team).run();
  return json({ won: result.meta.changes === 1 });
}
