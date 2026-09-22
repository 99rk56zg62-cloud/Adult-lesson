# Lido

Adult swimming lesson bookings for iOS, Android, and web. Customers pick a date on a calendar, choose an open time, pay when they book, rearrange until 24 hours before the start, and add the lesson to Google Calendar.

The mobile client is Expo (React Native). The API is a small Node server with SQLite. Business rules are enforced on the server. Pool staff manage weekly availability in a simple admin web page.

## How booking works now

1. Open **Schedule**. You see a month calendar of dates in the next **6 weeks** (UK / Europe/London).
2. Dates with open places are highlighted. Full or empty dates are greyed out and cannot be selected.
3. Tap a date to see the **times** that day — lesson type, pool, teacher, price, and spots left. Full times stay visible but cannot be booked.
4. Tap a time, confirm the details, and pay (Stripe Checkout, or the local test-payment page when no Stripe key is set).
5. The lesson appears under **Lessons**. You can rearrange it until **24 hours** before the start. Inside that window the control is locked.
6. Use **Add to Google Calendar** on a booking, or connect Google on Account so paid and rearranged lessons sync automatically.

Staff set the weekly classes (and one-off sessions) in the **admin area**. Those rules are what appear on the customer calendar.

## Rules (unchanged)

- A session can be booked only if it starts in the future and its calendar day in `Europe/London` is within **6 weeks of today**.
- A confirmed lesson can be **rearranged until 24 hours before it starts**. At that instant it is still allowed; one millisecond later it is not. Rearranging does not charge the card again.
- A pending checkout **holds a place for 45 minutes**. Confirmed bookings and live holds count towards capacity. A payment that lands after the hold expired is confirmed only if a place is still free.
- A booking becomes confirmed only after Stripe reports the Checkout session as paid (or after the local test-payment stand-in, when Stripe is not configured).

## Project layout

```
server/     Express API — availability, slots, bookings, Stripe, Google Calendar, /admin
mobile/     Expo app — calendar schedule, payment, lessons, account
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

Then press `w` in the Expo terminal for web, or scan the QR code with Expo Go. iOS Simulator needs a Mac. Web is the fastest way to click through the flows.

With no Stripe key, the API starts in **mock payment** mode and seeds a demo swimmer:

- Email: `swimmer@example.com`
- Password: `Harbour-swim-1`

The sign-in screen shows **Use the demo swimmer** while `EXPOSE_DEMO_LOGIN` is on (the default outside production). The demo account already has one paid sample lesson so you can try rearranging immediately. That sample is labelled in the app; it is not a Stripe charge.

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

1. **Weekly availability** — add or edit a recurring class (day of week, start time, length, places, price, pool, lesson type, teacher). Turn a class off to hide future dates from customers without deleting paid bookings.
2. **Upcoming sessions** — see the materialised calendar dates, add a one-off session, or cancel a single date (that day goes grey for customers).

The customer app only shows enabled, non-cancelled sessions with open capacity as bookable. The JSON admin API (`x-admin-token` header) is still available for automation: `/api/admin/rules` and `/api/admin/slots`.

After changing availability, pull to refresh the Schedule calendar in the app.

## What to click through

1. **Schedule.** Month calendar → pick an open date → choose a time.
2. **Book.** Pay on the mock page (or Stripe with `4242 4242 4242 4242`).
3. **Lessons.** Confirm the `LD-` reference. Try rearrange while allowed; open a soon session to see the 24-hour lock.
4. **Admin.** At `/admin`, add a Friday class or cancel one session and confirm it updates the customer calendar.
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
3. Book a lesson. Checkout opens on Stripe. Use card `4242 4242 4242 4242`.
4. Optional webhooks, for when the browser never returns:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Put the printed `whsec_...` value in `STRIPE_WEBHOOK_SECRET`. The handler accepts `checkout.session.completed` and confirms the booking only if Stripe says the session is `paid`.

Currency is GBP. Amounts are the session price in pence (`£28.00` is `2800`).

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

Connecting once creates an event when a payment is confirmed and updates it when the lesson is rearranged. If Google is down, the booking still stands and the screen offers a retry. Disconnecting stops future sync; events already on the calendar stay there.

The refresh token is stored in SQLite for local development. Encrypt it before any real deployment.

## Default weekly schedule

On startup the API seeds these weekly classes (unless they already exist) and fills eight weeks of dates (customers can book six):

| When | Session | Where | Places | Price |
| --- | --- | --- | --- | --- |
| Monday 7:00pm | Adult beginners | Riverside Lido | 8 | £28 |
| Tuesday 6:30pm | Improvers | Riverside Lido | 8 | £28 |
| Wednesday 12:15pm | Lunchtime lane skills | Harbour Pool | 6 | £24 |
| Thursday 7:00pm | Adult beginners | Harbour Pool | 10 | £28 |
| Saturday 9:00am | Water confidence | Riverside Lido | 8 | £30 |
| Sunday 10:00am | Technique workshop | Harbour Pool | 6 | £32 |

It also adds a drop-in about 12 hours ahead (so the 24-hour lock is easy to see) and a one-place workshop that is already full.

Edit or extend this list from `/admin` — you do not need to touch the seed file for day-to-day changes.

## Tests

```bash
npm test
npm run typecheck
```

The API tests cover the 6-week boundary in Europe/London, the 24-hour rearrange cutoff (including the daylight-saving change), capacity holds, payment required before confirm, Stripe webhook confirmation, Google Calendar connect/sync, and admin weekly rules feeding the customer calendar. They use an in-memory database and do not call Stripe or Google.

## Production notes

This is a local MVP. Before exposing it:

- Set `NODE_ENV=production`, a long `JWT_SECRET`, a strong `ADMIN_TOKEN`, and `EXPOSE_DEMO_LOGIN=false`.
- Use `PAYMENTS_MODE=stripe` with live keys only when you intend to charge people, and set `STRIPE_WEBHOOK_SECRET`.
- Serve the API over HTTPS and point `API_PUBLIC_URL` at that origin.
- Replace the SQLite file with a managed database if more than one API process will run.
- Do not rely on mock payments. They are a labelled stand-in for clicking through the UI.

Cancellation and refunds are not part of this version. Rearranging keeps the original payment.
