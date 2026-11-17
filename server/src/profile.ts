import { DateTime } from "luxon";
import { AppError } from "./errors.js";
import { ZONE } from "./time.js";

export const CONSENT_TEXT =
  "I confirm these details are accurate and consent to Swim School Academy storing them to keep me safe in lessons";

export const SWIMMING_LEVELS = [
  { id: "scared", label: "Scared non-swimmer" },
  { id: "basic", label: "Basic swim skills" },
  { id: "improver", label: "Improver" },
  { id: "advanced", label: "Advanced swimmer" },
] as const;

export type SwimmingLevel = (typeof SWIMMING_LEVELS)[number]["id"];

export type ProfileInput = {
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  town: string;
  postcode: string;
  dateOfBirth: string;
  phone: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  medicalNone: boolean;
  medicalNotes?: string;
  swimmingLevel: string;
  consent: boolean;
};

export type ProfileRecord = {
  userId: string;
  fullName: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  postcode: string;
  dateOfBirth: string;
  phone: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  medicalNone: boolean;
  medicalNotes: string;
  swimmingLevel: SwimmingLevel;
  consentAt: string;
};

export function assertProfileInput(input: ProfileInput, now: DateTime): Omit<ProfileRecord, "userId" | "consentAt"> {
  if (!input.consent) {
    throw new AppError(400, "CONSENT_REQUIRED", CONSENT_TEXT);
  }
  const fullName = required(input.fullName, "Enter your full name.");
  const addressLine1 = required(input.addressLine1, "Enter the first line of your address.");
  const town = required(input.town, "Enter your town.");
  const postcode = required(input.postcode, "Enter your postcode.").toUpperCase();
  const phone = requiredPhone(input.phone, "Enter a phone number.");
  const emergencyName = required(input.emergencyName, "Enter an emergency contact name.");
  const emergencyRelationship = required(input.emergencyRelationship, "Enter how you know your emergency contact.");
  const emergencyPhone = requiredPhone(input.emergencyPhone, "Enter your emergency contact's phone number.");
  const dob = DateTime.fromISO(input.dateOfBirth, { zone: ZONE });
  if (!dob.isValid || input.dateOfBirth.length < 10) {
    throw new AppError(400, "VALIDATION", "Enter your date of birth.");
  }
  if (dob.startOf("day") > now.setZone(ZONE).startOf("day") || dob.year < 1900) {
    throw new AppError(400, "VALIDATION", "Enter a real date of birth.");
  }
  const level = SWIMMING_LEVELS.find((item) => item.id === input.swimmingLevel);
  if (!level) throw new AppError(400, "VALIDATION", "Choose a swimming level.");
  const medicalNone = Boolean(input.medicalNone);
  const medicalNotes = (input.medicalNotes ?? "").trim();
  if (!medicalNone && medicalNotes.length < 2) {
    throw new AppError(400, "VALIDATION", "Add any medical conditions, or tick none.");
  }
  return {
    fullName,
    addressLine1,
    addressLine2: (input.addressLine2 ?? "").trim(),
    town,
    postcode,
    dateOfBirth: dob.toFormat("yyyy-MM-dd"),
    phone,
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
    medicalNone,
    medicalNotes: medicalNone ? "" : medicalNotes,
    swimmingLevel: level.id,
  };
}

function required(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) throw new AppError(400, "VALIDATION", message);
  return trimmed;
}

function requiredPhone(value: string, message: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8) throw new AppError(400, "VALIDATION", message);
  return trimmed;
}
