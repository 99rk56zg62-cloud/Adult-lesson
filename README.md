# Lido

Adult swimming lesson bookings for iOS, Android, and web. Customers pick a location (when more than one exists), choose 30 or 60 minute single lessons on a calendar, or book a 3/4/5-day morning crash course. Pay when they book, rearrange until 24 hours before the start (or before day one of a course), and add bookings to Google Calendar.

The mobile client is Expo (React Native). The API is a small Node server with SQLite. Business rules are enforced on the server. Pool staff manage locations, weekly availability, one-off sessions, and crash courses in a simple admin web page.

## How booking works now

1. Open **Schedule**. If several pools are open, pick a **location**. Choose **30 min** or **60 min** for single lessons.
2. Tap a highlighted date in the next **6 weeks** (UK / Europe/London) to see open times for that length.
3. Tap a time, confirm, and pay (Stripe Checkout, or the local test-payment page when no Stripe key is set).
4. Scroll to **Crash courses** to book a whole 3-, 4-, or 5-day run. Each day is **90 minutes**, with daily starts between **06:00 and 09:00** UK time. The app shows every day and time in the package.
5. Bookings appear under **Lessons**. Single lessons can be rearranged until **24 hours** before they start. Crash courses can be moved to another open run of the **same length** until **24 hours before day one**; after that the package is locked.
6. Use **Add to Google Calendar** on a booking, or connect Google on Account so paid and rearranged bookings sync automatically.

Staff set locations, weekly 30/60 minute templates, one-off sessions, and crash course products/runs in the **admin area**.

## Rules

- A session or course can be booked only if its first day starts in the future and falls within **6 weeks of today** in `Europe/London`.
- A confirmed **single lesson** can be rearranged until **24 hours before it starts**. At that instant it is still allowed; one millisecond later it is not.
- A confirmed **crash course** can be moved to another open run with the **same day count** until **24 hours before the first day's start**. After that the whole package is locked (same spirit as single lessons). Rearranging never charges the card again.
- A pending checkout **holds a place for 45 minutes**. Confirmed bookings and live holds count towards capacity. A payment that lands after the hold expired is confirmed only if a place is still free.
- A booking becomes confirmed only after Stripe reports the Checkout session as paid (or after the local test-payment stand-in, when Stripe is not configured).

## Project layout

```
server/     Express API — locations, availability, slots, courses, bookings, Stripe, Google Calendar, /admin
mobile/     Expo app — calendar schedule, crash courses, payment, lessons, account
```

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install --prefix server
npm install --prefix mobile

cp server/.env.example server/.env
cp mobile/.env.example mobile/.env   # optional; defaults to http://localhost:4000
```

Start the API and the app in two terminals:

```bash
npm run dev:api
npm run dev:app
```

Then press `w` in the Expo terminal for web, or scan the QR code with Expo Go. Web is the fastest way to click through the flows.

With no Stripe key, the API starts in **mock payment** mode and seeds a demo swimmer:

- Email: `swimmer@example.com`
- Password: `Harbour-swim-1`

The sign-in screen shows **Use the demo swimmer** while `EXPOSE_DEMO_LOGIN` is on (the default outside production). The demo account already has one paid sample 30-minute lesson at **West Street Fareham** so you can try rearranging immediately. That sample is labelled in the app; it is not a Stripe charge.

### Useful URLs

| Surface | URL |
| --- | --- |
| API health | http://localhost:4000/api/health |
| Expo web | http://localhost:8081 |
| Staff admin | http://localhost:4000/admin |
| Google redirect URI | http://localhost:4000/api/calendar/callback |

`API_PUBLIC_URL` must be the URL the phone or browser can open. Stripe sends the *user's browser* there after payment; it does not call that URL itself. On a physical device, set both `API_PUBLIC_URL` and `EXPO_PUBLIC_API_URL` to your computer's LAN address, for example `http://192.168.1.20:4000`. Android emulator: `http://10.0.2.2:4000`.

Restart Expo after changing `mobile/.env`.

## Admin area

Open http://localhost:4000/admin and sign in with the **ADMIN_TOKEN**.

Outside production, if `ADMIN_TOKEN` is left blank the API uses `lido-dev-admin` (also set in `.env.example`). In any shared or production environment, set a long random token and keep it private.

What you can do there:

1. **Locations** — add or edit pools (name, address). Hide a location to stop new availability there.
2. **Weekly availability** — recurring **30 or 60 minute** classes tied to a location (day, start time, places, price, lesson type, teacher). Turn a class off to hide future dates without deleting paid bookings.
3. **Upcoming sessions** — materialised calendar dates, add a one-off session, or cancel a single date.
4. **Crash courses** — course products (3/4/5 days, 90 min/day, morning window) and scheduled runs with a first date and daily start time.

The customer app only shows enabled, non-cancelled sessions and course runs with open capacity as bookable. The JSON admin API (`x-admin-token` header) mirrors this: `/api/admin/locations`, `/api/admin/rules`, `/api/admin/slots`, `/api/admin/course-products`, `/api/admin/course-runs`.

After changing availability, pull to refresh the Schedule screen in the app.

## What to click through

1. **Schedule.** Pick 30 or 60 minutes → calendar date → time. Try a crash course from the section below the calendar.
2. **Book.** Pay on the mock page (or Stripe with `4242 4242 4242 4242`).
3. **Lessons.** Confirm the `LD-` reference. Rearrange a lesson or move a course to another run while allowed.
4. **Admin.** Add a location, a weekly class, or a course run and confirm the customer schedule updates.
5. **Google Calendar.** Add-to-calendar link works without OAuth; connect on Account when keys are set.

