-- CreateTable
CREATE TABLE "JobInputRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" INTEGER NOT NULL,
    "gateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "schema" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "payload" TEXT,
    "decidedBy" TEXT,
    "reason" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "resolvedAt" DATETIME,
    CONSTRAINT "JobInputRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "JobInputRequest_jobId_gateId_key" ON "JobInputRequest"("jobId", "gateId");
