import assert from "node:assert/strict";
import { test } from "node:test";
import { appendQuery, isAllowedReturnUrl } from "./return-url.js";

const web = "http://localhost:8081";

test("allows app schemes and local hosts, and rejects open redirects", () => {
  assert.equal(isAllowedReturnUrl("lido://payment/success", web), true);
  assert.equal(isAllowedReturnUrl("exp://127.0.0.1:8081/--/payment/success", web), true);
  assert.equal(isAllowedReturnUrl("http://192.168.1.20:8081/payment/success", web), true);
  assert.equal(isAllowedReturnUrl("http://localhost:8081/payment/success", web), true);
  assert.equal(isAllowedReturnUrl("https://evil.example/phish", web), false);
  assert.equal(isAllowedReturnUrl("javascript:alert(1)", web), false);
  assert.equal(isAllowedReturnUrl("http://user:pass@localhost/payment/success", web), false);
});

test("appends a payment session to an app deep link", () => {
  assert.equal(
    appendQuery("lido://payment/success", { session_id: "cs_1", booking_id: "b 1" }),
    "lido://payment/success?session_id=cs_1&booking_id=b+1",
  );
});