In Expo Go, the in-app browser sometimes does not bounce straight back into the app after payment. The API confirms the booking when Stripe (or the test page) hits the return URL. Switch back to Lido and pull to refresh My lessons.

## Environment variables

Copy `server/.env.example`. Never commit real keys. Placeholders in the example file are not credentials.

| Variable | Purpose |
| --- | --- |
| `PORT` | API port. Default `4000`. |
| `API_PUBLIC_URL` | Public origin of the API. Used for Stripe return URLs and the Google redirect URI. |
| `APP_WEB_URL` | Expo web origin. Default `http://localhost:8081`. |
| `JWT_SECRET` | Signs sign-in tokens. Required when `NODE_ENV=production`. |
| `DB_PATH` | SQLite file. Default `./data/lido.sqlite`. |
| `PAYMENTS_MODE` | `stripe` or `mock`. If unset, Stripe is used when `STRIPE_SECRET_KEY` is set. |
| `STRIPE_SECRET_KEY` | Stripe secret key, test or live. Use `sk_test_...` locally. |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret. Bookings still confirm from the browser return URL without it. |
| `GOOGLE_CLIENT_ID` | OAuth web client id. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret. |
| `ADMIN_TOKEN` | Protects `/admin` and the admin API. Default outside production: `lido-dev-admin`. |
| `SEED_DEMO_USER` | Seed `swimmer@example.com`. Default on outside production. |
| `EXPOSE_DEMO_LOGIN` | Include the demo password in `GET /api/config`. Default off in production. |
| `EXPO_PUBLIC_API_URL` | API URL baked into the Expo app. Default `http://localhost:4000`. |

The app uses Stripe Checkout in the browser, so a publishable key is not required.

Reset the local database:

```bash
npm run reset --prefix server
```

## Stripe

1. In the [Stripe dashboard](https://dashboard.stripe.com/test/apikeys), copy the test secret key into `STRIPE_SECRET_KEY`.
2. Leave `PAYMENTS_MODE` empty, or set it to `stripe`. Restart the API. The log line should say `Payments: stripe`.
3. Book a lesson or course. Checkout opens on Stripe. Use card `4242 4242 4242 4242`.
4. Optional webhooks, for when the browser never returns:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Put the printed `whsec_...` value in `STRIPE_WEBHOOK_SECRET`. The handler accepts `checkout.session.completed` and confirms the booking only if Stripe says the session is `paid`.

Currency is GBP. Amounts are stored in pence (`£28.00` is `2800`).

## Google Calendar

Automatic sync is optional. The Add to Google Calendar link works without it.

1. In Google Cloud, create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen. While it is in testing, add your Google account as a test user.
3. Create an OAuth client of type **Web application**.
4. Add this authorised redirect URI exactly:

   `http://localhost:4000/api/calendar/callback`

   If `API_PUBLIC_URL` is not localhost, use that origin instead, still with the path `/api/calendar/callback`.
5. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Restart the API.
6. In the app, Account → Connect Google Calendar. Scopes are `calendar.events` plus email, with offline access so a refresh token can be stored.

Connecting once creates an event when a payment is confirmed and updates it when a lesson or course is rearranged. If Google is down, the booking still stands and the screen offers a retry. Disconnecting stops future sync; events already on the calendar stay there.

The refresh token is stored in SQLite for local development. Encrypt it before any real deployment.

## Default Fareham demo data

On startup the API seeds **West Street Fareham** (`153 West Street, Fareham PO16 0EL`) unless it already exists, then fills eight weeks of materialised slots (customers can book six):

| When | Session | Length | Places | Price |
| --- | --- | --- | --- | --- |
| Monday 7:00pm | Adult beginners | 30 min | 8 | £22 |
| Tuesday 6:30pm | Improvers | 60 min | 8 | £32 |
| Wednesday 12:15pm | Lunchtime lane skills | 30 min | 6 | £20 |
| Thursday 7:00pm | Adult beginners | 60 min | 10 | £32 |
| Saturday 9:00am | Water confidence | 30 min | 8 | £24 |
| Sunday 10:00am | Technique workshop | 60 min | 6 | £36 |

It also schedules **3-, 4-, and 5-day crash course runs** in the 6–9am window within the next six weeks, adds a drop-in about 12 hours ahead (to demo the 24-hour lock), and a one-place session that is already full.

Edit or extend this from `/admin` — you do not need to touch the seed file for day-to-day changes.

## Tests

```bash
npm test
npm run typecheck
```

The API tests cover the 6-week boundary in Europe/London, the 24-hour rearrange cutoff (including daylight saving), 30/60 minute filtering, location listing, crash course booking and same-length reschedule, capacity holds, payment required before confirm, Stripe webhook confirmation, Google Calendar connect/sync, and admin weekly rules feeding the customer calendar. They use an in-memory database and do not call Stripe or Google.

## Production notes

This is a local MVP. Before exposing it:

- Set `NODE_ENV=production`, a long `JWT_SECRET`, a strong `ADMIN_TOKEN`, and `EXPOSE_DEMO_LOGIN=false`.
- Use `PAYMENTS_MODE=stripe` with live keys only when you intend to charge people, and set `STRIPE_WEBHOOK_SECRET`.
- Serve the API over HTTPS and point `API_PUBLIC_URL` at that origin.
- Replace the SQLite file with a managed database if more than one API process will run.
- Do not rely on mock payments. They are a labelled stand-in for clicking through the UI.

Cancellation and refunds are not part of this version. Rearranging keeps the original payment.
