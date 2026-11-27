---
type: llm
focus: { source: file, path: .groundboard/signup-flow.png }
weight: 3
---

Read this image as the client who wrote the signup brief: they do not read code, know their own brief and the words in it, and want to check the flow before it is built.
You have not seen the code or any document; you have only the image.
Using only the image, answer:
1. Which screens does a visitor go through, in which order?
2. What must the visitor type to get past the Verify email screen, and where does it come from?
3. How long must the password be at least?

The answers the repository gives are: 1. Sign up, then Verify email, then Welcome; 2. the six-digit code that was sent to the email address they gave; 3. at least 12 characters.
PASS if all three answers can be read off the image correctly by that reader, in words the image itself gives.
FAIL if any answer is missing from the image, is wrong, or needs a word or name the image uses without saying what it is.
