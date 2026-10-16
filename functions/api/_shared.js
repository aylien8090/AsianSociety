const encoder = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

// Ticket prices in euros per release. "prereg" = first release (people who pre-registered), "early" = early bird.
// team = free team member ticket, teamdisc = team member price (€6, still has to be paid).
// regular = €10 (until Thursday 15 Oct 2PM), late = €15 (after that).
// referral = €3 ticket you can set by hand for people who were referred.
export const PRICES = { prereg: 7, early: 8, regular: 10, late: 15, team: 0, teamdisc: 6, referral: 3 };
// Tickets with no tier (older registrations) count as early bird.
export const tierOf = tier => ["prereg", "team", "teamdisc", "regular", "late", "referral"].includes(tier) ? tier : "early";

// The pre-registered (€7) and early bird (€8) prices end at the end of Sunday 11 Oct, Bulgarian time.
// After that every new ticket is the regular €10 one. (index.html uses the same moment to hide the old prices.)
export const EARLY_BIRD_ENDS = Date.parse("2026-10-11T23:59:59+03:00");
export const earlyBirdOn = () => Date.now() <= EARLY_BIRD_ENDS;

// The €10 ticket ends at 2PM (Bulgarian time) on Thursday 15 Oct. After that every new ticket is €15.
export const TEN_EURO_ENDS = Date.parse("2026-10-15T14:00:00+03:00");
export const tenEuroOn = () => Date.now() <= TEN_EURO_ENDS;

// Adds the newer columns/tables on first use so no manual database step is needed.
let schemaReady;
export function ensureSchema(env) {
  schemaReady ||= (async () => {
    const db = env.TICKETS_DB;
    for (const column of ["phone TEXT", "tier TEXT", "used_at TEXT", "note TEXT", "vegan TEXT", "pay_method TEXT"]) {
      try { await db.prepare("ALTER TABLE tickets ADD COLUMN " + column).run(); }
      catch (error) { if (!/duplicate column/i.test(String(error.message))) throw error; /* already added */ }
    }
    await db.prepare("CREATE TABLE IF NOT EXISTS prereg (email TEXT PRIMARY KEY, name TEXT)").run();
    // best dressed voting
    await db.prepare("CREATE TABLE IF NOT EXISTS votes (voter_code TEXT PRIMARY KEY, candidate_code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
    try { await db.prepare("ALTER TABLE votes ADD COLUMN device TEXT").run(); }
    catch (error) { if (!/duplicate column/i.test(String(error.message))) throw error; }
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS votes_device ON votes(device)").run(); // one vote per device
    await db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)").run();
    // team trivia buzzer
    await db.prepare("CREATE TABLE IF NOT EXISTS trivia_teams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, score INTEGER NOT NULL DEFAULT 0)").run();
    // one phone per team: "device" is the phone that claimed the team, "multi" lets the host allow extra phones
    for (const column of ["device TEXT", "multi INTEGER NOT NULL DEFAULT 0"]) {
      try { await db.prepare("ALTER TABLE trivia_teams ADD COLUMN " + column).run(); }
      catch (error) { if (!/duplicate column/i.test(String(error.message))) throw error; }
    }
    await db.prepare("CREATE TABLE IF NOT EXISTS trivia_attempts (round INTEGER NOT NULL, team_id INTEGER NOT NULL, PRIMARY KEY (round, team_id))").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS trivia_state (id INTEGER PRIMARY KEY CHECK (id = 1), round INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'idle', buzzed_team INTEGER, points INTEGER NOT NULL DEFAULT 1, event TEXT, event_team INTEGER, event_at TEXT)").run();
    // open_at = the moment (server clock, ms) the buzzers really go live; ready_ms = the "get ready" countdown length
    for (const column of ["open_at INTEGER NOT NULL DEFAULT 0", "ready_ms INTEGER NOT NULL DEFAULT 3000"]) {
      try { await db.prepare("ALTER TABLE trivia_state ADD COLUMN " + column).run(); }
      catch (error) { if (!/duplicate column/i.test(String(error.message))) throw error; }
    }
    await db.prepare("INSERT OR IGNORE INTO trivia_state (id) VALUES (1)").run();
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

// Ticket sales are CLOSED. To reopen them, set this to true (and in index.html set TICKETS_CLOSED to false).
export const SALES_OPEN = false;

// Everything the trivia screens need in one go.
export async function triviaSnapshot(db) {
  const st = await db.prepare("SELECT round, phase, buzzed_team, points, event, event_team, event_at, open_at, ready_ms FROM trivia_state WHERE id = 1").first();
  const nowMs = Date.now();
  const { results } = await db.prepare("SELECT t.id, t.name, t.score, t.device, t.multi, EXISTS(SELECT 1 FROM trivia_attempts a WHERE a.round = ? AND a.team_id = t.id) AS tried FROM trivia_teams t ORDER BY t.score DESC, lower(t.name)").bind(st.round).all();
  // the phone id itself is never sent out, only whether a phone has the team
  const teams = results.map(t => ({ id: t.id, name: t.name, score: t.score, tried: !!t.tried, taken: !!t.device, multi: !!t.multi }));
  const byId = id => teams.find(t => t.id === id) || null;
  // opensInMs: how long until the buzzers go live, so every phone can count down to the SAME moment
  return { round: st.round, phase: st.phase, points: st.points, opensInMs: Math.max(0, st.open_at - nowMs), readyMs: st.ready_ms, buzzed: st.buzzed_team ? byId(st.buzzed_team) : null, event: st.event || null, eventTeam: st.event_team ? byId(st.event_team) : null, eventAt: st.event_at || null, teams };
}

export function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return "ASOC-" + [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
}

export async function isAdmin(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ") || !env.ADMIN_PASSWORD) return false;
  const [given, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(auth.slice(7))),
    crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_PASSWORD))
  ]);
  const a = new Uint8Array(given), b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function requireAdmin(request, env) {
  return isAdmin(request, env).then(ok => ok ? null : json({ error: "Unauthorised" }, 401));
}

