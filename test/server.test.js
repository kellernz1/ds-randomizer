import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.js";

test("new-seed endpoint never reuses a cached seed", async (context) => {
  const { server, url } = await startServer();
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const firstResponse = await fetch(`${url}/api/seed/new`, { method: "POST" });
  const secondResponse = await fetch(`${url}/api/seed/new`, { method: "POST" });
  const first = await firstResponse.json();
  const second = await secondResponse.json();

  assert.match(first.seed, /^\d+$/u);
  assert.match(second.seed, /^\d+$/u);
  assert.notEqual(first.seed, second.seed);
  assert.match(firstResponse.headers.get("cache-control"), /no-store/u);
});
