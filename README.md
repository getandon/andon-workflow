# Andon

> An operator control plane for distributed [Temporal](https://temporal.io) workflows — define a workflow with a JSON
> Schema, and any operator gets a launch form, approval gates, an audit trail, and live visibility into workers running
> across any region or network.

In lean manufacturing, the **andon board** shows the live status of the whole production line — and the **andon cord**
lets any worker stop the line and summon a human before something goes wrong. Andon brings both to your distributed
systems: automation that runs durably on Temporal, with a human checkpoint exactly where you want one.

**License:** Apache-2.0

---

## Why Andon?

You already have Temporal (or you should — it gives you durable, resumable, retryable workflows for free). But Temporal
alone leaves an operational gap:

|                                   | Temporal UI                    | Airflow / n8n / Windmill     | **Andon**                                                      |
|-----------------------------------|--------------------------------|------------------------------|----------------------------------------------------------------|
| Audience                          | Developers debugging workflows | Builders authoring workflows | **Operators running workflows**                                |
| Launch a job safely               | Raw JSON via CLI/UI            | Varies                       | **Form generated from JSON Schema**                            |
| Human approval before execution   | ✗                              | Limited                      | **Built-in approval gate on every job**                        |
| Audit trail of who did what       | ✗                              | Partial                      | **Every create/approve/reject/cancel logged**                  |
| Workers in other networks/regions | ✓ (task queues)                | Mostly centralized execution | **First-class: fleet registry, heartbeats, per-queue routing** |

The last row is the part most tools get wrong. Andon workers only **dial out** — to Temporal and to the Andon API. The
control plane never needs network access into the environments where work happens. Put a worker in a VPC in Frankfurt, a
data center in Singapore, and a lab machine under someone's desk: they all pull work from their own task queue, and you
operate everything from one place.

**Use it for:** database migrations and restores, AI agent pipelines that need human sign-off, order processing across
ERP systems, cross-chain/bridge operations, or any risky, long-running job that should be *one approved button press*
instead of an SSH session.

## Quickstart

Requires Docker.

```bash
git clone https://github.com/getandon/andon.git
cd andon
docker compose up --build
```

This starts the full demo stack: Temporal + UI, Postgres, MinIO (S3), the Andon API + frontend, **two MongoDB instances
in separate "networks"** (source and target), and one Andon worker attached to each.

| Service       | URL                                                 |
|---------------|-----------------------------------------------------|
| Andon UI      | http://localhost:5173 (API key: `dev-key`)          |
| Andon API     | http://localhost:3000                               |
| Temporal UI   | http://localhost:8081                               |
| MinIO console | http://localhost:9001 (`minioadmin` / `minioadmin`) |

**Run the demo job:**

1. Open the Andon UI and log in with `dev-key`.
2. **Jobs → Start Job** → pick **Copy Database**. The form you see is generated from the workflow's JSON Schema — pick
   the `source` and `target` task queues, name the databases.
3. Submit. The job is created in `WAITING_APPROVAL` — nothing runs yet.
4. Go to **Approvals**, approve it. Now watch: backup runs on the *source* worker, restore/migrate/verify run on the
   *target* worker, with live step progress, and every action lands in the **Audit** log.

## Architecture

```
                ┌─────────────────────────────┐
                │   Andon control plane       │
                │  React UI ── NestJS API     │
                │  approvals · audit · fleet  │
                └───────┬─────────────┬───────┘
                        │             │ start/query workflows
              register/ │             ▼
              heartbeat │      ┌────────────┐
              (dial-out)│      │  Temporal  │
                        │      └─────┬──────┘
        ┌───────────────┼────────────┼──────────────────┐
        │ network A     │            │ pull  network B  │
        ▼               │            ▼       (dial-out) ▼
  ┌───────────┐         │      ┌───────────┐      ┌───────────┐
  │ worker    │◄────────┴──────│ task queue│─────►│ worker    │
  │ "source"  │                │ routing   │      │ "target"  │
  └─────┬─────┘                └───────────┘      └─────┬─────┘
        ▼                                               ▼
   your systems (databases, APIs, agents, chains, ...)
```

- **API** (`apps/api`): NestJS + Prisma (SQLite). Jobs, approvals, audit log, worker registry, Socket.io live updates.
  Single API-key auth.
- **Worker** (`apps/worker`): NestJS host for Temporal workers. Registers itself with the API, heartbeats, executes
  activities for its task queue.
- **Frontend** (`apps/frontend`): React + TanStack Router + Vite. Renders launch forms dynamically from each workflow's
  `inputSchema`.
- **Workflows** (`libs/workflows`): Temporal workflow code + the registry of workflow definitions.
- **Common** (`libs/common`): shared interfaces, env/S3/shell helpers.

## Define your own workflow

Andon is currently **fork-and-own**: clone the repo, add your workflow, deploy your build. (Published `@getandon/*`
packages with a plugin API are on the roadmap.)

**1. Write the workflow** — `libs/workflows/src/my-workflow.workflow.ts`:

```ts
import {scheduleActivity} from '@temporalio/workflow';
import type {WorkflowDefinition} from '../../common/src';

export interface DeployAgentInput {
    model: string;
    region: string;
    taskQueue: string;
}

export async function DeployAgentWorkflow(input: DeployAgentInput): Promise<void> {
    await scheduleActivity('provision', [input], {
        taskQueue: input.taskQueue,
        startToCloseTimeout: '30 minutes',
    });
    await scheduleActivity('healthcheck', [input], {
        taskQueue: input.taskQueue,
        startToCloseTimeout: '5 minutes',
    });
}

export const workflowDefinition: WorkflowDefinition = {
    type: 'DeployAgentWorkflow',
    label: 'Deploy Agent',
    description: 'Provision and health-check an agent in a target region',
    steps: ['provision', 'healthcheck'],
    taskQueueField: 'taskQueue',   // which input field names the queue the workflow runs on
    inputSchema: {
        type: 'object',
        properties: {
            model: {type: 'string', title: 'Model'},
            region: {type: 'string', title: 'Region'},
            taskQueue: {type: 'string', title: 'Task Queue'},
        },
        required: ['model', 'region', 'taskQueue'],
    },
};
```

**2. Register it** — `libs/workflows/src/registry.ts`:

```ts
import {workflowDefinition as CopyDatabase} from './copy-database.workflow';
import {workflowDefinition as DeployAgent} from './my-workflow.workflow';

export const WORKFLOW_REGISTRY = [CopyDatabase, DeployAgent];
```

**3. Implement the activities** — add a class under `apps/worker/src/activities/`, register it in `worker.module.ts`,
and add its methods to the `activities` map in `apps/worker/src/temporal/temporal-worker.service.ts`.

That's it. The API serves your definition at `/api/workflows`, the UI renders a launch form from your `inputSchema`, and
every run gets approval gating, step tracking, and audit logging — nothing else to wire up.

> Workflow files are bundled by Temporal's sandbox: keep them free of Node/AWS imports (use `import type` for shared
> types).

