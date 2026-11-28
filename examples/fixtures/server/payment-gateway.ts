// Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
// The client of the bank's card payment API. The fixture is never run, so it sends no request.
import { BankClient } from "@example/bank-sdk";

export const gateway = new BankClient({ baseUrl: process.env.BANK_API_URL });
