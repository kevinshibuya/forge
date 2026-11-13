# R15. Tenancy, auth and hosting

Research note for the forge v2 brief (research contract R15). Evidence gathered by a scout on
2026-09-24 from vendor pricing and docs pages; verdict and reading by the main session (fable).

## Verdict

For a one-developer, invite-only beta of about 20 Tenants: a shared schema with a mandatory `tenant_id`
column on every table plus Postgres row-level security as a backstop, on Supabase or Neon in São Paulo;
Better Auth self-hosted inside the NestJS api for email and Google sign-in, with platform connections in
forge's own table rather than as linked sign-in accounts; R2 or Tigris for objects; the api and worker on
Fly.io or Railway. Schema-per-tenant multiplies the hand-written migrations by N for no gain at this
size.

## Evidence

1. pgvector 0.8+ has iterative index scans (`hnsw.iterative_scan` strict or relaxed, capped by
   `hnsw.max_scan_tuples`) for filtered queries; the README points to partial indexes or partitioning
   for tenant filters and to B-tree plus exact search for selective conditions.
   [https://github.com/pgvector/pgvector, README 2026-09-24]
2. Drizzle supports RLS natively: `pgPolicy`, `pgRole` (including `.existing()`), `.withRLS()`; session
   context per transaction via `set_config(..., TRUE)` and `set local role`; Neon and Supabase helpers.
   forge's hand-written `.sql` migrations carry the policies. [https://orm.drizzle.team/docs/rls]
3. Supabase Pro $25/month with $10 compute credit (one Micro: 1 GB RAM, 200 pooler connections), 8 GB
   disk, 100 GB storage, 250 GB egress; daily backups kept 7 days; PITR $100/month; branches $0.01344
   per hour; region `sa-east-1` available. [https://supabase.com/pricing; /docs/guides/platform/regions]
4. Neon usage-billed, no minimum: Launch compute $0.106 per CU-hour, storage $0.35/GB-month, Instant
   Restore $0.20/GB-month, 10 branches, 500 GB transfer, scale to zero; `aws-sa-east-1` available.
   [https://neon.com/pricing; /docs/introduction/regions]
5. Railway Hobby $5, Pro $20 (credit equal to fee); ~$20 per vCPU-month, $10 per GB RAM-month,
   $0.15/GB volumes, $0.05/GB egress; regions not listed on the pricing page. [https://railway.com/pricing]
6. Fly.io shared-cpu-1x ~$3.31/month at 512 MB, ~$5.90 at 1 GB (base region); South America egress
   $0.04/GB; Managed Postgres priced separately. [https://docs.fly.io/about/pricing/]
7. Cloudflare R2 $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, free egress and deletes, 10 GB free.
   Tigris $0.02/GB-month, Class A $0.005/1k, Class B $0.0005/1k, zero egress, 5 GB free [vendor].
8. Better Auth: links several providers to one user (list, manual link, implicit link on verified
   email, unlink, trusted providers); does not encrypt OAuth tokens by default, docs say to encrypt in
   database hooks. [https://www.better-auth.com/docs/concepts/users-accounts]
9. Auth.js: "now part of Better Auth"; v5 guide still installs `next-auth@beta`. Lucia deprecated
   March 2025. Clerk Hobby free to 50k MRU, Pro $25 then $0.02 per MRU. WorkOS AuthKit free to 1M MAU.
10. AWS KMS $1 per key-month, $0.03 per 10k requests, 20k free; envelope encryption at this scale
    $1-2 a month. [https://aws.amazon.com/kms/pricing/]

## Reading

The brief's decision 24 (absolute isolation, whole deletion) is served by the `tenant_id` column with
composite FKs and cascades, and RLS makes a missing `WHERE tenant_id` a query that returns nothing
rather than a leak. The vector search question resolves itself at this size: per-Tenant corpora of a
few hundred rows are below the point where HNSW helps, so a B-tree on `(tenant_id, voice_id)` plus an
exact scan is both simpler and exact; HNSW with iterative scan is the path if a Tenant grows large.
Better Auth's implicit account linking is the one trap: LinkedIn and X connections must never enter its
`account` table or a platform OAuth becomes a sign-in method, which decision 13 forbids.

## Decision fed

- Tenancy ADR: shared schema, `tenant_id` everywhere, RLS on `current_setting('app.tenant_id')` set
  per transaction; deletion by cascade plus a storage prefix purge; exact vector scan per Voice.
- Auth ADR: Better Auth self-hosted for sign-in; `platform_connections` table for Connected accounts
  with envelope-encrypted tokens (AES-256-GCM, KEK in KMS or an env secret with a key version per row).
- Deploy slice: Postgres on Supabase Pro or Neon Launch in São Paulo; api and worker on Fly (`gru`,
  to confirm) or Railway; SPA on the same host or Vercel; objects on R2 with presigned URLs and one
  prefix per Tenant.

## Open items

- pgvector version on Supabase and Neon; Supabase Auth MAU quota; Crunchy Bridge, Render, Fly Managed
  Postgres prices; Fly `gru` availability; Railway regions.
- SSE idle timeouts on Fly, Railway, Render (plan a 15-30 s heartbeat regardless).
- Better Auth token-encryption option; Supabase Storage signed URLs; S3 egress.

## Confidence

Medium-high on prices and features (primary pages). Medium on the recommendations. Low on SSE
timeouts and the unverified hosts.
