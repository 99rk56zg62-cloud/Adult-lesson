import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { COURSE_LENGTHS, COURSE_PACKAGE_PRICES, type CourseLength } from "./availability.js";
import { coursePaymentPlan } from "./deposits.js";
import { getRow } from "./db.js";
import { AppError } from "./errors.js";
import { formatGBP } from "./format.js";
import { ZONE } from "./time.js";

export const DEFAULT_CONTACT_EMAIL = "hello@farehamswimschool.com";
export const DEFAULT_CONTACT_PHONE = "01329 802208";
const PAGES_KEY = "customer_pages";

export type CoursePackageCopy = {
  days: CourseLength;
  title: string;
  body: string;
};

export type LevelCopy = {
  id: "water-phobia" | "beginners" | "intermediate" | "advanced" | "technique";
  title: string;
  body: string;
};

export type CustomerPages = {
  contactEmail: string;
  contactPhone: string;
  courseIntro: string;
  packages: CoursePackageCopy[];
  weeklyCard: string;
  weeklyIntro: string;
  weeklyHeading: string;
  levels: LevelCopy[];
  weeklyClosing: string;
};

export type PublicPackage = CoursePackageCopy & {
  pricePence: number;
  priceLabel: string;
  depositLabel: string;
  balanceLabel: string;
  recommended: boolean;
};

const LEVEL_IDS: LevelCopy["id"][] = ["water-phobia", "beginners", "intermediate", "advanced", "technique"];

export function defaultCustomerPages(): CustomerPages {
  return {
    contactEmail: DEFAULT_CONTACT_EMAIL,
    contactPhone: DEFAULT_CONTACT_PHONE,
    courseIntro: [
      "Here is some useful information on the different swimming course packages that we provide. We've included prices so that it takes the guess work out of the equation for you! Please check out our payment plan options if you need some help with the price.",
      "During your course, we book the whole swimming facility just for you, giving you the privacy and peace required to learn. Please take a look at the packages below and see which is the correct one for you based on your current level and budget. Remember we are only an email away so if you need help to decide what will suit your needs, just give us a shout and you can speak to a dedicated swim course specialist.",
    ].join("\n\n"),
    packages: [
      {
        days: 2,
        title: "The 2 day intensive swimming course — £249.00",
        body: "If you can swim but want to get stronger and more efficient at it, the 2 day course is the one you need. We will work on technique and confidence, making sure that you gain more ability in the stroke you already enjoy. We will also get the chance to work on any extras that might be of interest to you, like diving, treading water. This course will give you 3 hours of pool time with your specialist adult teacher set over 2 days.",
      },
      {
        days: 3,
        title: "The 3 day intensive swimming course — £349.00",
        body: "This is ideal for you if you enjoy being in the water and are able to swim a little bit. If you can move through the water but not necessarily with any style or grace and you want to make swimming easier and more effective, this is the course for you. This course will give you 4.5 hours of pool time with your very own personal teacher.",
      },
      {
        days: 4,
        title: "The 4 day intensive swimming course — £449.00",
        body: "If you can't swim but are not at all scared of the water, this 4 day course will give you lots of time to get the hang of the whole process. Starting with the very basics to give you a great foundation to build on, we will work through all the aspects of swimming. This course will give you 6 hours of pool time. It's hard work and fun but will be worth it! And we will adjust it to the pace you are comfortable with.",
      },
      {
        days: 5,
        title: "The 5 day intensive swimming course — £549.00",
        body: "This is the course for you if you can't swim and have any fear of the water. The 5 day course will give us plenty of time to crack the science of swimming and to build your confidence in the water. Being comfortable in the swimming pool environment needs to be achieved as much as gaining ability to swim. This course will give you 7.5 hours of pool time with your specialist adult teacher.",
      },
    ],
    weeklyCard:
      "Please see full information about our private weekly swimming lessons for beginners, intermediate, advanced and those seeking to refine their swimming abilities.",
    weeklyIntro:
      "If you are lucky enough to live close by Swim School Academy Fareham, we can organise you a lesson plan to fit in with your life and budget. Whether that's weekly lessons, fortnightly lessons or just a session every now and again between your own practice, we have something to suit everyone.",
    weeklyHeading: "We cater for all levels here at Swim School Academy Fareham",
    levels: [
      {
        id: "water-phobia",
        title: "Water Phobia",
        body: "If you have a fear of the water our kind, caring staff will be just what you need to overcome the obstacles standing in the way of you and enjoyment in the water. We teach hundreds of people that have phobias for many different reason. You may have had, or witnessed a drowning incident or grown up in a house where your parents had a fear of water, passing it on to you subconsciously.",
      },
      {
        id: "beginners",
        title: "Beginners",
        body: "Many people have just never been given the opportunity to learn to swim, it just wasn't something all families did. If you love being in water but are lacking the ability to take your feet off the floor or to get from side to side, then our beginner lessons are perfect for you, we will take you through the foundations of swimming and build from there.",
      },
      {
        id: "intermediate",
        title: "Intermediate",
        body: "Swimmers who can get from one side to the other but feel they are out of breath, splashy or just don't have a stroke they feel is working for them can come to us so we can analyse what is going to improve their stroke, we can then start implementing changes on lesson 1.",
      },
      {
        id: "advanced",
        title: "Advanced",
        body: "This is swimmers who regularly swim lengths but want to improve their speed, stamina or performance. If this sounds like you, we will look for the subtle changes that will make a massive difference to your stroke, giving you things to go and work on between your sessions. All our lessons are either 30 or 60 minutes long, giving us the time to get everything that we need to done.",
      },
      {
        id: "technique",
        title: "Technique Refinement",
        body: "These hour-long sessions are specifically designed for athletes, triathletes and the serious fitness swimmer. If you want to increase your stamina, gain better lap times, use less energy when swimming or just work on a specific area to improve your stroke with a professional, this is the best option for you.",
      },
    ],
    weeklyClosing: [
      "We only teach 1:1 or private lessons with you and a friend/ family member. In our experience weekly mixed classes don't work for most people, so if you have tried the local pool lessons before and felt disheartened we can assure you that you will get a million times more value from our lessons, get in touch today for more information.",
      "Whatever your reasons for wanting to achieve your swimming goals, we can guarantee we have heard it all before. No problem is too big or too small for us, so please give us a call or email us and we will be able to give you plenty of information on how we can help you.",
    ].join("\n\n"),
  };
}

