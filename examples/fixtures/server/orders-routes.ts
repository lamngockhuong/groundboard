// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { Router } from "express";
import { requireCustomer } from "./auth";
import { db } from "./db";
import { gateway } from "./payment-gateway";
import { queue } from "./queue";

export const router = Router();

router.post("/orders", requireCustomer, async (req, res) => {
  const { authorized, authorizationId } = await gateway.authorize(req.body.total);
  if (!authorized) {
    return res.status(402).json({ error: "payment declined" });
  }
  const order = await db.insert("orders", { email: req.body.email, status: "placed" });
  for (const line of req.body.lines) {
    await db.insert("order_items", { order_id: order.id, product_id: line.productId });
  }
  await queue.add("send-receipt", { orderId: order.id });
  res.status(201).json({ orderId: order.id, authorizationId });
});

router.get("/orders/:id", async (req, res) => {
  const order = await db.findOne("orders", { id: req.params.id });
  res.json(order);
});

// Mounted under /api by the server: app.use("/api", router).
