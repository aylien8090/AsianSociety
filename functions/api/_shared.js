const encoder = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

// Ticket prices in euros per release. "prereg" = first release (people who pre-registered), "early" = early bird.
// team = free team member ticket, teamdisc = team member price (€6, still has to be paid).
export const PRICES = { prereg: 7, early: 8, regular: 10, team: 0, teamdisc: 6 };
// Tickets with no tier (older registrations) count as early bird.
export const tierOf = tier => (tier === "prereg" || tier === "team" || tier === "teamdisc" || tier === "regular") ? tier : "early";

// The pre-registered (€7) and early bird (€8) prices end at the end of Sunday 11 Oct, Bulgarian time.
// After that every new ticket is the regular €10 one. (index.html uses the same moment to hide the old prices.)
export const EARLY_BIRD_ENDS = Date.parse("2026-10-11T23:59:59+03:00");
export const earlyBirdOn = () => Date.now() <= EARLY_BIRD_ENDS;

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
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
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

