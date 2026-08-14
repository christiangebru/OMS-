process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-clothorders";
process.env.NODE_ENV = "test";
// Always use a dedicated test database so tests never touch dev/prod data.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ||
  "postgresql://oms:oms@127.0.0.1:5432/clothing_orders_test?schema=public";