### Add an approval gate *inside* a workflow

Every job already gets a **launch approval** for free (created as `WAITING_APPROVAL`, a human approves before anything runs). Sometimes that's not enough — you want the workflow to run its safe part, then **pause and wait for a human** before the destructive part: backup first, *then* ask; dry-run the agent, *then* let it act; stage the transfer, *then* release it.

Andon ships a reusable gate built on Temporal signals — `libs/workflows/src/approval.ts`:

```ts
import { scheduleActivity } from '@temporalio/workflow';
import { createApprovalGate } from './approval';

export async function GuardedMigrationWorkflow(input: GuardedMigrationInput): Promise<void> {
  const approvals = createApprovalGate();          // install once, at the top

  await scheduleActivity('backupDatabase', [{ database: input.sourceDb }], {
    taskQueue: input.sourceTaskQueue,
    startToCloseTimeout: '1 hour',
  });

  await approvals.waitOrThrow('24 hours');         // ⬅ pauses here, durably

  await scheduleActivity('runMigration', [{ database: input.targetDb }], {
    taskQueue: input.targetTaskQueue,
    startToCloseTimeout: '1 hour',
  });
}
```

Then declare the gate in your workflow definition so Andon can recognize it:

```ts
steps: ['backupDatabase', 'awaitApproval', 'runMigration'],
approvalSteps: ['awaitApproval'],   // <- marks these steps as human gates
```

If a step only runs for certain inputs (like an optional gate), add `resolveSteps` so each job records exactly the steps it will execute:

