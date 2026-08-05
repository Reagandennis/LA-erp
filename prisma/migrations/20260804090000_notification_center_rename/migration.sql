-- Rename the "Upcoming Due Dates" module to "Notification Center" in place so
-- existing UserModule assignments (keyed by moduleId) are preserved and the
-- seed upsert matches the new slug instead of creating a duplicate row.
UPDATE "public"."Module"
SET "slug" = 'notification-center',
    "name" = 'Notification Center'
WHERE "slug" = 'upcoming-due-dates';
