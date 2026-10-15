import { describe, it, expect } from "vitest";
import { Trip } from "../src/domain/schema.ts";
import {
  FIELD_REGISTRY,
  TRIP_FIELD_KEYS,
  getFieldDefinition,
} from "../src/domain/fieldRegistry.ts";
import { HANDOFF_REQUIRED_FIELDS } from "../src/application/questions.ts";

describe("Field Registry (Pattern 6)", () => {
  const schemaKeys = Object.keys(Trip.shape) as Array<keyof Trip>;

  it("covers every single key present in Trip schema", () => {
    for (const key of schemaKeys) {
      expect(FIELD_REGISTRY[key]).toBeDefined();
      expect(FIELD_REGISTRY[key].key).toBe(key);
    }
  });

  it("defines bilingual labels for every field", () => {
    for (const key of schemaKeys) {
      const def = getFieldDefinition(key);
      expect(def.label.en).toBeTruthy();
      expect(def.label.zh).toBeTruthy();
    }
  });

  it("accurately marks handoff required fields matching HANDOFF_REQUIRED_FIELDS contract", () => {
    for (const requiredKey of HANDOFF_REQUIRED_FIELDS) {
      const def = getFieldDefinition(requiredKey);
      expect(def.requiredForHandoff).toBe(true);
    }
  });

  it("retrieves individual field definition via getFieldDefinition", () => {
    const guestsDef = getFieldDefinition("guests");
    expect(guestsDef.key).toBe("guests");
    expect(guestsDef.requiredForHandoff).toBe(true);
    expect(guestsDef.factGate?.type).toBe("count");
    expect(guestsDef.factGate?.countType).toBe("guests");
  });

  it("has questions configured for interactive customer fields", () => {
    const interactiveFields: Array<keyof Trip> = [
      "checkIn",
      "nights",
      "guests",
      "rooms",
      "roomType",
      "meals",
      "transport",
      "contactName",
      "diver",
      "divers",
      "diveFrom",
      "diveTo",
      "transportType",
    ];

    for (const field of interactiveFields) {
      const def = getFieldDefinition(field);
      expect(def.question).toBeDefined();
    }
  });
});
