import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __resetDbForTests, getDb } from "@/lib/db/client";
import { createRow, getCurrentUserId, setCurrentUserId } from "@/lib/db/mutations";
import { LOCAL_USER_ID } from "@/lib/db/schema";
import { adoptLocalRows, adoptSignedInUser } from "@/lib/sync/adopt";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";

async function seedLocalTodo(title: string) {
  return createRow("todos", {
    title,
    notes: null,
    category_id: null,
    place_id: null,
    priority: 4,
    tags: [],
    due_date: null,
    estimated_pomodoro: 1,
    parent_id: null,
    blocked_by: [],
    status: "inbox",
    completed_at: null,
    focus_week: null,
    sort_order: 0,
  });
}

beforeEach(async () => {
  setCurrentUserId(LOCAL_USER_ID);
  const db = getDb();
  await db.delete();
  __resetDbForTests();
  await getDb().open();
});

afterEach(() => {
  setCurrentUserId(LOCAL_USER_ID);
});

describe("adopting rows written before the first sign-in", () => {
  it("re-stamps the sentinel owner and queues each row for the push", async () => {
    const db = getDb();
    const todo = await seedLocalTodo("Tulis brief");
    expect(todo.user_id).toBe(LOCAL_USER_ID);

    await db.outbox.clear(); // ignore the create entry; only the adoption matters
    const adopted = await adoptLocalRows(ACCOUNT);

    expect(adopted).toBeGreaterThan(0);
    expect((await db.todos.get(todo.id))!.user_id).toBe(ACCOUNT);

    const queued = await db.outbox.toArray();
    expect(queued.some((entry) => entry.entity_id === todo.id)).toBe(true);
  });

  it("leaves updated_at alone, so last-write-wins still reflects the edit", async () => {
    const db = getDb();
    const todo = await seedLocalTodo("Jangan ubah waktunya");

    await adoptLocalRows(ACCOUNT);

    expect((await db.todos.get(todo.id))!.updated_at).toBe(todo.updated_at);
  });

  it("marks the adopted row dirty so a pull cannot silently overwrite it", async () => {
    const db = getDb();
    const todo = await seedLocalTodo("Masih milik saya");
    await db.todos.update(todo.id, { dirty: 0 });

    await adoptLocalRows(ACCOUNT);

    expect((await db.todos.get(todo.id))!.dirty).toBe(1);
  });

  it("is idempotent — a second sign-in queues nothing", async () => {
    const db = getDb();
    await seedLocalTodo("Sekali saja");

    await adoptSignedInUser(ACCOUNT);
    await db.outbox.clear();

    expect(await adoptSignedInUser(ACCOUNT)).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("refuses to hand this device's data to a different account", async () => {
    const db = getDb();
    const todo = await seedLocalTodo("Milik akun pertama");
    await adoptSignedInUser(ACCOUNT);

    expect(await adoptSignedInUser(OTHER_ACCOUNT)).toBe(0);
    expect((await db.todos.get(todo.id))!.user_id).toBe(ACCOUNT);
    // The new account still owns anything created from here on.
    expect(getCurrentUserId()).toBe(OTHER_ACCOUNT);
  });
});
