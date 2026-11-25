// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { type OrderForm, placeOrder } from "../api";

const empty: OrderForm = { name: "", email: "", card: "", acceptedTerms: false };

export function Checkout() {
  const [form, setForm] = useState<OrderForm>(empty);
  const navigate = useNavigate();
  const onPay = async () => {
    await placeOrder(form);
    navigate("/");
  };
  return (
    <main>
      <h1>Checkout</h1>
      <form>
        <input
          aria-label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          aria-label="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          aria-label="Card number"
          value={form.card}
          onChange={(e) => setForm({ ...form, card: e.target.value })}
        />
        <label>
          <input
            type="checkbox"
            checked={form.acceptedTerms}
            onChange={(e) => setForm({ ...form, acceptedTerms: e.target.checked })}
          />
          I accept the terms
        </label>
        <button type="button" onClick={onPay}>
          Pay
        </button>
      </form>
      <Link to="/cart">Back to cart</Link>
    </main>
  );
}
