import type { Trip } from "./schema.js";

// Playbook: "Generate questions for missing and default fields in the backend's
// priority order: dates, guest count, rooms, and only then meals and transport."
// The model only phrases the question text; this file decides which fields
// get asked about, and in what order — that decision never goes to a model.
const PRIORITY: Array<{ key: keyof Trip; question: string }> = [
  { key: "checkIn", question: "What date would you like to check in?" },
  { key: "nights", question: "How many nights will you be staying?" },
  { key: "guests", question: "How many guests in total?" },
  { key: "rooms", question: "How many rooms do you need?" },
  { key: "meals", question: "Would you like full board, half board, or room only?" },
  { key: "transport", question: "Do you need an airport transfer?" },
];

export function generateQuestions(trip: Trip): Array<{ field: keyof Trip; question: string }> {
  const questions: Array<{ field: keyof Trip; question: string }> = [];
  for (const { key, question } of PRIORITY) {
    const state = trip[key].state;
    if (state === "missing" || state === "default") {
      questions.push({ field: key, question });
    }
  }
  return questions;
}
