// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.

export interface Order {
  id: string;
  status: string;
}

export async function fetchOrder(orderId: string): Promise<Order> {
  const response = await fetch(`/api/orders/${orderId}`);
  if (!response.ok) throw new Error(`order ${orderId} could not be loaded`);
  return response.json();
}
