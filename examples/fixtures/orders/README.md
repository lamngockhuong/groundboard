# Orders (synthetic fixture)

An order can be cancelled only while it is still pending. Once paid, the only
way back is a refund.

Packed orders cannot be refunded directly: the warehouse must ship or restock
them first, so a refund never races a parcel that is already labelled.

We considered a single `closed` status for cancelled and refunded orders and
rejected it, because finance reports need to tell the two apart.
