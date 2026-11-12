# Lido

Adult swimming lesson bookings for iOS, Android, and web. Customers pick a date on the month calendar, then a 30 or 60 minute lesson, then a start time inside that day's availability window. They can also book a 3/4/5-day morning crash course. Lessons are not organised by skill level. Several lessons can go in one basket and one payment. Bookings are non-refundable. A lesson can be moved until 24 hours before it starts, and that move updates Google Calendar.

The mobile client is Expo (React Native). The API is a small Node server with SQLite. Business rules are enforced on the server. Pool staff manage locations, availability windows, lesson prices, and crash courses in a simple admin web page.

## How booking works now

1. Open **Schedule**. The location is **West Street Fareham** (`153 West Street`) unless staff have added another pool, in which case the customer picks one first.
2. Tap a highlighted date in the next **6 weeks** (UK / Europe/London). Only dates with something free can be selected. Grey dates are full or have no window.
3. Choose the lesson length: **30 minutes (£30)** or **60 minutes (£60)**. The same prices apply to 1-to-1 and 1-to-2. Switching length updates the times immediately. Staff can change the two prices in admin.
4. The day shows every start on the hour or half hour that fits inside the window (a 60 minute lesson in a 6:00–9:00 window can start no later than 8:00). Free times show the price. Times that overlap a booking, a live hold, or a crash course stay on the grid in grey.
5. Tap a free time to add it to the basket. Choose another date or length and add more, including a mix of 30 and 60 minutes, as long as the lessons do not overlap. The bar shows the count and the running total. Remove a lesson before paying.
6. Pay once for the basket total (Stripe Checkout, or the local test-payment page when no Stripe key is set). The checkout repeats: **Bookings are non-refundable. You can move your lesson up to 24 hours before it starts.** Payment creates one booking per lesson.
7. Scroll to **Crash courses** to book a whole 3-, 4-, or 5-day run of the same session type. Each day is **90 minutes**, with daily starts between **06:00 and 09:00** UK time. The price is the package total: **£349** (3 days), **£449** (4 days), or **£549** (5 days). The app shows every day and time in the package. Courses are booked as a package, not through the lesson basket.
8. Bookings appear under **Lessons**, with the same non-refundable line. **Rearrange** is offered until **24 hours** before a lesson starts. Inside that window the button is hidden and the screen says you can move a lesson until 24 hours before it starts. Crash courses can be moved to another open run of the **same length** until **24 hours before day one**. There is no customer cancel action and no refund.
9. Use **Add to Google Calendar** on a booking, or connect Google on Account so paid bookings sync automatically. Moving a lesson updates its calendar event and frees the old time.

Staff set locations, daily availability windows, the £30 and £60 rates, and crash course products/runs in the **admin area**.

## Rules

- A session or course can be booked only if its first day starts in the future and falls within **6 weeks of today** in `Europe/London`.
- **Bookings are non-refundable.** Once a lesson or course is paid, the customer can move it; they cannot cancel it for a refund.
- A confirmed **single lesson** can be rearranged until **24 hours before it starts**. At that instant it is still allowed; one millisecond later it is not. The API rejects a late move before it looks for a new time. The new start must be on the hour or half hour, fit inside that day's window, and not overlap another lesson or crash course. The old time becomes bookable again, and the Google Calendar event is updated when the account is connected.
- A confirmed **crash course** can be moved to another open run with the **same day count** until **24 hours before the first day's start**. After that the whole package is locked. Rearranging never charges the card again.
- A 30 minute lesson is **£30** and a 60 minute lesson is **£60**, for both 1-to-1 and 1-to-2. Checkout charges the current rate for each lesson in the basket, after re-checking that every start is still free.
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

