// The shape of a conversation, shared by converse() and the synthesis step. It lives in domain/ so the
// two application modules can both read it without importing each other.

export interface ConversationTurn {
  role: "guest" | "assistant";
  text: string;
}

export type ConversationChannel = "web" | "email" | "whatsapp";