export function phoneTel(display: string): string {
  const compact = display.replace(/[^\d+]/g, "");
  if (compact.startsWith("+")) return `tel:${compact}`;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("0")) return `tel:+44${digits.slice(1)}`;
  return `tel:+${digits}`;
}

export function contactQuestion(phone: string, email: string): string {
  return `Any further questions? Call ${phone} or email ${email}`;
}

export function recommendedCourseDays(level: string | null | undefined): CourseLength | null {
  if (level === "advanced" || level === "improver") return 2;
  if (level === "basic") return 3;
  if (level === "scared") return 5;
  return null;
}

export function paymentPlanText(): string {
  const bookedAt = DateTime.fromISO("2026-01-01T12:00:00", { zone: ZONE });
  const first = bookedAt.plus({ months: 3 });
  const lines = COURSE_LENGTHS.map((days) => {
    const plan = coursePaymentPlan(COURSE_PACKAGE_PRICES[days], first, bookedAt);
    return `${days} days: ${formatGBP(plan.depositPence)} deposit today, then ${formatGBP(plan.balancePence)} four weeks before the first day.`;
  });
  return [
    "The deposit is 20% of the course price and it is non-refundable. The other 80% is taken 4 weeks before the first day. If the course starts inside those 4 weeks, you pay the full price when you book.",
    ...lines,
  ].join("\n");
}

export function loadCustomerPages(db: DatabaseSync): CustomerPages {
  const row = getRow<{ value: string }>(db, `SELECT value FROM app_settings WHERE key = ?`, PAGES_KEY);
  if (!row) return defaultCustomerPages();
  try {
    return assertCustomerPages(JSON.parse(row.value));
  } catch {
    return defaultCustomerPages();
  }
}

