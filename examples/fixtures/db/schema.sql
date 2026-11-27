-- Synthetic fixture for the groundboard screen atlas. Frozen: edit only together with the boards.
CREATE TABLE orders (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'placed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders (id),
  product_id text NOT NULL,
  quantity integer NOT NULL
);

CREATE TABLE products (
  id text PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  price_cents integer NOT NULL,
  archived_at timestamptz -- NULL while the product is on sale
);

CREATE TABLE cart_lines (
  id uuid PRIMARY KEY,
  cart_id uuid NOT NULL,
  product_id text NOT NULL REFERENCES products (id),
  quantity integer NOT NULL DEFAULT 1
);
