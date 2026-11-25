// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.

export interface Product {
  id: string;
  name: string;
  priceCents: number;
}

export interface OrderForm {
  name: string;
  email: string;
  card: string;
  acceptedTerms: boolean;
}

export async function listProducts(): Promise<Product[]> {
  const response = await fetch("/api/products");
  return response.json();
}

export async function addToCart(productId: string): Promise<void> {
  await fetch("/api/cart/lines", { method: "POST", body: JSON.stringify({ productId }) });
}

export async function placeOrder(form: OrderForm): Promise<{ orderId: string }> {
  if (!form.acceptedTerms) throw new Error("the terms must be accepted");
  const response = await fetch("/api/orders", { method: "POST", body: JSON.stringify(form) });
  return response.json();
}
