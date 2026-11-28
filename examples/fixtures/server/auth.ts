// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import type { NextFunction, Request, Response } from "express";
import { sessions } from "./sessions";

/** Lets the request through only when it carries the session of a signed-in customer. */
export async function requireCustomer(req: Request, res: Response, next: NextFunction) {
  const session = await sessions.find(req.cookies.session);
  if (!session?.customerId) return res.status(401).json({ error: "sign in first" });
  next();
}
