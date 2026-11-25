// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { useNavigate, useParams } from "react-router";
import { addToCart } from "../api";

export function ProductDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const onAdd = async () => {
    await addToCart(id);
    navigate("/cart");
  };
  return (
    <main>
      <img src={`/images/${id}.png`} alt="Product" />
      <h1>Product</h1>
      <button type="button" onClick={onAdd}>
        Add to cart
      </button>
    </main>
  );
}
