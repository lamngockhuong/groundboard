---
type: llm
focus: { source: file, path: .groundboard/checkout-declined.png }
weight: 3
---

Read this image as a developer who joined the team this week: they know TypeScript and how a card payment looks from the outside (the customer types a card, the shop charges it), and have not read this repository.
You have not seen the code or any document; you have only the image.
Using only the image, answer:
1. Why can a checkout be declined after the card was authorized?
2. Why does the shop authorize the card before it reserves the stock, and not the other way round?
3. At which point is the customer's money actually taken?

The answers the repository gives are: 1. a product in the cart is short of stock when the stock is reserved, so the authorization is voided and the checkout is declined "out of stock"; 2. so that a declined card never holds stock other customers could buy; 3. only after every line of the cart is reserved (the capture).
PASS if all three answers can be read off the image correctly by that reader, in words the image itself gives.
FAIL if any answer is missing from the image, is wrong, or needs a word or name the image uses without saying what it is.