```ts
resolveSteps: (params) =>
  ['backupDatabase', 'awaitApproval', 'runMigration']
    .filter((s) => s !== 'awaitApproval' || Boolean(params.requireApproval)),
```

…and set your `currentStep` query value to `'awaitApproval'` while waiting (see the Copy Database workflow for the query pattern).

### How operators find out — and approve

When the workflow reaches a declared approval step:

1. **Job page (live):** the step flips to an amber, pulsing **Waiting Approval** badge over WebSocket — no refresh — with **Approve / Reject buttons right beside the step**. Reject prompts for a reason and fails the job with it.
2. **Audit log:** a `STEP_APPROVAL_WAITING` entry is written the moment the gate opens (so "recent activity" on the dashboard surfaces it), and the decision lands as `STEP_APPROVED` / `STEP_REJECTED`.
3. **Your channels:** for Slack/email/PagerDuty pings, run a notify activity *right before* the gate — it's ordinary activity code on your worker:

```ts
await scheduleActivity('notifySlack', [{
  text: `Job ${input.sourceDb} → ${input.targetDb} is waiting for approval: https://andon.example.com/jobs/${jobId}`,
}], { taskQueue: input.sourceTaskQueue, startToCloseTimeout: '1 minute' });

await approvals.waitOrThrow('24 hours');
```

Built-in notification channels (Slack / webhook / email, no custom activity needed) are on the roadmap.

Automation can also resolve gates through the API (CI pipelines, chatops):

```bash
# approve
curl -X POST https://andon.example.com/api/jobs/42/signal-approval \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"approved": true}'

