const encoder = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

export function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return "CN-" + [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
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

export async function sendTicketEmail(ticket, env) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) throw new Error("Resend is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [ticket.email],
      subject: "Your Cultural Night ticket is confirmed",
      html: `<h1>You’re confirmed, ${escapeHtml(ticket.name)}!</h1><p>Your payment has been verified.</p><p>Your ticket reference is <strong>${ticket.code}</strong>.</p><p>Please keep this email for entry. We’ll send the final event details separately.</p>`
    })
  });
  if (!response.ok) throw new Error(`Resend error: ${await response.text()}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]);
}
