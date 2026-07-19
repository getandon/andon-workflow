# Building Domain-Specific Temporal Activities

## 1. Activity Contract First

Define typed input and output interfaces **before** the implementation. Place shared contracts in a library package so both the worker and the workflow can depend on them without circular imports. Every activity method accepts one input object and returns one output object — this keeps the Temporal history deterministic and debuggable.

```typescript
interface DoSomethingInput {
  database?: string;
  batchSize?: number;
  lastCursor?: string;
}

interface DoSomethingOutput {
  totalProcessed: number;
  batches: number;
  completed: boolean;
}
```

- Prefer optional fields with sensible defaults (`batchSize ?? 500`) so the workflow can omit what it doesn't care about.
- Include checkpoint data (cursor, offset, batch index) in the output and in heartbeats so a timed-out activity can resume without reprocessing.

## 2. Idempotency Is Mandatory

Temporal **will** replay and may retry an activity multiple times. Design every activity so running it twice produces the same side-effect as running it once.

- Use conditional writes: `updateMany({ id: { $in: ids }, flag: { $ne: true } }, { $set: { flag: true } })` — the filter guards against double-processing.
- Avoid destructive inline mutations that cannot be reversed. If you must delete, soft-delete or record the action first.
- Never generate random IDs, timestamps, or non-deterministic values inside an activity called from a workflow that depends on the result for branching.

## 3. Batching for Scale

A single activity should complete within Temporal's timeout window. For operations touching millions of records, use cursor-based batching:

- **Cursor-based pagination** (`_id > lastId`, sorted ascending) gives consistent performance at any collection size. `skip/limit` degrades as the offset grows.
- Track the last processed cursor in the heartbeat so a timed-out activity can resume from where it left off.
- Emit a heartbeat after every batch: `Context.current().heartbeat({ batch, lastCursor })`.

## 4. Heartbeating

The heartbeat mechanism tells Temporal the activity is alive and carries checkpoint data for resumption.

- Call `Context.current().heartbeat()` at regular intervals — after each batch, or at least before any operation that might exceed the activity's `heartbeatTimeout`.
- Store enough state in the heartbeat payload to resume: batch index, last cursor, accumulated counters.
- On retry, read the previous heartbeat data from the activity input (pass it from the workflow as the `lastCursor` equivalent) so the next attempt picks up where the previous one left off.

## 5. Error Handling

Distinguish between **transient** and **fatal** errors:

- Transient (network blip, temporary lock): throw and let Temporal retry with its built-in retry policy.
- Fatal (invalid input, missing required field): throw an `ApplicationFailure` with `nonRetryable: true` so Temporal does not waste retries.
- Always clean up resources (close connections, remove temp files) in a `finally` block so a thrown error doesn't leak handles.
- Log structured messages at each meaningful step so operators can trace progress in the Temporal UI and external log sinks.

## 6. Activity Registration

Activities must be wired in three places:

1. **NestJS provider array** in the worker module.
2. **Constructor injection** in the service that creates the Temporal Worker.
3. **Activities map** passed to `Worker.create()`, with `.bind()` to preserve the `this` context.

There is no auto-discovery. Every new activity requires a small ceremony in all three spots. Keep a checklist in the module file or a nearby README.

## 7. Connection Management

- Create a fresh client per activity invocation and close it in `finally`. Do not share a long-lived connection across activities — it couples the activity lifecycle to the worker process lifecycle and makes error recovery brittle.
- Read connection parameters from environment variables (`requiredEnv('MONGODB_URI')`). Never hardcode credentials, hostnames, or ports.
- Use a peer-dependency check: if your activity depends on a library that the worker does not yet bundle (e.g., a specific database driver), either add it to the worker's `package.json` or choose a zero-dependency fallback.

## 8. Testing Domain Activities

- Unit-test the activity class directly: instantiate it, call the public method, assert the output and side-effects.
- For database-dependent tests, spin up a Dockerised database instance in CI, seed it with known fixtures, run the activity, and assert the mutations.
- Mock Temporal's `Context` when testing outside the Temporal runtime. A simple pattern: guard all `Context.current()` calls behind a thin wrapper that throws a predictable error in test.
- Test idempotency explicitly: run the activity twice and verify the second run is a no-op with the same reported counts.

## 9. Naming and Module Layout

- Group domain-specific activities under a feature directory: `src/activities/<feature>/<Verb><Noun>.activity.ts`.
- Use PascalCase for class names matching the file name.
- The activity method name is the string workflows reference — keep it stable. Renaming it requires updating workflows and any external callers.
- Keep the activity class thin. If logic grows complex, extract pure functions into a sibling `*.helpers.ts` or a domain service, and inject or import it.
