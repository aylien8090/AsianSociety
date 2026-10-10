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
  if (body.action === "set_pay") {
    // Switch how someone is paying. Cash stays unpaid until you press "Mark paid".
    if (body.method === "cash") {
      await env.TICKETS_DB.prepare("UPDATE tickets SET pay_method = 'cash' WHERE code = ?").bind(params.code).run();
      if (ticket.status === "draft") await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'pending' WHERE code = ?").bind(params.code).run();
    } else if (body.method === "revolut") {
      await env.TICKETS_DB.prepare("UPDATE tickets SET pay_method = '' WHERE code = ?").bind(params.code).run();
    } else return json({ error: "Invalid payment method" }, 400);
    return json({ ok: true });
  }
  if (body.action === "set_tier") {
    const tier = String(body.tier || "");
    if (!["early", "prereg", "regular", "team", "teamdisc"].includes(tier)) return json({ error: "Invalid ticket type" }, 400);
    await env.TICKETS_DB.prepare("UPDATE tickets SET tier = ? WHERE code = ?").bind(tier, params.code).run();
    // A free team ticket has nothing to pay, so it is confirmed straight away.
    if (tier === "team" && (ticket.status === "pending" || ticket.status === "draft")) {
      await env.TICKETS_DB.prepare("UPDATE tickets SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE code = ?").bind(params.code).run();
    }
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
  const ticket = await env.TICKETS_DB.prepare("SELECT email FROM tickets WHERE code = ?").bind(params.code).first();
  if (!ticket) return json({ error: "Ticket not found" }, 404);
  // Remove every record for this email, including hidden "never tapped Paid!" drafts,
  // so the email is completely free to be used again.
  const result = await env.TICKETS_DB.prepare("DELETE FROM tickets WHERE lower(email) = lower(?)").bind(ticket.email).run();
  return json({ ok: true, removed: result.meta.changes });
}
