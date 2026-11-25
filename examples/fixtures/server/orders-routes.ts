// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { Router } from "express";
import { db } from "./db";
import { queue } from "./queue";

export const router = Router();

router.post("/orders", async (req, res) => {
  const order = await db.insert("orders", { email: req.body.email, status: "placed" });
  await queue.add("send-receipt", { orderId: order.id });
  res.status(201).json({ orderId: order.id });
});

router.get("/orders/:id", async (req, res) => {
  const order = await db.findOne("orders", { id: req.params.id });
  res.json(order);
});

// Mounted under /api by the server: app.use("/api", router).
