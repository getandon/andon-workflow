/*
  Warnings:

  - You are about to drop the `Environment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `sourceEnvId` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `targetEnvId` on the `Job` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Environment_slug_key";

-- DropIndex
DROP INDEX "Environment_name_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Environment";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Worker" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "taskQueue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ONLINE',
    "lastHeartbeat" DATETIME,
    "activities" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "tlsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "temporalTls" BOOLEAN NOT NULL DEFAULT false,
    "apiTls" BOOLEAN NOT NULL DEFAULT false,
    "certNotAfter" DATETIME,
    "certNotBefore" DATETIME,
    "certSubject" TEXT,
    "certIssuer" TEXT,
    "certSerial" TEXT,
    "certKeyUsage" TEXT,
    "certFingerprint" TEXT,
    "caNotAfter" DATETIME,
    "caSubject" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workflowId" TEXT NOT NULL,
    "workflowType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);
INSERT INTO "new_Job" ("createdAt", "createdBy", "error", "finishedAt", "id", "params", "startedAt", "status", "workflowId", "workflowType") SELECT "createdAt", "createdBy", "error", "finishedAt", "id", "params", "startedAt", "status", "workflowId", "workflowType" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_workflowId_key" ON "Job"("workflowId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Worker_name_key" ON "Worker"("name");
