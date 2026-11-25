// Synthetic fixture for groundboard examples. Frozen: edit only together with the examples.

export interface CartLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Cart {
  id: string;
  customerId: string | null;
  lines: CartLine[];
}

export function cartTotalCents(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
}

export function assertCheckoutReady(cart: Cart): void {
  if (cart.lines.length === 0) {
    throw new Error("cart is empty");
  }
  if (cart.customerId === null) {
    throw new Error("guest carts must sign in before checkout");
  }
}
