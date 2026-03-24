alter table public.organization_settings
add column if not exists role_permissions jsonb;

update public.organization_settings
set role_permissions = coalesce(
  role_permissions,
  '{
    "admin": {
      "projects": true,
      "boq": true,
      "contractors": true,
      "foreman": true,
      "billing": true,
      "reports": true,
      "settings": true
    },
    "pm": {
      "projects": true,
      "boq": true,
      "contractors": true,
      "foreman": false,
      "billing": true,
      "reports": true,
      "settings": false
    },
    "foreman": {
      "projects": true,
      "boq": true,
      "contractors": false,
      "foreman": true,
      "billing": false,
      "reports": false,
      "settings": false
    }
  }'::jsonb
)
where role_permissions is null;
