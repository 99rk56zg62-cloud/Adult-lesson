export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${esc(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #0c2e33; color: #14262b; font-family: Georgia, "Iowan Old Style", Palatino, serif; }
    main { max-width: 440px; margin: 32px auto; background: #f6f1e8; border-radius: 22px; padding: 28px 22px 32px; }
    .eyebrow { margin: 0; letter-spacing: 0.16em; font: 700 12px "Segoe UI", sans-serif; color: #0f6e6a; }
    h1 { font-size: 34px; line-height: 1.05; margin: 10px 0; }
    p, li { font-family: "Segoe UI", sans-serif; line-height: 1.45; }
    .muted { color: #5c6b70; }
    .card { background: #fff; border-radius: 16px; padding: 14px 16px; margin: 16px 0; }
    button, .button { display: block; width: 100%; box-sizing: border-box; margin-top: 16px; background: #0c2e33; color: #fff; text-align: center; text-decoration: none; border: 0; border-radius: 14px; padding: 14px 16px; font: 600 16px "Segoe UI", sans-serif; }
    .note { font-size: 14px; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function mockCheckoutPage(input: {
  token: string;
  reference: string;
  title: string;
  dayLabel: string;
  timeLabel: string;
  location: string;
  priceLabel: string;
  alreadyPaid: boolean;
}): string {
  const action = input.alreadyPaid
    ? `<button type="submit">Return to your lesson</button>`
    : `<button type="submit">Pay ${esc(input.priceLabel)}</button>`;
  return shell(
    "Lido test payment",
    `<p class="eyebrow">LIDO · TEST PAYMENT</p>
     <h1>${input.alreadyPaid ? "Already paid" : "Pay for your lesson"}</h1>
     <p class="muted">This stand-in runs only when the API has no Stripe secret key. With <strong>STRIPE_SECRET_KEY</strong> set, this page is Stripe Checkout instead.</p>
     <div class="card">
       <strong>${esc(input.title)}</strong>
       <p class="muted">${esc(input.dayLabel)} · ${esc(input.timeLabel)}<br />${esc(input.location)}</p>
       <p>Booking ${esc(input.reference)} · ${esc(input.priceLabel)}</p>
     </div>
     <form method="post" action="/api/payments/mock-complete">
       <input type="hidden" name="token" value="${esc(input.token)}" />
       ${action}
     </form>
     <p class="note muted">No card is charged. Use Stripe test mode when you want a real Checkout payment.</p>`,
  );
}

export function redirectPage(targetUrl: string, heading: string, message: string): string {
  const scriptTarget = JSON.stringify(targetUrl).replace(/</g, "\\u003c");
  return shell(
    heading,
    `<p class="eyebrow">LIDO</p>
     <h1>${esc(heading)}</h1>
     <p>${esc(message)}</p>
     <a class="button" href="${esc(targetUrl)}">Continue</a>
     <script>window.location.replace(${scriptTarget});</script>`,
  );
}

export function infoPage(heading: string, message: string): string {
  return shell(
    heading,
    `<p class="eyebrow">LIDO</p>
     <h1>${esc(heading)}</h1>
     <p>${esc(message)}</p>`,
  );
}
