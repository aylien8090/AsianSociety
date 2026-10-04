import { json, requireAdmin, ensureSchema } from "../../_shared";

export async function onRequestPatch({ request, env, params }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  await ensureSchema(env);
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
  if (body.action === "set_note") {
    await env.TICKETS_DB.prepare("UPDATE tickets SET note = ? WHERE code = ?").bind(String(body.note || "").trim().slice(0, 1000), params.code).run();
    return json({ ok: true });
  }
  if (body.action === "mark_used") {
    if (ticket.status !== "paid" && ticket.status !== "emailed") return json({ error: "Only paid tickets can be checked in." }, 400);
    await env.TICKETS_DB.prepare("UPDATE tickets SET used_at = CURRENT_TIMESTAMP WHERE code = ?").bind(params.code).run();
    return json({ ok: true });
  }
  if (body.action === "unmark_used") {
    await env.TICKETS_DB.prepare("UPDATE tickets SET used_at = NULL WHERE code = ?").bind(params.code).run();
    return json({ ok: true });
  }
  if (body.action === "set_status") {
    const status = String(body.status || "");
    if (!['pending', 'paid', 'emailed'].includes(status)) return json({ error: "Invalid status" }, 400);
    if (status === 'pending') {
      await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'pending', paid_at = NULL, emailed_at = NULL, used_at = NULL WHERE code = ?").bind(params.code).run();
    } else if (status === 'paid') {
      await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'paid', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), emailed_at = NULL WHERE code = ?").bind(params.code).run();
    } else {
      await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'emailed', paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), emailed_at = CURRENT_TIMESTAMP WHERE code = ?").bind(params.code).run();
    }
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}

export async function onRequestDelete({ request, env, params }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  const result = await env.TICKETS_DB.prepare("DELETE FROM tickets WHERE code = ?").bind(params.code).run();
  if (!result.meta.changes) return json({ error: "Ticket not found" }, 404);
  return json({ ok: true });
}