export function saveCustomerPages(db: DatabaseSync, input: unknown, nowIso: string): CustomerPages {
  const pages = assertCustomerPages(input);
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(PAGES_KEY, JSON.stringify(pages), nowIso);
  return pages;
}

export function presentCustomerPages(pages: CustomerPages, swimmingLevel: string | null) {
  const recommended = recommendedCourseDays(swimmingLevel);
  return {
    contactEmail: pages.contactEmail,
    contactPhone: pages.contactPhone,
    contactTel: phoneTel(pages.contactPhone),
    courseIntro: pages.courseIntro,
    packages: pages.packages.map((item) => {
      const pricePence = COURSE_PACKAGE_PRICES[item.days];
      const depositPence = Math.round(pricePence * 0.2);
      return {
        ...item,
        pricePence,
        priceLabel: formatGBP(pricePence),
        depositLabel: formatGBP(depositPence),
        balanceLabel: formatGBP(pricePence - depositPence),
        recommended: item.days === recommended,
      };
    }),
    weeklyCard: pages.weeklyCard,
    weeklyIntro: pages.weeklyIntro,
    weeklyHeading: pages.weeklyHeading,
    levels: pages.levels,
    weeklyClosing: pages.weeklyClosing,
    paymentPlan: paymentPlanText(),
    contactLine: contactQuestion(pages.contactPhone, pages.contactEmail),
  };
}

export function assertCustomerPages(input: unknown): CustomerPages {
  if (!input || typeof input !== "object") {
    throw new AppError(400, "VALIDATION", "The page text is missing.");
  }
  const raw = input as Partial<CustomerPages>;
  const contactEmail = String(raw.contactEmail ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new AppError(400, "VALIDATION", "Enter a contact email address.");
  }
  const contactPhone = String(raw.contactPhone ?? "").trim();
  const digits = contactPhone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new AppError(400, "VALIDATION", "Enter a contact phone number.");
  }
  const packages = Array.isArray(raw.packages) ? raw.packages : [];
  if (packages.length !== COURSE_LENGTHS.length) {
    throw new AppError(400, "VALIDATION", "Each crash course needs its own description.");
  }
  const normalisedPackages = COURSE_LENGTHS.map((days) => {
    const found = packages.find((item) => item && Number(item.days) === days);
    if (!found) throw new AppError(400, "VALIDATION", `Add the ${days}-day course description.`);
    return {
      days,
      title: requiredText(found.title, `Add a title for the ${days}-day course.`),
      body: requiredText(found.body, `Add the ${days}-day course description.`),
    };
  });
  const levels = Array.isArray(raw.levels) ? raw.levels : [];
  const normalisedLevels = LEVEL_IDS.map((id) => {
    const found = levels.find((item) => item && item.id === id);
    const fallback = defaultCustomerPages().levels.find((item) => item.id === id)!;
    if (!found) throw new AppError(400, "VALIDATION", `Add the ${fallback.title} description.`);
    return {
      id,
      title: requiredText(found.title, `Add a title for ${fallback.title}.`),
      body: requiredText(found.body, `Add the ${fallback.title} description.`),
    };
  });
  return {
    contactEmail,
    contactPhone,
    courseIntro: requiredText(raw.courseIntro, "Add the crash course introduction."),
    packages: normalisedPackages,
    weeklyCard: requiredText(raw.weeklyCard, "Add the weekly lessons card."),
    weeklyIntro: requiredText(raw.weeklyIntro, "Add the weekly lessons introduction."),
    weeklyHeading: requiredText(raw.weeklyHeading, "Add the weekly lessons heading."),
    levels: normalisedLevels,
    weeklyClosing: requiredText(raw.weeklyClosing, "Add the weekly lessons closing."),
  };
}

function requiredText(value: unknown, message: string): string {
  const text = String(value ?? "").trim();
  if (text.length < 2) throw new AppError(400, "VALIDATION", message);
  if (text.length > 5000) throw new AppError(400, "VALIDATION", "That text is too long.");
  return text;
}
