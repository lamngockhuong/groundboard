// The hero board: choosing a step shows what it cites, as the viewer's source panel does.
// The quotes are those of the example shop app's "Place order" board.
const SOURCES = {
  "on-pay": {
    path: "shop-web/src/screens/Checkout.tsx:11-12",
    quote: "const onPay = async () => { await placeOrder(form);",
    state: "ok",
    note: "Quote matches the file",
  },
  guard: {
    path: "shop-web/src/api.ts:26",
    quote: 'if (!form.acceptedTerms) throw new Error("the terms must be accepted");',
    state: "ok",
    note: "Quote matches the file",
  },
  post: {
    path: "shop-web/src/api.ts:27",
    quote: 'fetch("/api/orders", { method: "POST", body: JSON.stringify(form) })',
    state: "ok",
    note: "Quote matches the file",
  },
  open: {
    path: "No source yet",
    quote: "The board asks the Frontend team: no line of the code answers it yet.",
    state: "open",
    note: "Open question for the Frontend team",
  },
};

const buttons = document.querySelectorAll(".steps button");
const path = document.getElementById("source-path");
const quote = document.querySelector("#source-quote code");
const state = document.getElementById("source-state");

for (const button of buttons) {
  button.addEventListener("click", () => {
    const source = SOURCES[button.dataset.source];
    if (!source) return;
    for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
    path.textContent = source.path;
    quote.textContent = source.quote;
    state.replaceChildren();
    const dot = document.createElement("span");
    dot.className = `dot ${source.state}`;
    dot.setAttribute("aria-hidden", "true");
    state.append(dot, source.note);
  });
}
