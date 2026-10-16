-- Who would lose a module now that every module checks its grant.
--
-- These modules used to open for anyone signed in. People listed here were
-- never granted them (directly or through a role) and aren't admins, so after
-- the deploy those modules disappear for them. Grant the ones they should keep
-- in Admin → Users first.
--
--   docker exec -i la-erp-postgres psql -U la_erp -d la_erp < scripts/module-access-check.sql
--   psql "${DATABASE_URL%%\?*}" -f scripts/module-access-check.sql

SELECT u.email,
       string_agg(m.slug, ', ' ORDER BY m.slug) AS loses_access_to
FROM "User" u
CROSS JOIN "Module" m
WHERE m.slug IN ('todo-personal', 'calendar', 'notes', 'file-upload', 'communication', 'feedback', 'flight-tracker')
  AND NOT EXISTS (SELECT 1 FROM "UserModule" um WHERE um."userId" = u.id AND um."moduleId" = m.id)
  AND NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "RoleModule" rm ON rm."roleId" = ur."roleId"
                  WHERE ur."userId" = u.id AND rm."moduleId" = m.id)
  AND NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
                  WHERE ur."userId" = u.id AND r.name = 'admin')
GROUP BY u.email
ORDER BY u.email;