The sign-in screen shows **Use the demo swimmer** while `EXPOSE_DEMO_LOGIN` is on (the default outside production). The demo account already has one paid sample lesson at **West Street Fareham** so you can try rearranging immediately. That sample is labelled in the app; it is not a Stripe charge.

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
2. **Lesson prices** — the 30 minute and 60 minute rates. Defaults are £30 and £60.
3. **Availability windows** — the open hours for each weekday and location. Customers book a 30 or 60 minute start on the hour or half hour inside that window. West Street Fareham is seeded as **06:00–09:00 every day**.
4. **Upcoming sessions** — booked lessons and one-off dates. Staff can cancel a single date from the diary; customers cannot.
5. **Crash courses** — course products (3/4/5 days, 90 min/day, morning window, 1-to-1 or 1-to-2, package price) and scheduled runs with a first date and daily start time. Defaults are £349, £449, and £549.

The customer schedule is built from those windows. The JSON admin API (`x-admin-token` header) includes `/api/admin/locations`, `/api/admin/windows`, `/api/admin/lesson-prices`, `/api/admin/rules`, `/api/admin/slots`, `/api/admin/course-products`, and `/api/admin/course-runs`.

After changing availability, pull to refresh the Schedule screen in the app.

## What to click through

1. **Schedule.** Choose a highlighted date, then 30 or 60 minutes, then a start time. Grey times are taken. Add more than one lesson and check the running total.
2. **Basket.** Pay once on the mock page (or Stripe with `4242 4242 4242 4242`). The non-refundable line is on the basket and on the test-payment page.
3. **Lessons.** Confirm each `LD-` reference. Rearrange a lesson that is more than 24 hours away. A lesson inside 24 hours shows the lock note and no Rearrange button.
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

Currency is GBP. Amounts are stored in pence (`£30.00` is `3000`, `£60.00` is `6000`). A basket checkout sends one Stripe session with a line for each lesson. The API does not call Stripe Refunds.

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

On startup the API seeds **West Street Fareham** (`153 West Street, Fareham PO16 0EL`) unless it already exists, plus an availability window of **06:00–09:00 every day** and lesson rates of **£30** (30 min) and **£60** (60 min). Customers book inside that window for the next six weeks. Sessions are private — 1-to-1 or 1-to-2, not a class size. One 08:00 start a few days ahead is already taken, so that time stays hidden.

It also schedules **3-, 4-, and 5-day crash course runs** in the 6–9am window within the next six weeks. Each day is 90 minutes. The charge is the package total: **£349** (3-day, 1-to-1), **£449** (4-day, 1-to-2), and **£549** (5-day, 1-to-1). The demo swimmer has one paid lesson more than 24 hours ahead so Rearrange can be tried immediately.

Edit or extend this from `/admin` — you do not need to touch the seed file for day-to-day changes.

## Tests

```bash
npm test
npm run typecheck
```

The API tests cover the 6-week boundary in Europe/London, the 24-hour rearrange cutoff (including daylight saving), availability windows with hour and half-hour starts, 30/60 minute pricing, 1-to-1 and 1-to-2 filtering, location listing, crash course booking at the package prices and same-length reschedule, capacity holds, payment required before confirm, Stripe webhook confirmation, Google Calendar connect/sync when a booking is paid or moved, and admin windows feeding the customer calendar. They use an in-memory database and do not call Stripe or Google.

## Production notes

This is a local MVP. Before exposing it:

- Set `NODE_ENV=production`, a long `JWT_SECRET`, a strong `ADMIN_TOKEN`, and `EXPOSE_DEMO_LOGIN=false`.
- Use `PAYMENTS_MODE=stripe` with live keys only when you intend to charge people, and set `STRIPE_WEBHOOK_SECRET`.
- Serve the API over HTTPS and point `API_PUBLIC_URL` at that origin.
- Replace the SQLite file with a managed database if more than one API process will run.
- Do not rely on mock payments. They are a labelled stand-in for clicking through the UI.

Bookings are non-refundable. Customers can move a lesson until 24 hours before it starts. Rearranging keeps the original payment.
