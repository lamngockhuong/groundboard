// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { Router } from "express";
import { db } from "./db";

export const router = Router();

router.get("/products", async (_req, res) => {
  const products = await db.findMany("products", { archived_at: null });
  res.json(products);
});

router.post("/cart/lines", async (req, res) => {
  const line = await db.insert("cart_lines", {
    cart_id: req.session.cartId,
    product_id: req.body.productId,
  });
  res.status(201).json(line);
});

// Mounted under /api by the server: app.use("/api", router).
