// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { db } from "./db";
import { on, task } from "./queue";
import { supplier } from "./supplier";

on(
  "order.paid",
  "prepare-shipment",
  async (event) => {
    const items = await db.findMany("order_items", { order_id: event.orderId });
    if (items.length === 0) throw new Error("a paid order has no items");
    await db.update("orders", { id: event.orderId }, { status: "packed" });
  },
  { timeout: "30s" },
);

// Run by hand from the admin console after the supplier publishes a new price list.
task(
  "sync-catalog",
  async () => {
    const catalog = await supplier.fetchCatalog();
    await db.upsert("products", catalog);
  },
  { timeout: "5m", attempts: 1 },
);
