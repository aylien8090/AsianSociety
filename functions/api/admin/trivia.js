import { json, requireAdmin, ensureSchema, triviaSnapshot } from "../_shared";

// The quiz host's controls (used from the admin page). Everything returns the fresh state.
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
  return json(await triviaSnapshot(env.TICKETS_DB));
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  await ensureSchema(env);
  const db = env.TICKETS_DB;
  const st = await db.prepare("SELECT round, phase, buzzed_team, points, ready_ms FROM trivia_state WHERE id = 1").first();
  const openAt = Date.now() + st.ready_ms; // buzzers go live for everyone at this exact moment
  const teamId = Number(body.team);
  const now = "CURRENT_TIMESTAMP";

  switch (body.action) {
    case "add_team": {
      const name = String(body.name || "").trim().slice(0, 30);
      if (!name) return json({ error: "Type a team name first." }, 400);
      try { await db.prepare("INSERT INTO trivia_teams (name) VALUES (?)").bind(name).run(); }
      catch (e) { if (/UNIQUE/i.test(String(e.message))) return json({ error: "There is already a team with that name." }, 409); throw e; }
      break;
    }
    case "remove_team":
      await db.prepare("DELETE FROM trivia_teams WHERE id = ?").bind(teamId).run();
      await db.prepare("DELETE FROM trivia_attempts WHERE team_id = ?").bind(teamId).run();
      if (st.buzzed_team === teamId) await db.prepare("UPDATE trivia_state SET phase = 'open', buzzed_team = NULL WHERE id = 1").run();
      break;
    case "release_team":
      // frees the team so a different phone can take it (the old phone is sent back to the team list)
      await db.prepare("UPDATE trivia_teams SET device = NULL WHERE id = ?").bind(teamId).run();
      break;
    case "release_all":
      // kicks every phone out of every team (and turns "allow more phones" off), so everyone has to pick their team again
      await db.prepare("UPDATE trivia_teams SET device = NULL, multi = 0").run();
      break;
    case "toggle_multi":
      await db.prepare("UPDATE trivia_teams SET multi = 1 - multi WHERE id = ?").bind(teamId).run();
      break;
    case "new_question":
      await db.prepare("DELETE FROM trivia_attempts").run();
      await db.prepare(`UPDATE trivia_state SET round = round + 1, phase = 'open', open_at = ?, buzzed_team = NULL, event = NULL, event_team = NULL, event_at = ${now} WHERE id = 1`).bind(openAt).run();
      break;
    case "close":
      await db.prepare("UPDATE trivia_state SET phase = 'idle', buzzed_team = NULL, event = NULL, event_team = NULL WHERE id = 1").run();
      break;
    case "correct": {
      if (st.phase !== "answering" || !st.buzzed_team) return json({ error: "No team is answering right now." }, 400);
      await db.prepare("UPDATE trivia_teams SET score = score + ? WHERE id = ?").bind(st.points, st.buzzed_team).run();
      await db.prepare(`UPDATE trivia_state SET phase = 'idle', event = 'correct', event_team = buzzed_team, buzzed_team = NULL, event_at = ${now} WHERE id = 1`).run();
      break;
    }
    case "incorrect": {
      if (st.phase !== "answering" || !st.buzzed_team) return json({ error: "No team is answering right now." }, 400);
      await db.prepare("INSERT OR IGNORE INTO trivia_attempts (round, team_id) VALUES (?, ?)").bind(st.round, st.buzzed_team).run();
      // buzzers open again for the other teams
      await db.prepare(`UPDATE trivia_state SET phase = 'open', open_at = ?, event = 'incorrect', event_team = buzzed_team, buzzed_team = NULL, event_at = ${now} WHERE id = 1`).bind(openAt).run();
      break;
    }
    case "pass": {
      // the question goes to the team you pick; the team that had it can't buzz again this question
      const target = await db.prepare("SELECT id FROM trivia_teams WHERE id = ?").bind(teamId).first();
      if (!target) return json({ error: "Team not found." }, 404);
      if (st.buzzed_team && st.buzzed_team !== teamId) await db.prepare("INSERT OR IGNORE INTO trivia_attempts (round, team_id) VALUES (?, ?)").bind(st.round, st.buzzed_team).run();
      await db.prepare(`UPDATE trivia_state SET phase = 'answering', buzzed_team = ?, event = 'pass', event_team = ?, event_at = ${now} WHERE id = 1`).bind(teamId, teamId).run();
      break;
    }
    case "adjust": {
      const delta = Math.max(-1000, Math.min(1000, Math.trunc(Number(body.delta) || 0)));
      await db.prepare("UPDATE trivia_teams SET score = score + ? WHERE id = ?").bind(delta, teamId).run();
      break;
    }
    case "set_points": {
      const points = Math.max(1, Math.min(1000, Math.trunc(Number(body.points) || 1)));
      await db.prepare("UPDATE trivia_state SET points = ? WHERE id = 1").bind(points).run();
      break;
    }
    case "set_ready": {
      const seconds = Math.max(0, Math.min(10, Number(body.seconds) || 0));
      await db.prepare("UPDATE trivia_state SET ready_ms = ? WHERE id = 1").bind(Math.round(seconds * 1000)).run();
      break;
    }
    case "reset_scores":
      await db.prepare("UPDATE trivia_teams SET score = 0").run();
      break;
    default:
      return json({ error: "Unknown action" }, 400);
  }
  return json(await triviaSnapshot(db));
}
