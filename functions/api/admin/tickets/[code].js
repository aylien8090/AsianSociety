import { json, requireAdmin } from "../../_shared";

export async function onRequestPatch({ request, env, params }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const ticket = await env.TICKETS_DB.prepare("SELECT * FROM tickets WHERE code = ?").bind(params.code).first();
  if (!ticket) return json({ error: "Ticket not found" }, 404);

  if (body.action === "mark_paid") {
    await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE code = ?").bind(params.code).run();
    return json({ ok: true });
  }
  if (body.action === "mark_emailed") {
    if (ticket.status !== "paid") return json({ error: "Mark the payment as paid before emailing the ticket." }, 400);
    await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'emailed', emailed_at = CURRENT_TIMESTAMP WHERE code = ?").bind(params.code).run();
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}
