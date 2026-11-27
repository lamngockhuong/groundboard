---
type: llm
focus: { source: file, path: .groundboard/order-refunds.png }
weight: 3
---

Read this image as a product manager who never reads code: they know the order screens and the order statuses customers see, and nothing about how the code decides which status may follow which.
You have not seen the code or any document; you have only the image.
Using only the image, answer:
1. Until when can a customer cancel an order?
2. Can an order that is already packed be refunded right away? If not, what must happen first?
3. Why does the shop keep "cancelled" and "refunded" as two different statuses?

The answers the repository gives are: 1. only while the order is still pending (not yet paid); 2. no: a packed order must be shipped (and delivered) before it can be refunded; 3. because finance reports need to tell the two apart.
PASS if all three answers can be read off the image correctly by that reader, in words the image itself gives.
FAIL if any answer is missing from the image, is wrong, or needs a word or name the image uses without saying what it is.
