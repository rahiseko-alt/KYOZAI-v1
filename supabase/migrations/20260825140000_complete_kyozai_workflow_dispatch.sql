-- Keep the enum change separate from the function that uses it. PostgreSQL does
-- not allow a newly-added enum value to be used until the surrounding migration
-- transaction commits.
alter type public.kyozai_dispatch_status add value if not exists 'completed';
