import { bucket, defineRailway, postgres, project, service } from "railway/iac";

// Railway Infrastructure as Code.
//
// Railway deprecated Config-as-Code (`railway.json` / `railway.toml`): new
// services no longer read those files, and existing services stop reading
// them on 2026-12-01. This file is the supported replacement for new
// Railway deployments of the community edition. The repository keeps
// `railway.json` at the root only for pre-existing (legacy) services.
//
// Provision the full stack (Postgres + object-storage Bucket + control plane
// with build/start/healthcheck preconfigured):
//
//   railway login
//   railway init          # or `railway link` to use an existing project
//   railway config apply  # creates the resources below
//   railway up            # deploy the current checkout
//
// Then set the remaining variables listed in docs/SELF-HOSTING.md
// (BETTER_AUTH_SECRET, TOKEN_SECRET, SECRET_ENCRYPTION_KEY,
// OBJECT_STORAGE_* from `railway bucket credentials`, and the public URLs).
export default defineRailway(() => {
  const db = postgres("Postgres");
  // Bucket regions cannot be changed after creation; pick the region closest
  // to your users before the first apply.
  const storage = bucket("wemux-object-storage", { region: "sjc" });

  const controlPlane = service("control-plane", {
    build: "pnpm build:client && pnpm build:server && pnpm build:worker:preview-installer",
    start: "NODE_ENV=production node dist-server/apps/server/src/control-plane-entry.js",
    healthcheck: "/api/ready",
    healthcheckTimeout: 100,
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
    },
  });

  return project("wemux-community", {
    resources: [controlPlane, db, storage],
  });
});
