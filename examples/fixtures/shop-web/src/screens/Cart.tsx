// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { Link, useNavigate } from "react-router";

export function Cart() {
  const navigate = useNavigate();
  return (
    <main>
      <h1>Your cart</h1>
      <p>Total</p>
      <button type="button" onClick={() => navigate("/checkout")}>
        Checkout
      </button>
      <Link to="/">Continue shopping</Link>
    </main>
  );
}
