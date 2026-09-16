// Deployment entry point lives at the monorepo root, not inside apps/casa-bff,
// so `vercel deploy` (run from root) uploads the whole workspace — including
// packages/extractor — instead of just the apps/casa-bff subtree.
import { handle } from "hono/vercel";
import { createApp } from "../apps/casa-bff/src/app.js";

export const runtime = "nodejs";

const app = createApp();

export const GET = handle(app);
export const POST = handle(app);
