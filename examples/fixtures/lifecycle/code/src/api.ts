export async function createAccount(form: {
  displayName: string;
  email: string;
  password: string;
}) {
  await fetch("/api/accounts", { method: "POST", body: JSON.stringify(form) });
}

export async function verifyCode(code: string): Promise<boolean> {
  const response = await fetch("/api/verify", { method: "POST", body: JSON.stringify({ code }) });
  return response.ok;
}
