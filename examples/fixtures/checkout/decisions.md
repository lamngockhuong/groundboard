# Checkout decisions (synthetic fixture)

## Authorize before reserving stock

We authorize the card before reserving stock, so a declined card never holds
inventory that other customers could buy.

## Rejected: capture at order time

Capturing the payment immediately was rejected because refunds for out-of-stock
orders cost a fee on every transaction.

## Open question

Should guest checkout be allowed? Product has not decided.
