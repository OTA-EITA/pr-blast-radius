-- Example only: used by the demo pull request in this repository.
CREATE TABLE users (
  id bigint PRIMARY KEY,
  email text NOT NULL,
  legacy_id text
);
