-- Run once on an existing database before starting the admin user-management feature.
ALTER TABLE users ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0;