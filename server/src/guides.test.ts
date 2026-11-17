import assert from "node:assert/strict";
import { test } from "node:test";
import { contactQuestion, defaultCustomerPages, phoneTel, recommendedCourseDays } from "./guides.js";

test("turns the Fareham phone number into a call link", () => {
  assert.equal(phoneTel("01329 802208"), "tel:+441329802208");
  assert.equal(phoneTel("+44 1329 802208"), "tel:+441329802208");
});

test("suggests a crash course from the saved swimming level", () => {
  assert.equal(recommendedCourseDays("advanced"), 2);
  assert.equal(recommendedCourseDays("improver"), 2);
  assert.equal(recommendedCourseDays("basic"), 3);
  assert.equal(recommendedCourseDays("scared"), 5);
  assert.equal(recommendedCourseDays(null), null);
});

test("keeps Aaron's wording, the Fareham contact details, and the bookable lesson lengths", () => {
  const pages = defaultCustomerPages();
  const blob = JSON.stringify(pages);
  assert.equal(pages.contactEmail, "hello@farehamswimschool.com");
  assert.equal(pages.contactPhone, "01329 802208");
  assert.match(pages.levels.find((level) => level.id === "water-phobia")!.body, /hundreds of people/);
  assert.equal(blob.includes("thousands of people"), false);
  assert.match(pages.levels.find((level) => level.id === "advanced")!.body, /30 or 60 minutes long/);
  assert.equal(blob.includes("60 or 90"), false);
  assert.equal(blob.includes("The Swim People"), false);
  assert.match(blob, /Swim School Academy Fareham/);
  assert.equal(contactQuestion(pages.contactPhone, pages.contactEmail), "Any further questions? Call 01329 802208 or email hello@farehamswimschool.com");
});
