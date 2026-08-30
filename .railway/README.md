# Railway configuration

This repository defines its Railway infrastructure in code:

```txt
.railway/railway.ts
```

The file describes the community-edition stack: the `control-plane` service
(build / start / healthcheck included), a `Postgres` database, and a
`wemux-object-storage` bucket. `DATABASE_URL` is wired to the database
automatically.

Install the Railway TypeScript SDK from the repository root before running the
commands below (it is already a devDependency, so `pnpm install` covers it):

```bash
pnpm install
```

## Common commands

Preview the changes the file would make against the linked project:

```bash
railway config plan
```

Apply them (creates or updates services, databases, and buckets):

```bash
railway config apply
```

Import the current state of a linked Railway project into the file:

```bash
railway config pull
```

`railway login` and `railway link` / `railway init` associate your checkout
with a Railway account and project. Deploy application code with `railway up`
(or connect a GitHub repository for automatic deploys).

## Notes

- Keep the whole environment in this single file; omitting a resource from the
  file deletes it on the next `railway config apply`.
- `railway.json` at the repository root is legacy Config-as-Code. Railway no
  longer reads it for new services, and existing services stop reading it on
  2026-12-01. Do not add new configuration there.
- Bucket regions cannot be changed after creation. Choose the region before
  the first apply.