# reject (fails the job with your reason)
curl -X POST https://andon.example.com/api/jobs/42/signal-approval \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"approved": false, "reason": "row counts look wrong"}'
```

Semantics:

- `waitOrThrow()` fails the workflow (non-retryable) on rejection → job goes `FAILED` with the reason; use `wait()` instead if you want to branch on the decision yourself.
- The timeout (`'24 hours'`) fails the gate if nobody decides, so jobs can't hang forever. Omit it to wait indefinitely.
- Waiting costs nothing: it's persisted Temporal state — workers can restart or redeploy while the gate is open.
- Multiple gates per workflow are fine (`waitOrThrow()` per checkpoint; decisions apply in order).

**Try it in the demo:** tick **"Require approval before restore"** when starting the Copy Database job — after the backup completes, the job parks at `awaitApproval` and the Approve/Reject buttons appear on the step.

The built-in **Copy Database** workflow (`libs/workflows/src/copy-database.workflow.ts`) is the reference example:
MongoDB backup on one worker → S3 → restore, migrate, verify on another. It exists to show the pattern — including
cross-queue activity routing — not because Andon is a database tool.

## Configuration

| Variable                                                         | Used by     | Description                                                                                           |
|------------------------------------------------------------------|-------------|-------------------------------------------------------------------------------------------------------|
| `API_KEY`                                                        | api, worker | Shared secret. **The API refuses to boot without it** unless `AUTH_DISABLED=true` (development only). |
| `TEMPORAL_ADDRESS`                                               | api, worker | Temporal frontend address (default `localhost:7233`).                                                 |
| `TEMPORAL_NAMESPACE`                                             | api, worker | Temporal namespace (default `default`).                                                               |
| `TEMPORAL_TLS`                                                   | api, worker | Set `true` to connect to Temporal over TLS (server-side certs).                                       |
| `TEMPORAL_TLS_CLIENT_CERT_PATH` / `TEMPORAL_TLS_CLIENT_KEY_PATH` | api, worker | Client certificate pair — enables **mTLS**.                                                           |
| `TEMPORAL_TLS_SERVER_ROOT_CA_PATH`                               | api, worker | CA used to verify the Temporal server certificate (private CAs).                                      |
| `TEMPORAL_TLS_SERVER_NAME`                                       | api, worker | Overrides the expected server name (SNI) in the Temporal certificate.                                 |
| `TEMPORAL_API_KEY`                                               | api, worker | API key auth (e.g. Temporal Cloud; combine with `TEMPORAL_TLS=true`).                                 |
| `DATABASE_URL`                                                   | api         | Prisma SQLite URL, e.g. `file:./data/andon.db`.                                                       |
| `TEMPORAL_TASK_QUEUE` | worker | The queue this worker serves (e.g. `source`, `eu-west`, `prod-dmz`). |
| `WORKER_NAME` | worker | Stable name shown on the Workers page and used as the Temporal identity. Defaults to `<hostname>-<taskQueue>` (container IDs in Docker — set this in production). |
| `ANDON_API_URL`                                                  | worker      | Where the worker registers + heartbeats (dial-out only).                                              |
| `WORKER_HEARTBEAT_INTERVAL_MS`                                   | worker      | Heartbeat period (default `30000`).                                                                   |
| `MONGODB_URI`, `S3_*`, `AWS_*`, `MIGRATE_MONGO_PATH`             | worker      | Only needed for the Copy Database example activities.                                                 |

## Security notes

- One shared API key guards the API (`Authorization: Bearer <key>`); the UI stores it client-side after login. Per-user
  identity and RBAC are on the roadmap — until then, treat the key like a production credential and put the UI/API
  behind your VPN or SSO proxy.
- Example activities validate database names (`[A-Za-z0-9_-]`) before invoking shell tools; follow the same pattern (
  `assertSafeName`) in your own activities.
- Workers need outbound access only — no inbound ports.

## Production deployment: Kubernetes

The canonical Andon production story, end to end: **copy the production database into staging, across two isolated
environments, with an approval in between.**

### Topology

One Temporal server, one Andon control plane, and one worker Deployment *per environment*. Workers need **zero inbound
connectivity** — no Service, no Ingress — they only dial out to Temporal, the Andon API, and S3:

| Component           | Where it runs                                                                          | Exposure                                  |
|---------------------|----------------------------------------------------------------------------------------|-------------------------------------------|
| Temporal server     | Its own namespace/cluster (Helm chart), or [Temporal Cloud](https://temporal.io/cloud) | mTLS frontend, reachable by API + workers |
| Andon API + UI      | An ops/tools namespace                                                                 | Behind your ingress + SSO/VPN             |
| Worker `production` | The **production** cluster/namespace, next to the prod database                        | Egress only                               |
| Worker `staging`    | The **staging** cluster/namespace                                                      | Egress only                               |
| S3 bucket           | Anywhere both workers can reach                                                        | Backup transport between environments     |

The two workers never talk to each other. The dump travels `prod worker → S3 → staging worker`, and Temporal routes each
activity to the right side via task queues.

### Network view

```
                          ┌────────────────────┐
                          │ Operator (browser) │
                          └─────────┬──────────┘
                                    │  ① HTTPS — UI, REST, WebSocket
                                    │     (SSO / VPN in front)
   ops / tools namespace            │
  ┌─────────────────────────────────▼─────────────────────────────┐
  │               Andon control plane — UI + API                  │
  │       jobs · approvals · audit · fleet registry · SQLite      │
  │                                                               │
  │      ▲ ⑤ register + heartbeat — HTTPS, initiated by every     │
  │      ┆    worker from inside its own network (dial-out)       │
  └──────┆─────────────────┬──────────────────────────────────────┘
         ┆                 │ ② start / query / cancel workflows
         ┆                 │    mTLS → :7233
   temporal namespace      ▼
  ┌───────────────────────────────────────────────────────────────┐
  │       Temporal frontend :7233 — mTLS, requireClientAuth       │
  │   ┌────────────────────────┐    ┌────────────────────────┐    │
  │   │ task queue: production │    │  task queue: staging   │    │
  │   └────────────▲───────────┘    └───────────▲────────────┘    │
  └────────────────┼────────────────────────────┼─────────────────┘
                   │ ③ long-poll for tasks      │ ③ long-poll for tasks
                   │   mTLS, outbound only      │   mTLS, outbound only
   production network / cluster A    staging network / cluster B
  ┌────────────────┼─────────────┐  ┌────────────┼─────────────────┐
  │    ┌───────────┴──────────┐  │  │  ┌─────────┴──────────────┐  │
  │    │ Andon worker      ┆⑤ │  │  │  │ Andon worker        ┆⑤ │  │
  │    │ queue=production     │  │  │  │ queue=staging          │  │
  │    └──┬───────────────┬───┘  │  │  └───┬────────────────┬───┘  │
  │       │ mongodump     │      │  │      │ mongorestore,  │      │
  │       ▼               │      │  │      ▼ migrate,verify │      │
  │  ┌────────────┐       │      │  │  ┌───────────────┐    │      │
  │  │ prod Mongo │       │      │  │  │ staging Mongo │    │      │
  │  └────────────┘       │      │  │  └───────────────┘    │      │
  └───────────────────────┼──────┘  └───────────────────────┼──────┘
              ④ upload    │                     ④ download  │
                 dump     │                        dump     │
                (HTTPS)   ▼                       (HTTPS)   ▼
         ┌──────────────────────────────────────────────────────┐
         │        S3 object store — bucket: andon-backups       │
         └──────────────────────────────────────────────────────┘
