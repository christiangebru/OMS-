import jwt from "jsonwebtoken";

const JWT_SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export function signToken(payload, expiresIn = "7d") {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET());
}
