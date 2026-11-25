// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { listProducts, type Product } from "../api";

export function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    listProducts().then(setProducts);
  }, []);
  return (
    <main>
      <header>
        <h1>Shop</h1>
        <Link to="/cart">Cart</Link>
      </header>
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            <Link to={`/products/${product.id}`}>{product.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