```

| # | Connection              | Protocol     | Purpose                                                       |
|---|-------------------------|--------------|---------------------------------------------------------------|
| ① | Operator → Andon UI/API | HTTPS        | Create jobs, approve, watch live progress                     |
| ② | Andon API → Temporal    | mTLS `:7233` | Start / query / cancel workflows                              |
| ③ | Worker → Temporal       | mTLS `:7233` | Long-poll its own task queue — work is *pulled*, never pushed |
| ④ | Worker → S3             | HTTPS        | Prod uploads the dump; staging downloads it                   |
| ⑤ | Worker → Andon API      | HTTPS        | Register + heartbeat (powers the Workers page)                |

Every arrow points in the direction the connection is **initiated**. Note what's missing: there is no arrow *into* a
worker network. Workers need zero inbound ports, no Service, no Ingress, no VPN peering between environments — if a
worker can reach Temporal, the Andon API, and S3, it can serve its queue from anywhere: another cloud, an on-prem rack,
a customer site.

### 1. Secure the Temporal server (mTLS)

Self-hosted via the [official Helm chart](https://github.com/temporalio/helm-charts): enable mutual TLS so only
workloads holding a client certificate from your CA can talk to it — this is what keeps a control plane for *production
operations* from becoming an attack surface. In the server configuration:

```yaml
global:
  tls:
    internode: # service-to-service traffic inside Temporal
      server:
        certFile: /etc/temporal/certs/internode/tls.crt
        keyFile: /etc/temporal/certs/internode/tls.key
        requireClientAuth: true
        clientCaFiles:
          - /etc/temporal/certs/internode/ca.crt
      client:
        serverName: temporal-internode.example.com
        rootCaFiles:
          - /etc/temporal/certs/internode/ca.crt
    frontend: # SDK traffic: Andon API + workers
      server:
        certFile: /etc/temporal/certs/frontend/tls.crt
        keyFile: /etc/temporal/certs/frontend/tls.key
        requireClientAuth: true     # reject clients without a cert from your CA
        clientCaFiles:
          - /etc/temporal/certs/frontend/clients-ca.crt
      client:
        serverName: temporal-frontend.example.com   # prevents spoofing/MITM
        rootCaFiles:
          - /etc/temporal/certs/frontend/ca.crt
