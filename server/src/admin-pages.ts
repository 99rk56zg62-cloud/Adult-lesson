import { COURSE_PACKAGE_PRICES, LESSON_DURATIONS, WEEKDAY_LABELS } from "./availability.js";
import type { CustomerPages } from "./guides.js";
import { formatGBP } from "./format.js";
import { BUSINESS_NAME, brandCss, brandFontLinks } from "./brand-style.js";
import { esc } from "./pages.js";
import type { AvailabilityRuleDto, CourseProductDto, CourseRunDto, LocationDto, SlotDto } from "./types.js";

function adminShell(title: string, body: string, notice?: string | null): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${esc(title)} · ${esc(BUSINESS_NAME)} admin</title>
  ${brandFontLinks()}
  <style>
    ${brandCss}
    :root { color-scheme: light; }
    body { margin: 0; background: var(--surround); color: var(--ink); font-family: var(--font); }
    header { background: var(--navy); color: var(--white); padding: 22px 20px 18px; }
    header .brand-row { display: flex; align-items: center; gap: 14px; }
    header img { height: 72px; width: auto; }
    header .brand { font-weight: 600; font-size: 13px; color: var(--sea-glass); }
    header h1 { font-weight: 900; font-size: 32px; margin: 4px 0; }
    header p { margin: 0; color: var(--header-muted); }
    nav { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    nav a, .linkish { color: var(--white); font-weight: 700; text-decoration: none; }
    main { max-width: 920px; margin: 0 auto; padding: 20px 16px 48px; }
    .notice { background: var(--ok-bg); color: var(--ok); border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    .warn { background: var(--warn-bg); color: var(--warn); border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; }
    .card { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 18px; margin-bottom: 16px; }
    .card h2 { font-weight: 800; font-size: 24px; margin: 0 0 12px; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 4px; }
    input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font: 16px var(--font); background: var(--white); color: var(--ink); }
    textarea { min-height: 72px; }
    button, .button { display: inline-block; border: 0; border-radius: 12px; padding: 11px 16px; background: var(--red); color: var(--white); font: 700 15px var(--font); cursor: pointer; text-decoration: none; }
    button.secondary, .button.secondary { background: var(--white); color: var(--navy); border: 1px solid var(--line); }
    button.danger { background: var(--danger); color: var(--white); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-size: 12px; letter-spacing: 0.04em; }
    .muted { color: var(--muted); }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    .on { background: var(--ok-bg); color: var(--ok); }
    .off { background: var(--danger-bg); color: var(--danger); }
    .full { background: var(--warn-bg); color: var(--warn); }
  </style>
</head>
<body>
  <header>
    <div class="brand-row">
      <img src="/brand/SSA_Logo_Primary_Stacked_Full-Colour_RGB_white.svg" alt="Swim School Academy" />
      <div>
        <div class="brand">${esc(BUSINESS_NAME)} · Back office</div>
        <h1>${esc(title)}</h1>
      </div>
    </div>
    <p>Manage locations, weekly 30/60 minute lessons, one-off slots, and crash courses. Single lessons book up to 6 weeks ahead. Crash courses book up to 6 months ahead.</p>
    <nav>
      <a href="/admin">Overview</a>
      <a href="/admin/locations">Locations</a>
      <a href="/admin/availability">Weekly availability</a>
      <a href="/admin/sessions">Upcoming sessions</a>
      <a href="/admin/courses">Crash courses</a>
      <a href="/admin/customer-pages">Info pages</a>
      <a href="/admin/course-bookings">Course bookings</a>
      <a href="/admin/customers">Customers</a>
      <a href="/admin/reminders">Reminders</a>
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
  <title>${esc(BUSINESS_NAME)} admin</title>
  ${brandFontLinks()}
  <style>
    ${brandCss}
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--navy); font-family: var(--font); }
    form { width: min(420px, 92vw); background: var(--paper); border-radius: 22px; padding: 28px 22px; }
    img { display: block; width: 160px; height: auto; margin: 0 auto 8px; }
    .brand { font-weight: 600; color: var(--atlantic); font-size: 14px; text-align: center; }
    h1 { font-weight: 900; font-size: 34px; margin: 10px 0; color: var(--navy); text-align: center; }
    p { color: var(--muted); line-height: 1.45; }
    label { display: block; font-weight: 700; margin-bottom: 6px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font: 16px var(--font); }
    button { width: 100%; margin-top: 16px; border: 0; border-radius: 14px; padding: 14px; background: var(--red); color: var(--white); font: 700 16px var(--font); }
    .err { background: var(--danger-bg); color: var(--danger); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <form method="post" action="/admin/login">
    <img src="/brand/SSA_Logo_Primary_Stacked_Full-Colour_RGB.svg" alt="Swim School Academy" />
    <div class="brand">${esc(BUSINESS_NAME)}</div>
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
  courses: CourseRunDto[];
  locations: LocationDto[];
  notice?: string | null;
}): string {
  const active = input.rules.filter((rule) => rule.enabled).length;
  const open = input.upcoming.filter((slot) => slot.bookable).length;
  const openCourses = input.courses.filter((course) => course.bookable).length;
  return adminShell(
    "Overview",
    `<div class="card">
      <h2>At a glance</h2>
      <p><strong>${input.locations.filter((l) => l.enabled).length}</strong> location${input.locations.length === 1 ? "" : "s"} · <strong>${active}</strong> weekly class${active === 1 ? "" : "es"} · <strong>${open}</strong> bookable lesson${open === 1 ? "" : "s"} · <strong>${openCourses}</strong> open crash course${openCourses === 1 ? "" : "s"}.</p>
      <div class="row">
        <a class="button" href="/admin/availability">Edit weekly availability</a>
        <a class="button secondary" href="/admin/courses">Manage crash courses</a>
      </div>
    </div>
    <div class="card">
      <h2>How customers book</h2>
      <p class="muted">They pick a location (when more than one exists), choose 30 or 60 minute single lessons on the calendar, or book a 2, 3, 4, or 5-day morning crash course. Full sessions stay greyed out. The 6-week window and 24-hour rearrange lock apply to lessons and to each day of a crash course. Arrival notes for each pool are edited under Locations. The Crash Courses and Weekly Lessons wording is edited under Info pages.</p>
    </div>`,
    input.notice,
  );
}

