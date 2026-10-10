# Deployment

GitHub Actions builds and deploys this app over SSH to `viscon@02-direct.viscon-hackathon.ch`. The public URL is https://02.hackathon.ethz.ch. A shared Caddy gateway routes production and PR previews to their own Caddy web servers, which serve React and forward `/api` to FastAPI. Each environment has its own backend and PostgreSQL volume.

The organizers’ managed proxy terminates TLS and authenticates users before forwarding to **VM port 8080**. The existing router in `/home/viscon/router` owns that port. Its Caddy configuration serves the Polymaps AR build at `/ar/` and forwards every other path to `localhost:8081`.

This deployment owns only **127.0.0.1:8081**. Its Caddy gateway accepts plain HTTP there, routes `/pr/<number>/` to previews, and routes the remaining paths to production. Backend and database ports are private. Both proxy hops preserve `X-User-Id` and `X-User-Name`, which the backend trusts. The workflow does not replace or edit the shared router or the AR build.

```text
https://02.hackathon.ethz.ch
  organizers’ managed TLS/login proxy
    VM shared router: 0.0.0.0:8080
      /ar/*       → Polymaps AR
      other paths → 127.0.0.1:8081 (our Caddy gateway)
        /pr/N/*   → PR N web/API/database
        other     → production web/API/database
```

Keep these settings under **Access Details → Edit Network Configuration**:

- Server port: **8080**.
- Access control: **Authentication & authorization**.
- Ingress: the default managed reverse proxy.

The shared router binds port 8080 on all interfaces as the organizers require. Our port 8081 is loopback-only because the shared router runs with host networking and can reach it locally. No new firewall rule or VM TLS configuration is needed. Changing access control to Disabled removes the identity headers this backend requires; Custom ingress would require a different deployment setup.

## Configure GitHub once

In **Settings → Environments**, create `production` and `preview`. Add the following secret and variables to **both environments**, or add them once as repository Actions secrets/variables shared by both:

| Name | Type | Value |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | Secret | Complete private key, including BEGIN/END lines |
| `DEPLOY_KNOWN_HOSTS` | Variable | Verified VM known-hosts entry; see below |
| `DEPLOY_HOST` | Optional variable | Defaults to `02-direct.viscon-hackathon.ch` |
| `DEPLOY_USER` | Optional variable | Defaults to `viscon` |
| `DEPLOY_PORT` | Optional variable | Defaults to `22` |

Create a dedicated automation key locally, with an empty passphrase for unattended deployment:

```sh
ssh-keygen -t ed25519 -C github-actions-wurst -f ~/.ssh/viscon_actions -N ''
ssh-copy-id -i ~/.ssh/viscon_actions.pub viscon-2026
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/viscon_actions viscon-2026 'whoami && docker compose version'
```

Copy the full contents of `~/.ssh/viscon_actions` into `DEPLOY_SSH_KEY`. This is an **Actions secret**, not a repository **Deploy key**. The public key is installed on the VM; the private key is used by the runner. Never commit the private key.

Obtain the VM public host key over your existing trusted SSH connection:

```sh
ssh viscon-2026 'cat /etc/ssh/ssh_host_ed25519_key.pub'
ssh viscon-2026 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'
```

Set `DEPLOY_KNOWN_HOSTS` to one line with the hostname, key type, and returned base64 key; omit the trailing comment:

```text
02-direct.viscon-hackathon.ch ssh-ed25519 <returned-base64-public-host-key>
```

For a non-default SSH port, use `[hostname]:port` in this entry. The observed ED25519 fingerprint on 2026-10-10 was `SHA256:mmrwjUKy1lNAk/VRCciLI1rISAF1zmk17Tj+C8jB9+A`. Reconfirm it if the VM is rebuilt. The workflow never disables host-key checking or automatically accepts a new key.

