// Synthetic fixture for screen states. Frozen: edit only together with the boards.
import { createBrowserRouter, RouterProvider } from "react-router";
import { UserList } from "./screens/UserList";
import { UserUpload } from "./screens/UserUpload";

const router = createBrowserRouter([
  { path: "/admin/users", element: <UserList /> },
  { path: "/admin/users/upload", element: <UserUpload /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
