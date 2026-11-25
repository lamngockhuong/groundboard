// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.

export interface CartLine {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export function lineTotalCents(line: CartLine): number {
  return line.quantity * line.unitPriceCents;
}

export async function submitOrder(lines: CartLine[]): Promise<{ orderId: string }> {
  if (lines.length === 0) throw new Error("cart is empty");
  const response = await fetch("/api/orders", { method: "POST", body: JSON.stringify({ lines }) });
  return response.json();
}
