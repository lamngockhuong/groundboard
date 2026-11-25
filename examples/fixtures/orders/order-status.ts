// Synthetic fixture for groundboard examples. Frozen: edit only together with the examples.

export type OrderStatus =
  | "pending"
  | "paid"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["packed", "refunded"],
  packed: ["shipped"],
  shipped: ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

export function transition(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) {
    throw new Error(`illegal transition ${from} -> ${to}`);
  }
  return to;
}
