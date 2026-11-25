// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
import { createBrowserRouter, RouterProvider } from "react-router";
import { Cart } from "./screens/Cart";
import { Checkout } from "./screens/Checkout";
import { ProductDetail } from "./screens/ProductDetail";
import { ProductList } from "./screens/ProductList";

const router = createBrowserRouter([
  { path: "/", element: <ProductList /> },
  { path: "/products/:id", element: <ProductDetail /> },
  { path: "/cart", element: <Cart /> },
  { path: "/checkout", element: <Checkout /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
