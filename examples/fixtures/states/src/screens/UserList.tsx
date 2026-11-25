// Synthetic fixture for screen states. Frozen: edit only together with the boards.
import { Link } from "react-router";

export function UserList() {
  return (
    <main>
      <h1>Users</h1>
      <Link to="/admin/users/upload">Upload users</Link>
    </main>
  );
}
