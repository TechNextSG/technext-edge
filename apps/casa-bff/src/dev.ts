import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`casa-bff dev server on http://localhost:${info.port}`);
  console.log(`try: curl -s localhost:${info.port}/v1/extract -H 'content-type: application/json' -d '{"text":"4 of us, next Saturday, 3 nights"}'`);
});
