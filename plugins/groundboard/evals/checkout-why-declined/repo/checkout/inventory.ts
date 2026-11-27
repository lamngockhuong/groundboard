// Synthetic fixture for groundboard examples. Frozen: edit only together with the examples.

import type { CartLine } from "./cart.ts";

const stock = new Map<string, number>();

/** Reserves every line or none of them. Returns false when any SKU is short. */
export async function reserveStock(lines: CartLine[]): Promise<boolean> {
  for (const line of lines) {
    if ((stock.get(line.sku) ?? 0) < line.quantity) {
      return false;
    }
  }
  for (const line of lines) {
    stock.set(line.sku, (stock.get(line.sku) ?? 0) - line.quantity);
  }
  return true;
}