```

Issue the certificates with [cert-manager](https://cert-manager.io) from a private CA `Issuer`, mounted as Kubernetes
TLS Secrets. Two hardening notes from Temporal's own guidance: always set `serverName` (so clients verify the cert's
CN/SAN and can't be MITM'd), and use `requireClientAuth: true` with per-client CAs so each environment's workers can get
their own cert — revocable independently.

**Temporal Cloud instead:** skip all of the above, set `TEMPORAL_ADDRESS=<ns>.<acct>.tmprl.cloud:7233`,
`TEMPORAL_NAMESPACE=<ns>.<acct>`, and either mTLS client certs or `TEMPORAL_TLS=true` + `TEMPORAL_API_KEY`. Andon
supports both natively.

Also create a dedicated namespace per Andon installation (`temporal operator namespace create andon-prod`) rather than
using `default` — namespaces are Temporal's isolation boundary.

### 2. Deploy the Andon control plane

API + frontend as ordinary Deployments in an ops namespace, UI/API behind your ingress with SSO or VPN in front (Andon's
own auth is a single API key in v0.1 — layer real identity in front of it). Give the API the *same* Temporal TLS env
vars as the workers below, plus a PVC (or roadmap Postgres) for `DATABASE_URL`.

### 3. Deploy a worker per environment

The production worker — note what's *absent*: no Service, no Ingress, no inbound ports at all.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: andon-worker
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels: { app: andon-worker }
  template:
    metadata:
      labels: { app: andon-worker }
    spec:
      containers:
        - name: worker
          image: ghcr.io/getandon/andon-worker:0.1.0
          env:
            - name: TEMPORAL_ADDRESS
              value: temporal-frontend.temporal.svc.cluster.local:7233   # or external DNS
            - name: TEMPORAL_NAMESPACE
              value: andon-prod
            - name: TEMPORAL_TASK_QUEUE
              value: production                     # <- this worker's identity
            - name: WORKER_NAME                     # unique + stable per pod
              valueFrom:
                fieldRef: { fieldPath: metadata.name }
            - name: TEMPORAL_TLS_CLIENT_CERT_PATH
              value: /etc/temporal/certs/tls.crt
            - name: TEMPORAL_TLS_CLIENT_KEY_PATH
              value: /etc/temporal/certs/tls.key
            - name: TEMPORAL_TLS_SERVER_ROOT_CA_PATH
              value: /etc/temporal/certs/ca.crt
            - name: TEMPORAL_TLS_SERVER_NAME
              value: temporal-frontend.example.com
            - name: ANDON_API_URL
              value: https://andon.internal.example.com
            - name: API_KEY
              valueFrom:
                secretKeyRef: { name: andon-worker, key: api-key }
            - name: MONGODB_URI                      # prod DB creds stay in prod
              valueFrom:
                secretKeyRef: { name: andon-worker, key: mongodb-uri }
            - name: S3_BUCKET
              value: andon-backups
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef: { name: andon-worker, key: s3-access-key }
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef: { name: andon-worker, key: s3-secret-key }
          volumeMounts:
            - name: temporal-client-cert
              mountPath: /etc/temporal/certs
              readOnly: true
      volumes:
        - name: temporal-client-cert
          secret:
            secretName: andon-worker-temporal-cert   # issued by cert-manager
```

Deploy the same manifest in the `staging` namespace/cluster with `TEMPORAL_TASK_QUEUE=staging`, staging DB credentials,
and staging's own client certificate. Optionally lock each worker down with an egress-only NetworkPolicy (Temporal,
Andon API, S3, and its own database — nothing else, nothing inbound).

### 4. Run the prod → staging copy

1. Both workers appear on the **Workers** page (registered + heartbeating, each showing its queue).
2. **Start Job → Copy Database**: `sourceTaskQueue=production`, `targetTaskQueue=staging`, `sourceDb=app`,
   `targetDb=app`.
3. The job waits in **Approvals** — this is your protection against "oops, wrong direction": a human confirms *prod is
   the source, staging is the target*, with the parameters and audit trail to prove it.
4. On approval: `backupDatabase` executes inside the production environment (prod credentials never leave it) → dump
   lands in S3 → `restoreDatabase`, `runMigration`, `verifyDatabase` execute inside staging → live step progress in the
   UI, every decision in the audit log.

Same pattern scales sideways: add a `eu-west` queue, a `dmz` queue, a `customer-onprem` queue — one control plane,
workers wherever the work is.

## Known limitations (v0.1)

- If the API restarts while a job is running, the job keeps running in Temporal but its status is no longer synced
  back (no reconciliation loop yet).
- Job identity is the API key, not a user (`createdBy: 'api-key'`).
- Metadata store is SQLite — perfect for a single API instance, not for HA.

These are tracked as GitHub issues — contributions welcome.

## Roadmap

- [ ] `@getandon/*` npm packages: use Andon as a dependency instead of a fork
- [ ] Reconciliation loop: re-attach to running workflows on API restart
- [ ] Users, roles, per-workflow approval policies
- [ ] Postgres example workflow (`pg_dump`/`pg_restore`)
- [ ] Built-in notification channels for waiting approval gates (Slack / webhook / email)
- [ ] Scheduled (cron) jobs
- [ ] Postgres option for the metadata store

## Development

```bash
npm install                       # root: api + worker
npx prisma migrate dev            # set up the SQLite schema
npm run start:api                 # API on :3000
npm run start:worker              # a worker (set TEMPORAL_TASK_QUEUE)
cd apps/frontend && npm install && npm run dev   # UI on :5173
```

Run Temporal + MinIO + Mongo via
`docker compose up temporal temporal-ui postgres minio minio-setup mongodb-source mongodb-target`.

## License

[Apache-2.0](./LICENSE) © Anas Saber
