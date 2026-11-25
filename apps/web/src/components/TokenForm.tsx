import { type FormEvent, useId, useState } from "react";
import { t } from "../i18n.ts";

interface TokenFormProps {
  rejected: boolean;
  onSubmit: (token: string) => void;
  onCancel: () => void;
}

/** Asks for the server's bearer token after a 401. */
export function TokenForm({ rejected, onSubmit, onCancel }: TokenFormProps) {
  const [token, setToken] = useState("");
  const inputId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = token.trim();
    if (value) onSubmit(value);
  };

  return (
    <form className="token-form" onSubmit={handleSubmit}>
      <label htmlFor={inputId}>{rejected ? t("token.rejected") : t("token.required")}</label>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        value={token}
        onChange={(event) => setToken(event.currentTarget.value)}
      />
      <button type="submit" disabled={token.trim() === ""}>
        {t("token.continue")}
      </button>
      <button type="button" className="secondary" onClick={onCancel}>
        {t("common.cancel")}
      </button>
    </form>
  );
}