See [GitHub environments and deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments) and [Actions secrets](https://docs.github.com/en/actions/concepts/security/secrets).

## First deployment

Commit the workflow and deployment files on a test branch and push it to run CI first. Pushes to any branch run lint, tests, image builds, and the deployment integration test without deployment credentials. Push deployment is skipped outside `main`. PRs targeting `main` additionally deploy a preview after checks pass.

Push and manual runs remain enabled under GitHub’s repository write controls. For PRs, the authorization job checks actual repository permissions through the [GitHub permissions API](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user): the PR author must have **write, maintain, or admin** access. PR branches must also belong to this repository. Public PR authors and all fork PRs skip checks and deployment; a previous contribution alone grants no access. This uses `pull_request`, with no `pull_request_target` execution of external code. Read/triage collaborators are not authorized to deploy.

Once checks pass, merge into `main`: successful `main` runs pass the exact tested image archive to the SSH deployment job. You can also run **Actions → Deploy → Run workflow** on `main` after the workflow exists on the default branch.

The existing router must continue serving `/ar/` and forwarding other paths to `localhost:8081`. Port 8081 must be free for the first app deployment. The deployment script refuses to replace an unrelated container occupying its port. The router on 8080 stays running; there is no special first-deployment flag.

The script automatically creates `/home/viscon/wurst/` and a random database password in `shared/production.env`, mode 0600. No database secret in GitHub or passwordless sudo is needed. Both SSH access and permission to run Docker are required; Docker, Compose, Python 3, OpenSSL, curl, and flock are already available on the tested VM.

The workflow validates the frontend/backend, builds digest-pinned production images, tests deployment locally on the runner, and uploads checksummed image archives plus scripts. No registry credentials or source checkout are needed on the VM. Production backend builds omit development dependencies; local backend builds retain them.

The server script serializes deployments with flock, loads the images, validates Caddy, starts PostgreSQL, saves and validates a logical backup, then runs Alembic as a one-off container and imports campus-map data if the database has none. It starts the backend and tests the candidate Caddy on loopback port 18080 before switching the environment’s web server behind the gateway. It verifies readiness, SPA routes, authentication behavior, and identity header forwarding before updating the successful-release pointer. Expect a brief interruption while the backend is replaced.

At the public URL, log in and check Profile shows your actual identity. Save a name/photo and reload; check another account receives a separate profile. A response from the portal's login page is not an authenticated application check. Confirm external access to the direct hostname on 8080 remains blocked, including with forged identity headers. Study-space/booking screens currently still use mocked frontend data.

## PR previews

Open a PR to `main` from a branch in this repository using an account with write access. After checks and deployment succeed, the workflow creates or updates one bot comment linking to:

```text
https://02.hackathon.ethz.ch/pr/<PR-number>/
```

The URL uses the same managed login as production; it works without another domain, certificate, firewall rule, or organizer setting. Only the preview/comment jobs request `pull-requests: write`. If repository or organization settings prevent Actions from writing PR comments, enable that permission for Actions.

Pushing new commits updates the preview and its existing comment. Its database persists across updates and stays separate from production and other PRs. The frontend builds with the PR base path, so assets, React Router navigation, and generated API calls stay under `/pr/<number>/`. Mock booking local-storage keys also have a PR prefix. Profile photos are returned as embedded data URLs, so they also work under the preview path.

Closing or merging the PR removes its route, containers, private networks, PostgreSQL volume, releases, and backups, then marks the comment as removed. This intentionally deletes that preview’s data. Production, other previews, and the shared `/ar/` router remain running. The workflow checks that a PR is still open and at the expected commit before deploying, so a run delayed by checks cannot recreate an already closed preview.

The shared router must be running for public URLs. A preview can run before the first production deployment; the production root will return an upstream error until production exists. Previews share the production browser origin and gateway network, so deploy only trusted collaborators’ code. Separate databases provide data separation, not a security sandbox for arbitrary code.

## Subsequent deployments and logs

Push to `main`, or run the workflow manually on `main`. GitHub concurrency allows one active production deployment and does not cancel it mid-flight. Each run has its own release directory, while Compose project `wurst-production` and volume `wurst-production-postgres` stay constant. Gateway project `wurst-gateway` owns loopback port 8081; the independently managed `router` project keeps port 8080 and `/ar/`. The backend and database have no host port bindings. A shared VM lock serializes production, preview deployment, and preview cleanup.

Check readiness from the VM:

```sh
ssh viscon-2026 'curl -fsS http://127.0.0.1:8081/api/v1/ready'
```

Inspect production status and logs:

```sh
ssh viscon-2026
cd ~/wurst/current
IMAGE_TAG=$(cat SHA) docker compose -p wurst-production --env-file /home/viscon/wurst/shared/production.env -f compose.yaml ps
IMAGE_TAG=$(cat SHA) docker compose -p wurst-production --env-file /home/viscon/wurst/shared/production.env -f compose.yaml logs --tail 100 backend caddy
```

VM layout:

```text
~/wurst/
  current -> releases/<successful-sha-run-attempt>/
  releases/<sha-run-attempt>/  # SHA, Compose, scripts, checksums
  shared/production.env       # database password; outside releases
  shared/deploy.lock
  shared/gateway/Caddyfile
  shared/gateway/previews/pr-<number>.caddy
  backups/<timestamp-release>.dump
  previews/pr-<number>/
    current -> releases/<successful-sha-run-attempt>/
    releases/<sha-run-attempt>/
    shared/production.env     # this PR’s independent database password
    backups/<timestamp-release>.dump
  actions/cleanup-<run-attempt>/
```

Successful releases delete their transferred image archive; loaded images and release metadata remain for rollback. Failed runs retain their archive for diagnosis. Docker logs are bounded. Release directories, images, and backups otherwise remain until explicitly cleaned up: retain at least three successful releases and their images, and never remove the current or rollback release. Do not use blanket volume pruning or `docker compose down -v`.

Backups contain profile data and use restrictive permissions. Copy them off the VM and establish a retention policy; backups on the VM alone do not protect against VM loss. This workflow backs up before migrations; it does not install a separate scheduled backup service or automatically restore backups.

Seed demo rooms explicitly once if needed, never on every deployment:

```sh
cd ~/wurst/current
IMAGE_TAG=$(cat SHA) docker compose -p wurst-production --env-file /home/viscon/wurst/shared/production.env -f compose.yaml exec backend python -m app.features.reservations.seed
```

## Rollback

If application startup or smoke checks fail, the script attempts to restore the previous successful backend/Caddy images and verifies them. If the first deployment fails, its application containers are stopped while the database and backup remain. The successful-release pointer is not advanced after a failed deployment.

A migration failure stops deployment before application replacement. Application rollback retains the database and **does not undo migrations**. Keep migrations compatible with the previous application version. For incompatible or partially applied schema changes, use a reviewed repair or restore procedure; automatic downgrades or restoring a backup could discard new writes.

For a manual application rollback, choose an existing successful release directory, run Compose there with its SHA and the stable project/environment, and run its smoke script. Do not rerun a historical migration or delete the volume:

```sh
cd /home/viscon/wurst/releases/<previous-successful-release>
IMAGE_TAG=$(cat SHA) docker compose -p wurst-production --env-file /home/viscon/wurst/shared/production.env -f compose.yaml up -d --wait backend caddy
bash smoke.sh http://127.0.0.1:8081
```

After verifying recovery, point `~/wurst/current` at that release so the next deployment knows the correct rollback target. If rollback itself fails, inspect logs and the schema before retrying.

## Local deployment test

The integration test exercises real image loading, initial migration, updates, profile persistence, valid backup generation, port-conflict refusal, and rollback from deliberately broken Caddy responses. It also deploys a PR preview through the shared gateway, checks prefixed assets and API routing through a simulated shared `/ar/` router, verifies independent profile data, and tests repeated cleanup while production remains healthy. It uses unique Compose projects/volumes and gateway network, loopback ports 18081/18082/18083, and temporary directories, and removes its test containers and volume afterward. It never connects to the organizer VM or development database.

```sh
sha=$(git rev-parse HEAD)
docker build --platform linux/amd64 --build-arg INSTALL_DEV=false -f backend/Dockerfile -t "wurst-backend:$sha" .
docker build --platform linux/amd64 -f frontend/Dockerfile -t "wurst-web:$sha" .
bash deploy/tests/integration.sh "$sha"
```

The workflow runs this integration test before uploading anything. Frontend validation is `npm run lint`, `npm run typecheck`, and `npm run build`. Backend validation uses Ruff and pytest with a disposable PostgreSQL 17 database. Shell syntax, workflow syntax, and production Compose configuration can also be checked with:

```sh
bash -n deploy/*.sh deploy/tests/*.sh
node --test .github/scripts/*.test.mjs
actionlint .github/workflows/deploy.yml
POSTGRES_PASSWORD=local_validation_only IMAGE_TAG=$(git rev-parse HEAD) docker compose -f deploy/compose.yaml config --quiet
```
