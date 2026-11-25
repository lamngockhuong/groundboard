import { useState } from "react";
import { useNavigate } from "react-router";
import { verifyCode } from "../api";

export function VerifyEmail() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  async function onVerify() {
    if (await verifyCode(code)) navigate("/welcome");
  }

  return (
    <main>
      <h1>Verify email</h1>
      <input
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button type="button" onClick={onVerify}>
        Verify
      </button>
    </main>
  );
}