function locationOptions(locations: LocationDto[], selected?: string): string {
  return locations
    .filter((location) => location.enabled)
    .map((location) => {
      const sel = selected === location.id ? " selected" : "";
      return `<option value="${esc(location.id)}"${sel}>${esc(location.name)}</option>`;
    })
    .join("");
}

function durationOptions(selected?: number): string {
  return LESSON_DURATIONS.map((minutes) => {
    const sel = selected === minutes ? " selected" : "";
    return `<option value="${minutes}"${sel}>${minutes} minutes</option>`;
  }).join("");
}

function partyOptions(selected?: number): string {
  const one = selected !== 2 ? " selected" : "";
  const two = selected === 2 ? " selected" : "";
  return `<option value="1"${one}>1-to-1</option><option value="2"${two}>1-to-2</option>`;
}

function ruleForm(locations: LocationDto[], action: string, rule?: AvailabilityRuleDto, submitLabel = "Save"): string {
  const weekdayOptions = WEEKDAY_LABELS.map((label, value) => {
    if (!value) return "";
    const selected = rule?.weekday === value ? " selected" : "";
    return `<option value="${value}"${selected}>${label}</option>`;
  }).join("");
  return `<form method="post" action="${esc(action)}" class="card">
    <h2>${rule ? `Edit ${esc(rule.title)}` : "Add weekly availability"}</h2>
    <div class="grid">
      <div><label>Location</label><select name="locationId" required>${locationOptions(locations, rule?.locationId)}</select></div>
      <div><label>Lesson title</label><input name="title" required value="${esc(rule?.title ?? "")}" /></div>
      <div><label>Session</label><select name="capacity">${partyOptions(rule?.capacity)}</select></div>
      <div><label>Day of week</label><select name="weekday">${weekdayOptions}</select></div>
      <div><label>Start time</label><input name="time" type="time" required value="${esc(rule ? `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}` : "19:00")}" /></div>
      <div><label>Length</label><select name="durationMinutes">${durationOptions(rule?.durationMinutes ?? 30)}</select></div>
      <div><label>Price (£)</label><input name="pricePounds" type="number" min="0.5" step="0.01" required value="${rule ? (rule.pricePence / 100).toFixed(2) : "22.00"}" /></div>
      <div><label>Teacher</label><input name="instructor" required value="${esc(rule?.instructor ?? "")}" /></div>
    </div>
    <div style="margin-top:12px"><label>Short description</label><textarea name="blurb" required>${esc(rule?.blurb ?? "")}</textarea></div>
    <div class="row"><button type="submit">${esc(submitLabel)}</button></div>
  </form>`;
}

