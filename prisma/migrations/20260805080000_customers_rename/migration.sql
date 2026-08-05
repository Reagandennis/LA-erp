-- Rename the "Accounts" module to "Customers" in place so existing UserModule
-- assignments (keyed by moduleId) are preserved and the seed upsert matches the
-- new slug instead of creating a duplicate row.
UPDATE "public"."Module"
SET "slug" = 'customers',
    "name" = 'Customers'
WHERE "slug" = 'accounts';
