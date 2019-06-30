/*
 * NOTE: BIGSERIAL / BIGINTEGER (64-bit integer) will be returned as
 * string from database to JavaScript code, as JavaScript currently
 * only supports 2^53 integers.
 */

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL UNIQUE,
  "passhash" TEXT,
  "firstName" TEXT,
  "lastName" TEXT, 
  "language" TEXT,
  "avatar" TEXT,
  CONSTRAINT id_check CHECK (char_length(id) = 36)
);

CREATE TABLE IF NOT EXISTS "connections" (
  "index" BIGSERIAL,
  "user" TEXT REFERENCES users(id) ON DELETE CASCADE,
  "friend" TEXT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY ("user", "friend")
);

CREATE TABLE IF NOT EXISTS "blocked" (
  "index" BIGSERIAL,
  "user" TEXT REFERENCES users(id) ON DELETE CASCADE,
  "blocked" TEXT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY ("user", "blocked")
);

CREATE TABLE IF NOT EXISTS "postcards" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "sender" TEXT REFERENCES users(id) ON DELETE SET NULL,
  "receiver" TEXT REFERENCES users(id) ON DELETE SET NULL,
  "image" TEXT,
  "message" TEXT,
  "location" TEXT,
  "created" TIMESTAMPTZ DEFAULT now(),
  "read" TIMESTAMPTZ,
  CONSTRAINT id_check CHECK (char_length(id) = 36)
);

CREATE TABLE IF NOT EXISTS "inbox" (
  "index" BIGSERIAL PRIMARY KEY,
  "user" TEXT REFERENCES users(id) ON DELETE CASCADE,
  "postcard" TEXT REFERENCES postcards(id) ON DELETE CASCADE,
  UNIQUE ("user", "postcard")
);

CREATE TABLE IF NOT EXISTS "sent" (
  "index" BIGSERIAL PRIMARY KEY,
  "user" TEXT REFERENCES users(id) ON DELETE CASCADE,
  "postcard" TEXT REFERENCES postcards(id) ON DELETE CASCADE,
  UNIQUE ("user", "postcard")
);

CREATE TABLE IF NOT EXISTS "invites" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user" TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  "created" TIMESTAMP DEFAULT now(),
  CONSTRAINT id_check CHECK (char_length(id) = 36)
);

CREATE TABLE IF NOT EXISTS "ignored" (
  "hash" TEXT PRIMARY KEY
);
