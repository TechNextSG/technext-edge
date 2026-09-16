import { handle } from "hono/vercel";
import { createApp } from "../src/app.js";

export const runtime = "nodejs"; // Playbook: Node runtime so the Postgres driver and any SDK needing it work normally.

const app = createApp();

export const GET = handle(app);
export const POST = handle(app);