export function adminCustomersPage(input: {
  customers: { name: string; email: string; card: string; bookings: { reference: string; status: string; kind: string }[] }[];
}): string {
  const rows = input.customers
    .map(
      (customer) => `<tr>
        <td><strong>${esc(customer.name)}</strong><br /><span class="muted">${esc(customer.email)}</span></td>
        <td>${esc(customer.card)}</td>
        <td>${customer.bookings.map((booking) => `${esc(booking.reference)} · ${esc(booking.kind)} · ${esc(booking.status)}`).join("<br />") || `<span class="muted">No bookings</span>`}</td>
      </tr>`,
    )
    .join("");
  return adminShell(
    "Customers",
    `<div class="card">
      <h2>Saved cards and booking history</h2>
      <p class="muted">Only the card brand and last four digits are stored. The full number stays with Stripe.</p>
      <table>
        <thead><tr><th>Customer</th><th>Saved card</th><th>Bookings</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3" class="muted">No customers yet.</td></tr>`}</tbody>
      </table>
    </div>`,
  );
}

export function adminRemindersPage(input: {
  enabled: boolean;
  log: { channel: string; subject: string; body: string; sent_at: string }[];
  notice?: string | null;
}): string {
  const rows = input.log
    .map(
      (entry) => `<tr>
        <td>${esc(entry.channel)}<br /><span class="muted">${esc(entry.sent_at)}</span></td>
        <td><strong>${esc(entry.subject)}</strong><br /><span class="muted">${esc(entry.body).replaceAll("\n", "<br />")}</span></td>
      </tr>`,
    )
    .join("");
  return adminShell(
    "Reminders",
    `<form method="post" action="/admin/reminders" class="card">
      <h2>24-hour session reminders</h2>
      <p class="muted">Each session gets one email and one app notification about 24 hours before it starts. Customers can turn the app notification off. Email stays on.</p>
      <label><input type="checkbox" name="enabled" value="1"${input.enabled ? " checked" : ""} /> Send reminders</label>
      <button type="submit">Save</button>
    </form>
    <div class="card">
      <h2>Sent log</h2>
      <table>
        <thead><tr><th>When</th><th>Message</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="2" class="muted">No reminders sent yet.</td></tr>`}</tbody>
      </table>
    </div>`,
    input.notice,
  );
}

