import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { createAccount } from "../api";

const MIN_PASSWORD_LENGTH = 10;

export function SignUp() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });

  async function onSubmit() {
    if (form.password.length < MIN_PASSWORD_LENGTH) return;
    await createAccount(form);
    navigate("/verify-email");
  }

  return (
    <main>
      <h1>Create your account</h1>
      <form onSubmit={onSubmit}>
        <input
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <button type="submit">Create account</button>
      </form>
      <Link to="/signin">Sign in</Link>
    </main>
  );
}
