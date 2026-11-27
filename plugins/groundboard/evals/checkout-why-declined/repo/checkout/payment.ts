// Synthetic fixture for groundboard examples. Frozen: edit only together with the examples.

import { assertCheckoutReady, type Cart, cartTotalCents } from "./cart.ts";
import { reserveStock } from "./inventory.ts";

export type PaymentResult =
  | { status: "captured"; paymentId: string }
  | { status: "declined"; reason: string };

export interface PaymentGateway {
  authorize(amountCents: number, customerId: string): Promise<string>;
  capture(authorizationId: string): Promise<string>;
  void(authorizationId: string): Promise<void>;
}

export async function checkout(cart: Cart, gateway: PaymentGateway): Promise<PaymentResult> {
  assertCheckoutReady(cart);
  const amount = cartTotalCents(cart);
  // Authorize first: stock is reserved only once the card is known to be good.
  const authorizationId = await gateway.authorize(amount, cart.customerId as string);
  const reserved = await reserveStock(cart.lines);
  if (!reserved) {
    await gateway.void(authorizationId);
    return { status: "declined", reason: "out of stock" };
  }
  const paymentId = await gateway.capture(authorizationId);
  return { status: "captured", paymentId };
}
