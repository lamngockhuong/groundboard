// Synthetic fixture for the groundboard lifecycle: the code written after the spec stage.
// Frozen: edit only together with the boards in ../.groundboard.
import { createBrowserRouter, RouterProvider } from "react-router";
import { SignIn } from "./screens/SignIn";
import { SignUp } from "./screens/SignUp";
import { VerifyEmail } from "./screens/VerifyEmail";
import { Welcome } from "./screens/Welcome";

const router = createBrowserRouter([
  { path: "/signup", element: <SignUp /> },
  { path: "/verify-email", element: <VerifyEmail /> },
  { path: "/welcome", element: <Welcome /> },
  { path: "/signin", element: <SignIn /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
