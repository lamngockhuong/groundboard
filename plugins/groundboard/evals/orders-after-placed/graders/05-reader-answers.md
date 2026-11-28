---
type: llm
focus: { source: file, path: .groundboard/after-order-placed.png }
weight: 3
---

Read this image as a developer new to the project: they know Express and job queues in general, and have not read this repository.
You have not seen the code or any document; you have only the image.
Using only the image, answer:
1. What does the customer receive right after placing an order, and what sends it: the request itself or something else?
2. What happens when sending it fails?
3. What happens to an order that is still only placed at night?

The answers the repository gives are: 1. a receipt email, sent by a background job (`send-receipt`) the request enqueues, not by the request; the request itself answers 201 with the order id; 2. the job is retried, up to 3 attempts with growing (exponential) delays; 3. every night at 02:00 a scheduled job closes every order still in status placed.
PASS if all three answers can be read off the image correctly by that reader, in words the image itself gives.
FAIL if any answer is missing from the image, is wrong, or needs a word or name the image uses without saying what it is.
