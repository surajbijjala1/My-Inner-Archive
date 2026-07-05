import type { Request } from "express";

/** A single chat turn as exchanged with the frontend and stored in chat_messages. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Result of AI mood scoring: 1-10 score plus a label from the synonym vocabulary. */
export interface MoodData {
  score: number;
  label: string;
}

/** JWT payload attached to authenticated requests. */
export interface AuthUser {
  username: string;
}

/** Express request after passing the JWT auth middleware. */
export interface AuthedRequest extends Request {
  user?: AuthUser;
}
