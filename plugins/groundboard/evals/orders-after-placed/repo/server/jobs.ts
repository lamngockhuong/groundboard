// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { db } from "./db";
import { mail } from "./mail";
import { schedule, worker } from "./queue";

worker(
  "send-receipt",
  async (job) => {
    const order = await db.findOne("orders", { id: job.data.orderId });
    await mail.send(order.email, "receipt", { orderId: order.id });
  },
  { attempts: 3, backoff: "exponential" },
);

schedule("0 2 * * *", "close-stale-orders", async () => {
  await db.update("orders", { status: "placed" }, { status: "closed" });
});
