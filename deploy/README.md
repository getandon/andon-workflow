# Deploying Andon to Kubernetes

Plain, ready-to-apply manifests. Single instance, namespace `andon`, no Kustomize,
no ArgoCD (secrets are filled by hand — GitOps auto-sync would revert them).

## What you get

| Component | Manifests | Notes |
|---|---|---|
| API | `api/` | NestJS :3000, SQLite on a 1Gi PVC, 1 replica (`Recreate`) |
| Frontend | `frontend/` | nginx :80, ClusterIP only (not exposed) |
| Worker | `worker/` | Task queue `default`, backs up to real AWS S3 |
| Temporal | `temporal/` | Single-node `auto-setup` + Postgres 16 (5Gi PVC) + Temporal UI |
| Routing | `routing/` | Istio VirtualServices: `andon-api.pix-xo.cloud` -> `api:3000`, `andon-temporal.pix-xo.cloud` -> `temporal:7233` (gRPC) |

## Prerequisites

1. **Images** — build and push (no CI does this yet):

   ```bash
   docker build -t ghcr.io/getandon/andon-api:latest      -f apps/api/Dockerfile .
   docker build -t ghcr.io/getandon/andon-worker:latest   -f apps/worker/Dockerfile .
   docker build -t ghcr.io/getandon/andon-frontend:latest apps/frontend
   docker push ghcr.io/getandon/andon-api:latest
   docker push ghcr.io/getandon/andon-worker:latest
   docker push ghcr.io/getandon/andon-frontend:latest
   ```

   Packages must be public on GHCR (no `imagePullSecrets` are configured).

2. **Secrets** — edit `secrets.yaml` and replace every `change-me`
   (`API_KEY`, AWS credentials for S3, `MONGODB_URI`). Do not commit filled values.

3. **S3 bucket** — the backup bucket (default `andon-backups`) must exist in
   `eu-central-1` and be writable by the AWS credentials above.

4. **DNS** — two records pointing at the Istio ingress gateway load balancer
   (both covered by the existing `*.pix-xo.cloud` certificate):
   - `andon-api.pix-xo.cloud`
   - `andon-temporal.pix-xo.cloud`

## Deploy

```bash
kubectl apply -f deploy/namespace.yaml
kubectl apply -f deploy/secrets.yaml
kubectl apply -f deploy/temporal/
kubectl apply -f deploy/api/
kubectl apply -f deploy/frontend/
kubectl apply -f deploy/worker/
kubectl apply -f deploy/routing/
```

Wait for everything: `kubectl -n andon get pods -w`

## Access

| What | How |
|---|---|
| Andon UI | `kubectl -n andon port-forward svc/frontend 8080:80` -> http://localhost:8080 (log in with `API_KEY`) |
| Andon API | https://andon-api.pix-xo.cloud (header `x-api-key`) |
| Temporal (gRPC) | `andon-temporal.pix-xo.cloud:443` (TLS, for remote workers) |
| Temporal UI | `kubectl -n andon port-forward svc/temporal-ui 8081:8080` -> http://localhost:8081 |

## Adding worker fleets

Copy `worker/deployment.yaml`, change `WORKER_NAME`, `TEMPORAL_TASK_QUEUE` and
`MONGODB_URI`. In-cluster workers reach the API at `http://api:3000`.

**Remote workers** (other networks) only dial out — no inbound access to their
network is needed. Run the worker image anywhere with:

```bash
TEMPORAL_ADDRESS=andon-temporal.pix-xo.cloud:443
TEMPORAL_TLS=true
ANDON_API_URL=https://andon-api.pix-xo.cloud
API_KEY=...            # same operator key
TEMPORAL_TASK_QUEUE=... # this fleet's queue name
WORKER_NAME=...
MONGODB_URI=...         # the database this worker manages
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... S3_REGION=eu-central-1
```

## Securing the Temporal endpoint

`andon-temporal.pix-xo.cloud` is a raw Temporal gRPC frontend with **no
application-level auth** — anyone who can reach it can start workflows. Lock it
down so only your external workers can connect. In-cluster components are
unaffected either way (they use `temporal:7233` directly, bypassing the gateway).

