// The route table, in registration order. Hono matches routes in the order they were added, so a refactor of how
// app.ts wires its routes must leave this list exactly as it was.
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.ts";

describe("the route table", () => {
  it("is the same list, in the same order", async () => {
    const table = createApp().routes.map((r) => `${r.method} ${r.path}`).join("\n") + "\n";
    await expect(table).toMatchFileSnapshot("./__snapshots__/route-table.txt");
  });
});