export function adminCourseBookingsPage(input: {
  bookings: {
    reference: string;
    status: string;
    priceLabel: string;
    depositLabel: string;
    balanceLabel: string;
    balanceStatus: string;
    balanceDueLabel: string | null;
    goal: string | null;
    comments: string | null;
    swimmer: {
      fullName: string;
      address: string;
      dateOfBirth: string | null;
      phone: string | null;
      emergency: string;
      swimmingLevel: string | null;
      medical: string | null;
    } | null;
  }[];
  notice?: string | null;
}): string {
  const rows = input.bookings
    .map((booking) => {
      const swimmer = booking.swimmer;
      return `<tr>
        <td><strong>${esc(booking.reference)}</strong><br /><span class="muted">${esc(booking.status)} · ${esc(booking.balanceStatus)}</span></td>
        <td>${esc(booking.depositLabel)} deposit<br />${esc(booking.balanceLabel)} balance${booking.balanceDueLabel ? `<br /><span class="muted">Due ${esc(booking.balanceDueLabel)}</span>` : ""}<br />Package ${esc(booking.priceLabel)}</td>
        <td>${swimmer ? `${esc(swimmer.fullName)}<br /><span class="muted">${esc(swimmer.address)}</span><br />${esc(swimmer.phone ?? "")}<br />DOB ${esc(swimmer.dateOfBirth ?? "")}<br />Level ${esc(swimmer.swimmingLevel ?? "")}<br />Emergency ${esc(swimmer.emergency)}` : `<span class="muted">No swimmer details</span>`}</td>
        <td><strong>Medical</strong><br />${esc(swimmer?.medical ?? "Not provided")}<br /><br /><strong>Goal</strong><br />${esc(booking.goal ?? "—")}<br /><br /><strong>Comments</strong><br />${esc(booking.comments || "—")}</td>
      </tr>`;
    })
    .join("");
  return adminShell(
    "Course bookings",
    `<div class="card">
      <h2>Crash course payments and swimmer details</h2>
      <p class="muted">Medical notes are shown here for pool staff only. They are not included on the customer's booking feed.</p>
      <table>
        <thead><tr><th>Booking</th><th>Payment</th><th>Swimmer</th><th>Safety and goals</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="muted">No crash course bookings yet.</td></tr>`}</tbody>
      </table>
    </div>`,
    input.notice,
  );
}

export function adminLocationsPage(input: {
  locations: LocationDto[];
  editId?: string | null;
  notice?: string | null;
}): string {
  const editing = input.locations.find((location) => location.id === input.editId);
  const rows = input.locations
    .map(
      (location) => `<tr>
        <td><strong>${esc(location.name)}</strong><br /><span class="muted">${esc(location.address)}</span>${location.arrivalInstructions ? `<br /><span class="muted">Arrival notes saved</span>` : ""}</td>
        <td><span class="pill ${location.enabled ? "on" : "off"}">${location.enabled ? "Open" : "Hidden"}</span></td>
        <td><a class="button secondary" href="/admin/locations?edit=${encodeURIComponent(location.id)}">Edit</a></td>
      </tr>`,
    )
    .join("");
  const form = `<form method="post" action="${editing ? `/admin/locations/${encodeURIComponent(editing.id)}` : "/admin/locations"}" class="card">
    <h2>${editing ? `Edit ${esc(editing.name)}` : "Add location"}</h2>
    <div class="grid">
      <div><label>Name</label><input name="name" required value="${esc(editing?.name ?? "")}" /></div>
      <div><label>Address</label><input name="address" required value="${esc(editing?.address ?? "")}" /></div>
      <div><label>Map latitude</label><input name="latitude" inputmode="decimal" value="${editing?.latitude ?? ""}" /></div>
      <div><label>Map longitude</label><input name="longitude" inputmode="decimal" value="${editing?.longitude ?? ""}" /></div>
      ${editing ? `<div><label>Status</label><select name="enabled"><option value="1"${editing.enabled ? " selected" : ""}>Open</option><option value="0"${!editing.enabled ? " selected" : ""}>Hidden</option></select></div>` : ""}
    </div>
    <div><label>Arrival instructions</label><textarea name="arrival" rows="8">${esc(editing?.arrivalInstructions ?? "")}</textarea></div>
    <div class="row"><button type="submit">${editing ? "Update location" : "Add location"}</button></div>
  </form>`;
  return adminShell(
    "Locations",
    `${form}
     <div class="card">
       <h2>All locations</h2>
       <table>
         <thead><tr><th>Location</th><th>Status</th><th></th></tr></thead>
         <tbody>${rows || `<tr><td colspan="3" class="muted">No locations yet.</td></tr>`}</tbody>
       </table>
     </div>`,
    input.notice,
  );
}

export function adminAvailabilityPage(input: {
  rules: AvailabilityRuleDto[];
  locations: LocationDto[];
  windows?: { id: string; location_id: string; weekday: number; start_hour: number; start_minute: number; end_hour: number; end_minute: number; enabled: number }[];
  rates?: { durationMinutes: number; pricePence: number }[];
  editId?: string | null;
  notice?: string | null;
}): string {
  const editing = input.rules.find((rule) => rule.id === input.editId);
  const rows = input.rules
    .map((rule) => {
      return `<tr>
        <td><strong>${esc(rule.title)}</strong><br /><span class="muted">${esc(rule.partyLabel)} · ${esc(rule.instructor)}</span></td>
        <td>${esc(rule.weekdayLabel)}<br />${esc(rule.timeLabel)} · ${rule.durationMinutes} min</td>
        <td>${esc(rule.locationName)}<br />${esc(rule.partyLabel)} · ${esc(rule.priceLabel)}</td>
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

  const rate30 = ((input.rates?.find((rate) => rate.durationMinutes === 30)?.pricePence ?? 3000) / 100).toFixed(2);
  const rate60 = ((input.rates?.find((rate) => rate.durationMinutes === 60)?.pricePence ?? 6000) / 100).toFixed(2);
  const windowRows = (input.windows ?? [])
    .map((window) => {
      const place = input.locations.find((location) => location.id === window.location_id);
      const day = WEEKDAY_LABELS[window.weekday] ?? "";
      return `<tr>
        <td>${esc(day)}<br />${String(window.start_hour).padStart(2, "0")}:${String(window.start_minute).padStart(2, "0")}–${String(window.end_hour).padStart(2, "0")}:${String(window.end_minute).padStart(2, "0")}</td>
        <td>${esc(place?.name ?? window.location_id)}</td>
        <td><span class="pill ${window.enabled ? "on" : "off"}">${window.enabled ? "On" : "Off"}</span></td>
        <td>
          <form method="post" action="/admin/windows/${encodeURIComponent(window.id)}/toggle">
            <input type="hidden" name="enabled" value="${window.enabled ? "0" : "1"}" />
            <button class="secondary" type="submit">${window.enabled ? "Turn off" : "Turn on"}</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");
  const weekdayOptions = WEEKDAY_LABELS.map((label, value) => (value ? `<option value="${value}">${label}</option>` : "")).join("");
  return adminShell(
    "Weekly availability",
    `<div class="card">
      <h2>Lesson prices</h2>
      <p class="muted">A 30 minute lesson and a 60 minute lesson use these prices for both 1-to-1 and 1-to-2.</p>
      <form method="post" action="/admin/lesson-prices" class="grid">
        <div><label>30 minutes (£)</label><input name="price30" type="number" min="0.5" step="0.01" required value="${rate30}" /></div>
        <div><label>60 minutes (£)</label><input name="price60" type="number" min="0.5" step="0.01" required value="${rate60}" /></div>
        <div style="align-self:end"><button type="submit">Save prices</button></div>
      </form>
    </div>
    <div class="card">
      <h2>Availability window</h2>
      <p class="muted">Set the hours a location is open. Customers choose a 30 or 60 minute start on the hour or half hour inside the window.</p>
      <form method="post" action="/admin/windows" class="grid">
        <div><label>Location</label><select name="locationId" required>${locationOptions(input.locations)}</select></div>
        <div><label>Day</label><select name="weekday">${weekdayOptions}</select></div>
        <div><label>From</label><input name="start" type="time" value="06:00" required /></div>
        <div><label>To</label><input name="end" type="time" value="09:00" required /></div>
        <div style="align-self:end"><button type="submit">Save window</button></div>
      </form>
      <table>
        <thead><tr><th>When</th><th>Where</th><th>Status</th><th></th></tr></thead>
        <tbody>${windowRows || `<tr><td colspan="4" class="muted">No windows yet.</td></tr>`}</tbody>
      </table>
    </div>
    ${editing ? ruleForm(input.locations, `/admin/rules/${encodeURIComponent(editing.id)}`, editing, "Update weekly class") : ""}
     <div class="card">
       <h2>Current weekly classes</h2>
       <p class="muted">Single lessons are 30 or 60 minutes, and private: 1-to-1 or 1-to-2. Turning a class off hides future sessions from the customer calendar.</p>
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
  locations: LocationDto[];
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
        <td><strong>${esc(slot.dayLabel)}</strong><br />${esc(slot.timeLabel)} · ${slot.durationMinutes} min</td>
        <td>${esc(slot.title)}<br /><span class="muted">${esc(slot.partyLabel)} · ${esc(slot.location)}</span></td>
        <td>${esc(slot.priceLabel)} · ${esc(slot.partyLabel)}<br />${status}</td>
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
        <div><label>Location</label><select name="locationId" required>${locationOptions(input.locations)}</select></div>
        <div><label>Start (UK local)</label><input name="startsAtLocal" type="datetime-local" required /></div>
        <div><label>Length</label><select name="durationMinutes">${durationOptions(30)}</select></div>
        <div><label>Session</label><select name="capacity">${partyOptions(1)}</select></div>
        <div><label>Price (£)</label><input name="pricePounds" type="number" min="0.5" step="0.01" value="22.00" required /></div>
        <div><label>Title</label><input name="title" value="Adult lesson" required /></div>
        <div><label>Teacher</label><input name="instructor" value="Sam Okonkwo" required /></div>
        <div style="grid-column:1/-1"><label>Description</label><textarea name="blurb" required>A one-off adult swimming lesson.</textarea></div>
        <div style="grid-column:1/-1"><button type="submit">Add session</button></div>
      </form>
    </div>
    <div class="card">
      <h2>Materialised sessions</h2>
      <p class="muted">Weekly rules create these automatically. Cancel one date without turning off the whole weekly class.</p>
      <table>
        <thead><tr><th>When</th><th>Lesson</th><th>Session</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="muted">No upcoming sessions.</td></tr>`}</tbody>
      </table>
    </div>`,
    input.notice,
  );
}

export function adminCoursesPage(input: {
  products: CourseProductDto[];
  runs: CourseRunDto[];
  locations: LocationDto[];
  notice?: string | null;
}): string {
  const productRows = input.products
    .map(
      (product) => `<tr>
        <td><strong>${esc(product.title)}</strong><br /><span class="muted">${product.days} days · ${product.dailyMinutes} min/day · ${esc(product.locationName)}</span></td>
        <td>${esc(product.partyLabel)} · ${esc(product.instructor)}<br />${esc(product.priceLabel)} for the course</td>
        <td><span class="pill ${product.enabled ? "on" : "off"}">${product.enabled ? "On" : "Off"}</span></td>
      </tr>`,
    )
    .join("");
  const runRows = input.runs
    .map((run) => {
      const status = run.cancelled
        ? `<span class="pill off">Cancelled</span>`
        : !run.enabled
          ? `<span class="pill off">Hidden</span>`
          : run.spotsLeft <= 0
            ? `<span class="pill full">Full</span>`
            : `<span class="pill on">${esc(run.spotsLabel)}</span>`;
      return `<tr>
        <td><strong>${esc(run.title)}</strong><br /><span class="muted">${esc(run.dateSummary)} · ${esc(run.dailyTimeLabel)} daily</span></td>
        <td>${esc(run.location)}<br />${esc(run.priceLabel)} · ${status}</td>
        <td>
          <form method="post" action="/admin/course-runs/${encodeURIComponent(run.id)}/cancel" class="row">
            <input type="hidden" name="cancelled" value="${run.cancelled ? "0" : "1"}" />
            <button class="${run.cancelled ? "secondary" : "danger"}" type="submit">${run.cancelled ? "Restore" : "Cancel run"}</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");
  const productOptions = input.products
    .filter((product) => product.enabled)
    .map((product) => `<option value="${esc(product.id)}">${esc(product.title)} (${product.days} days)</option>`)
    .join("");
  return adminShell(
    "Crash courses",
    `<div class="card">
      <h2>Add course product</h2>
      <p class="muted">Each day is 90 minutes. Package totals: 2 days £249, 3 days £349, 4 days £449, 5 days £549. Sessions are 1-to-1 or 1-to-2.</p>
      <form method="post" action="/admin/course-products" class="grid">
        <div><label>Location</label><select name="locationId" required>${locationOptions(input.locations)}</select></div>
        <div><label>Days</label>
          <select name="days" onchange="var prices={'2':'249.00','3':'349.00','4':'449.00','5':'549.00'}; var price=document.getElementById('coursePrice'); if(price) price.value=prices[this.value]; var title=document.getElementById('courseTitle'); if(title) title.value=this.value+'-day crash course';">
            <option value="2">2 days</option><option value="3" selected>3 days</option><option value="4">4 days</option><option value="5">5 days</option>
          </select>
        </div>
        <div><label>Title</label><input id="courseTitle" name="title" value="3-day crash course" required /></div>
        <div><label>Session</label><select name="capacity">${partyOptions(1)}</select></div>
        <div><label>Package price (£)</label><input id="coursePrice" name="pricePounds" type="number" min="1" step="0.01" value="349.00" required /></div>
        <div><label>Teacher</label><input name="instructor" value="Sam Okonkwo" required /></div>
        <div style="grid-column:1/-1"><label>Description</label><textarea name="blurb" required>Morning crash course for adults.</textarea></div>
        <div style="grid-column:1/-1"><button type="submit">Add product</button></div>
      </form>
    </div>
    <div class="card">
      <h2>Schedule a course run</h2>
      <p class="muted">Daily start must be between 06:00 and 09:00 UK time. Each day is 90 minutes.</p>
      <form method="post" action="/admin/course-runs" class="grid">
        <div><label>Product</label><select name="productId" required>${productOptions}</select></div>
        <div><label>First day</label><input name="firstDate" type="date" required /></div>
        <div><label>Daily start</label><input name="time" type="time" value="07:00" required /></div>
        <div style="grid-column:1/-1"><button type="submit">Create run</button></div>
      </form>
    </div>
    <div class="card">
      <h2>Course products</h2>
      <table>
        <thead><tr><th>Product</th><th>Details</th><th>Status</th></tr></thead>
        <tbody>${productRows || `<tr><td colspan="3" class="muted">No products yet.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Scheduled runs</h2>
      <table>
        <thead><tr><th>Run</th><th>Where</th><th></th></tr></thead>
        <tbody>${runRows || `<tr><td colspan="3" class="muted">No runs yet.</td></tr>`}</tbody>
      </table>
    </div>`,
    input.notice,
  );
}

export function adminCustomerPagesPage(input: { pages: CustomerPages; notice?: string | null }): string {
  const pages = input.pages;
  const packageFields = pages.packages
    .map((item) => {
      const deposit = Math.round(COURSE_PACKAGE_PRICES[item.days] * 0.2);
      return `<div class="card">
        <h2>${item.days}-day course</h2>
        <p class="muted">Customers are charged ${esc(formatGBP(COURSE_PACKAGE_PRICES[item.days]))}. The non-refundable deposit is ${esc(formatGBP(deposit))}.</p>
        <label>Title</label>
        <input name="packageTitle${item.days}" value="${esc(item.title)}" required />
        <label>Description</label>
        <textarea name="packageBody${item.days}" required>${esc(item.body)}</textarea>
      </div>`;
    })
    .join("");
  const levelFields = pages.levels
    .map(
      (level) => `<div class="card">
        <h2>${esc(level.title)}</h2>
        <label>Title</label>
        <input name="levelTitle_${esc(level.id)}" value="${esc(level.title)}" required />
        <label>Description</label>
        <textarea name="levelBody_${esc(level.id)}" required>${esc(level.body)}</textarea>
      </div>`,
    )
    .join("");
  return adminShell(
    "Info pages",
    `<form method="post" action="/admin/customer-pages">
      <div class="card">
        <h2>Contact details</h2>
        <p class="muted">These appear on Contact us and Call us, and in booking confirmation and reminder emails. Change them if the school address or phone number changes.</p>
        <label>Email</label>
        <input name="contactEmail" type="email" value="${esc(pages.contactEmail)}" required />
        <label>Phone</label>
        <input name="contactPhone" value="${esc(pages.contactPhone)}" required />
      </div>
      <div class="card">
        <h2>Crash Courses tab</h2>
        <label>Introduction</label>
        <textarea name="courseIntro" required>${esc(pages.courseIntro)}</textarea>
      </div>
      ${packageFields}
      <div class="card">
        <h2>Weekly lessons card</h2>
        <p class="muted">This card sits at the bottom of Crash Courses and opens the Weekly Lessons tab.</p>
        <textarea name="weeklyCard" required>${esc(pages.weeklyCard)}</textarea>
      </div>
      <div class="card">
        <h2>Weekly Lessons tab</h2>
        <label>Introduction</label>
        <textarea name="weeklyIntro" required>${esc(pages.weeklyIntro)}</textarea>
        <label>Heading</label>
        <input name="weeklyHeading" value="${esc(pages.weeklyHeading)}" required />
      </div>
      ${levelFields}
      <div class="card">
        <h2>Weekly lessons closing</h2>
        <textarea name="weeklyClosing" required>${esc(pages.weeklyClosing)}</textarea>
        <button type="submit">Save page text</button>
      </div>
    </form>`,
    input.notice,
  );
}

export function adminDisabledPage(): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8" /><title>Admin disabled</title>
  ${brandFontLinks()}
  <style>${brandCss} body { font-family: var(--font); padding: 40px; background: var(--paper); color: var(--ink); }</style>
  </head>
  <body>
  <h1>Admin is switched off</h1>
  <p>Set <code>ADMIN_TOKEN</code> on the API and restart it.</p>
  </body></html>`;
}