### Option 1 — mTLS client certificates (recommended)

Only clients presenting a certificate signed by your private CA can complete the
TLS handshake. This is Temporal's own self-hosted security model, and the worker
already supports it (`libs/common/src/temporal-tls.ts`).

1. Create a CA, a server cert for the host, and one client cert per worker:

   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -days 1825 \
     -keyout ca.key -out ca.crt -subj "/CN=andon-temporal-ca"

   openssl req -newkey rsa:4096 -nodes -keyout server.key -out server.csr \
     -subj "/CN=andon-temporal.pix-xo.cloud"
   openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
     -days 825 -out server.crt \
     -extfile <(printf "subjectAltName=DNS:andon-temporal.pix-xo.cloud")

   openssl req -newkey rsa:4096 -nodes -keyout worker-fra.key -out worker-fra.csr \
     -subj "/CN=worker-fra"
   openssl x509 -req -in worker-fra.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
     -days 365 -out worker-fra.crt
   ```

2. Create the gateway credential (server cert + CA used to verify clients):

   ```bash
   kubectl -n istio-system create secret generic andon-temporal-credential \
     --from-file=tls.crt=server.crt \
     --from-file=tls.key=server.key \
     --from-file=ca.crt=ca.crt
   ```

3. Add a dedicated Gateway with `MUTUAL` TLS. The exact SNI host takes
   precedence over the existing `*.pix-xo.cloud` `SIMPLE` server, so only this
   host requires client certs:

   ```yaml
   apiVersion: networking.istio.io/v1beta1
   kind: Gateway
   metadata:
     name: andon-temporal-gateway
     namespace: istio-system
   spec:
     selector:
       istio: ingressgateway
     servers:
       - port:
           number: 443
           name: https-andon-temporal
           protocol: HTTPS
         tls:
           mode: MUTUAL
           credentialName: andon-temporal-credential
         hosts:
           - "andon-temporal.pix-xo.cloud"
   ```

4. In `routing/temporal-virtual-service.yaml`, change `spec.gateways` to
   `istio-system/andon-temporal-gateway` and re-apply.

5. Give each external worker its cert and point it at the private CA (the
   server cert is no longer from the public wildcard):

   ```bash
   TEMPORAL_ADDRESS=andon-temporal.pix-xo.cloud:443
   TEMPORAL_TLS=true
   TEMPORAL_TLS_CLIENT_CERT_PATH=/certs/worker-fra.crt
   TEMPORAL_TLS_CLIENT_KEY_PATH=/certs/worker-fra.key
   TEMPORAL_TLS_SERVER_ROOT_CA_PATH=/certs/ca.crt
   ```

Any cert signed by your CA is accepted — revoke access by rotating the CA and
reissuing worker certs. Keep `ca.key` offline; never put it in the cluster.

### Option 2 — IP allowlist (simpler, if workers have static egress IPs)

Deny every source except your workers' egress IPs, at the ingress gateway:

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: andon-temporal-ip-allowlist
  namespace: istio-system
spec:
  selector:
    matchLabels:
      istio: ingressgateway
  action: DENY
  rules:
    - from:
        - source:
            notRemoteIpBlocks:
              - 203.0.113.10/32   # worker-fra egress IP
              - 198.51.100.7/32   # worker-sin egress IP
      to:
        - operation:
            hosts: ["andon-temporal.pix-xo.cloud"]
```

Caveat: `remoteIpBlocks` only sees the real client IP if the ingress Service
preserves it (`externalTrafficPolicy: Local` on the istio ingress LB Service, or
proxy-protocol enabled on the LB). Verify before trusting this policy.

Options can be combined (mTLS + IP allowlist) for defense in depth. The API host
needs no equivalent policy — it enforces its own `x-api-key` auth — but the same
IP allowlist pattern works there too if you want it.

## Swapping in Temporal Cloud / external Temporal

Delete `temporal/`, then set on both `api` and `worker` Deployments:
`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and either `TEMPORAL_API_KEY` or the
`TEMPORAL_TLS_*` variables (see `libs/common/src/temporal-tls.ts`).
