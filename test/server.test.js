import test from "node:test";
import assert from "node:assert/strict";
import { dispatchApi, startServer } from "../src/server.js";

test("desktop API dispatch works without an HTTP listener", async () => {
  const seedResponse = await dispatchApi({
    method: "POST",
    pathname: "/api/seed/new",
  });
  assert.equal(seedResponse.ok, true);
  assert.match(seedResponse.payload.seed, /^\d+$/u);

  const missingResponse = await dispatchApi({
    method: "GET",
    pathname: "/api/not-available",
  });
  assert.equal(missingResponse.ok, false);
  assert.equal(missingResponse.status, 404);
});

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
