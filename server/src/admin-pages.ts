import { WEEKDAY_LABELS } from "./availability.js";
import { esc } from "./pages.js";
import type { AvailabilityRuleDto, SlotDto } from "./types.js";

function adminShell(title: string, body: string, notice?: string | null): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${esc(title)} · Lido admin</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #d9d0c3; color: #14262b; font-family: "Segoe UI", sans-serif; }
    header { background: #0c2e33; color: #fff; padding: 22px 20px 18px; }
    header .brand { font: 700 12px Georgia, serif; letter-spacing: 0.16em; color: #e7d3b0; }
    header h1 { font: 700 32px Georgia, "Iowan Old Style", Palatino, serif; margin: 8px 0 4px; }
    header p { margin: 0; color: #d7e6e4; }
    nav { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    nav a, .linkish { color: #e7d3b0; font-weight: 600; text-decoration: none; }
    main { max-width: 920px; margin: 0 auto; padding: 20px 16px 48px; }
    .notice { background: #e5f2ea; color: #1f6b45; border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    .warn { background: #f8efd9; color: #8a5a00; border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    .card { background: #f6f1e8; border: 1px solid #e4d8c8; border-radius: 18px; padding: 18px; margin-bottom: 16px; }
    .card h2 { font: 700 24px Georgia, serif; margin: 0 0 12px; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 4px; }
    input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #e4d8c8; border-radius: 10px; padding: 10px 12px; font: 16px "Segoe UI", sans-serif; background: #fff; }
    textarea { min-height: 72px; }
    button, .button { display: inline-block; border: 0; border-radius: 12px; padding: 11px 16px; background: #0c2e33; color: #fff; font: 600 15px "Segoe UI", sans-serif; cursor: pointer; text-decoration: none; }
    button.secondary, .button.secondary { background: #fff; color: #14262b; border: 1px solid #e4d8c8; }
    button.danger { background: #8e2f2f; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e4d8c8; vertical-align: top; }
    th { color: #5c6b70; font-size: 12px; letter-spacing: 0.04em; }
    .muted { color: #5c6b70; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    .on { background: #e5f2ea; color: #1f6b45; }
    .off { background: #f8e8e4; color: #8e2f2f; }
    .full { background: #f8efd9; color: #8a5a00; }
  </style>
</head>
<body>
  <header>
    <div class="brand">LIDO · BACK OFFICE</div>
    <h1>${esc(title)}</h1>
    <p>Manage weekly availability and one-off sessions. Customers only see open places in the next 6 weeks.</p>
    <nav>
      <a href="/admin">Overview</a>
      <a href="/admin/availability">Weekly availability</a>
      <a href="/admin/sessions">Upcoming sessions</a>
      <a href="/admin/logout">Sign out</a>
    </nav>
  </header>
  <main>
    ${notice ? `<div class="notice">${esc(notice)}</div>` : ""}
    ${body}
  </main>
</body>
</html>`;
}

export function adminLoginPage(error?: string | null): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lido admin</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c2e33; font-family: "Segoe UI", sans-serif; }
    form { width: min(420px, 92vw); background: #f6f1e8; border-radius: 22px; padding: 28px 22px; }
    .brand { letter-spacing: 0.16em; font-weight: 700; color: #0f6e6a; font-size: 12px; }
    h1 { font: 700 34px Georgia, serif; margin: 10px 0; color: #14262b; }
    p { color: #5c6b70; line-height: 1.45; }
    label { display: block; font-weight: 700; margin-bottom: 6px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #e4d8c8; border-radius: 12px; padding: 12px 14px; font-size: 16px; }
    button { width: 100%; margin-top: 16px; border: 0; border-radius: 14px; padding: 14px; background: #0c2e33; color: #fff; font: 600 16px "Segoe UI", sans-serif; }
    .err { background: #f8e8e4; color: #8e2f2f; border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <form method="post" action="/admin/login">
    <div class="brand">LIDO ADMIN</div>
    <h1>Staff sign-in</h1>
    <p>Enter the <strong>ADMIN_TOKEN</strong> from the API environment. Outside production the default is <code>lido-dev-admin</code>.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <label for="token">Admin token</label>
    <input id="token" name="token" type="password" autocomplete="current-password" required />
    <button type="submit">Open admin</button>
  </form>
</body>
</html>`;
}

export function adminOverviewPage(input: {
  rules: AvailabilityRuleDto[];
  upcoming: SlotDto[];
  notice?: string | null;
}): string {
  const active = input.rules.filter((rule) => rule.enabled).length;
  const open = input.upcoming.filter((slot) => slot.bookable).length;
  return adminShell(
    "Overview",
    `<div class="card">
      <h2>At a glance</h2>
      <p><strong>${active}</strong> weekly class${active === 1 ? "" : "es"} on · <strong>${open}</strong> bookable session${open === 1 ? "" : "s"} in the next 6 weeks.</p>
      <div class="row">
        <a class="button" href="/admin/availability">Edit weekly availability</a>
        <a class="button secondary" href="/admin/sessions">Review upcoming sessions</a>
      </div>
    </div>
    <div class="card">
      <h2>How customers book</h2>
      <p class="muted">They open a calendar, pick a date that has open places, choose a time, and pay. Full or cancelled sessions stay greyed out. The 6-week window and 24-hour rearrange lock are enforced by the API.</p>
    </div>`,
    input.notice,
  );
}

function ruleForm(action: string, rule?: AvailabilityRuleDto, submitLabel = "Save"): string {
  const weekdayOptions = WEEKDAY_LABELS.map((label, value) => {
    if (!value) return "";
    const selected = rule?.weekday === value ? " selected" : "";
    return `<option value="${value}"${selected}>${label}</option>`;
  }).join("");
  const levels = ["Beginners", "Improvers", "Confidence", "Technique"]
    .map((level) => `<option value="${level}"${rule?.level === level ? " selected" : ""}>${level}</option>`)
    .join("");
  return `<form method="post" action="${esc(action)}" class="card">
    <h2>${rule ? `Edit ${esc(rule.title)}` : "Add weekly availability"}</h2>
    <div class="grid">
      <div><label>Lesson title</label><input name="title" required value="${esc(rule?.title ?? "")}" /></div>
      <div><label>Level</label><select name="level">${levels}</select></div>
      <div><label>Day of week</label><select name="weekday">${weekdayOptions}</select></div>
      <div><label>Start time</label><input name="time" type="time" required value="${esc(rule ? `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}` : "19:00")}" /></div>
      <div><label>Length (minutes)</label><input name="durationMinutes" type="number" min="15" max="180" required value="${rule?.durationMinutes ?? 45}" /></div>
      <div><label>Places</label><input name="capacity" type="number" min="1" max="50" required value="${rule?.capacity ?? 8}" /></div>
      <div><label>Price (£)</label><input name="pricePounds" type="number" min="0.5" step="0.01" required value="${rule ? (rule.pricePence / 100).toFixed(2) : "28.00"}" /></div>
      <div><label>Teacher</label><input name="instructor" required value="${esc(rule?.instructor ?? "")}" /></div>
      <div><label>Pool / location</label><input name="location" required value="${esc(rule?.location ?? "")}" /></div>
      <div><label>Address</label><input name="address" required value="${esc(rule?.address ?? "")}" /></div>
    </div>
    <div style="margin-top:12px"><label>Short description</label><textarea name="blurb" required>${esc(rule?.blurb ?? "")}</textarea></div>
    <div class="row"><button type="submit">${esc(submitLabel)}</button></div>
  </form>`;
}

export function adminAvailabilityPage(input: {
  rules: AvailabilityRuleDto[];
  editId?: string | null;
  notice?: string | null;
}): string {
  const editing = input.rules.find((rule) => rule.id === input.editId);
  const rows = input.rules
    .map((rule) => {
      return `<tr>
        <td><strong>${esc(rule.title)}</strong><br /><span class="muted">${esc(rule.level)} · ${esc(rule.instructor)}</span></td>
        <td>${esc(rule.weekdayLabel)}<br />${esc(rule.timeLabel)} · ${rule.durationMinutes} min</td>
        <td>${esc(rule.location)}<br />${rule.capacity} places · ${esc(rule.priceLabel)}</td>
        <td><span class="pill ${rule.enabled ? "on" : "off"}">${rule.enabled ? "On" : "Off"}</span></td>
        <td>
          <div class="row">
            <a class="button secondary" href="/admin/availability?edit=${encodeURIComponent(rule.id)}">Edit</a>
            <form method="post" action="/admin/rules/${encodeURIComponent(rule.id)}/toggle">
              <input type="hidden" name="enabled" value="${rule.enabled ? "0" : "1"}" />
              <button class="secondary" type="submit">${rule.enabled ? "Turn off" : "Turn on"}</button>
            </form>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  return adminShell(
    "Weekly availability",
    `${editing ? ruleForm(`/admin/rules/${encodeURIComponent(editing.id)}`, editing, "Update weekly class") : ruleForm("/admin/rules", undefined, "Add weekly class")}
     <div class="card">
       <h2>Current weekly classes</h2>
       <p class="muted">Turning a class off hides future sessions from the customer calendar. Existing paid bookings stay put.</p>
       <table>
         <thead><tr><th>Lesson</th><th>When</th><th>Where</th><th>Status</th><th></th></tr></thead>
         <tbody>${rows || `<tr><td colspan="5" class="muted">No weekly availability yet.</td></tr>`}</tbody>
       </table>
     </div>`,
    input.notice,
  );
}

export function adminSessionsPage(input: {
  slots: SlotDto[];
  notice?: string | null;
}): string {
  const upcoming = input.slots.filter((slot) => new Date(slot.startsAt).getTime() > Date.now()).slice(0, 80);
  const rows = upcoming
    .map((slot) => {
      const status = slot.cancelled
        ? `<span class="pill off">Cancelled</span>`
        : !slot.enabled
          ? `<span class="pill off">Hidden</span>`
          : slot.spotsLeft <= 0
            ? `<span class="pill full">Full</span>`
            : `<span class="pill on">${esc(slot.spotsLabel)}</span>`;
      return `<tr>
        <td><strong>${esc(slot.dayLabel)}</strong><br />${esc(slot.timeLabel)}</td>
        <td>${esc(slot.title)}<br /><span class="muted">${esc(slot.level)} · ${esc(slot.location)}</span></td>
        <td>${esc(slot.priceLabel)} · ${slot.capacity} places<br />${status}</td>
        <td>
          <form method="post" action="/admin/slots/${encodeURIComponent(slot.id)}/cancel" class="row">
            <input type="hidden" name="cancelled" value="${slot.cancelled ? "0" : "1"}" />
            <button class="${slot.cancelled ? "secondary" : "danger"}" type="submit">${slot.cancelled ? "Restore" : "Cancel session"}</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");

  return adminShell(
    "Upcoming sessions",
    `<div class="card">
      <h2>Add a one-off session</h2>
      <form method="post" action="/admin/slots" class="grid">
        <div><label>Start (UK local)</label><input name="startsAtLocal" type="datetime-local" required /></div>
        <div><label>Length (minutes)</label><input name="durationMinutes" type="number" min="15" max="180" value="45" required /></div>
        <div><label>Places</label><input name="capacity" type="number" min="1" max="50" value="8" required /></div>
        <div><label>Price (£)</label><input name="pricePounds" type="number" min="0.5" step="0.01" value="28.00" required /></div>
        <div><label>Title</label><input name="title" value="Adult beginners" required /></div>
        <div><label>Level</label>
          <select name="level">
            <option>Beginners</option><option>Improvers</option><option>Confidence</option><option>Technique</option>
          </select>
        </div>
        <div><label>Teacher</label><input name="instructor" value="Sam Okonkwo" required /></div>
        <div><label>Pool</label><input name="location" value="Riverside Lido" required /></div>
        <div><label>Address</label><input name="address" value="Pool Lane, Bristol" required /></div>
        <div style="grid-column:1/-1"><label>Description</label><textarea name="blurb" required>A one-off adult swimming lesson.</textarea></div>
        <div style="grid-column:1/-1"><button type="submit">Add session</button></div>
      </form>
    </div>
    <div class="card">
      <h2>Materialised sessions</h2>
      <p class="muted">Weekly rules create these automatically. Cancel one date without turning off the whole weekly class.</p>
      <table>
        <thead><tr><th>When</th><th>Lesson</th><th>Places</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="muted">No upcoming sessions.</td></tr>`}</tbody>
      </table>
    </div>`,
    input.notice,
  );
}

export function adminDisabledPage(): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8" /><title>Admin disabled</title></head>
  <body style="font-family:Segoe UI,sans-serif;padding:40px;background:#f6f1e8">
  <h1>Admin is switched off</h1>
  <p>Set <code>ADMIN_TOKEN</code> on the API and restart it.</p>
  </body></html>`;
}
