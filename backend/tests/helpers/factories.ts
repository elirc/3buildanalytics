import {
  type EventType,
  type ExportStatus,
  type ExportType,
  type MonitoringMetricType,
  type Prisma,
  type Role
} from "@prisma/client";

import { prisma } from "../../src/db/prisma.js";
import { hashPassword } from "../../src/shared/utils/password.js";

/**
 * Test factories.
 *
 * Deliberately small and explicit: every factory takes the handful of fields a
 * test might care about and fills the rest with boring defaults. No faker — a
 * test that fails only on Tuesdays because of random data is worse than no test.
 *
 * Each factory returns the created row so tests can assert against real ids.
 */

let sequence = 0;
function nextSequence() {
  sequence += 1;
  return sequence;
}

/** Shared across all seeded users so tests can log in without hashing per user. */
export const TEST_PASSWORD = "Password123!";
let cachedPasswordHash: string | null = null;

async function getPasswordHash() {
  // bcrypt is intentionally slow. Hashing once per run instead of once per user
  // takes the auth integration suite from ~30s to ~2s.
  if (!cachedPasswordHash) {
    cachedPasswordHash = await hashPassword(TEST_PASSWORD);
  }
  return cachedPasswordHash;
}

export async function createUser(
  overrides: Partial<{
    email: string;
    role: Role;
    firstName: string;
    lastName: string;
    isActive: boolean;
  }> = {}
) {
  const index = nextSequence();
  const role = overrides.role ?? "SYSTEM_ADMIN";

  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${index}-${role.toLowerCase()}@example.com`,
      passwordHash: await getPasswordHash(),
      firstName: overrides.firstName ?? "Test",
      lastName: overrides.lastName ?? `User${index}`,
      role,
      isActive: overrides.isActive ?? true
    }
  });
}

/** Creates one user per role and returns them keyed by role. */
export async function createUserPerRole(roles: readonly Role[]) {
  const entries = await Promise.all(
    roles.map(async (role) => [role, await createUser({ role })] as const)
  );

  return Object.fromEntries(entries) as Record<Role, Awaited<ReturnType<typeof createUser>>>;
}

export async function createTrackedEvent(
  overrides: Partial<{
    eventType: EventType;
    actorId: string;
    actorEmail: string;
    entityType: string;
    entityId: string;
    occurredAt: Date;
    metadata: Prisma.InputJsonValue;
  }> = {}
) {
  const index = nextSequence();

  return prisma.trackedEvent.create({
    data: {
      eventType: overrides.eventType ?? "FEATURE_USED",
      actorId: overrides.actorId,
      actorEmail: overrides.actorEmail ?? `actor-${index}@example.com`,
      entityType: overrides.entityType ?? "User",
      entityId: overrides.entityId ?? `entity-${index}`,
      metadata: overrides.metadata ?? { source: "test" },
      occurredAt: overrides.occurredAt ?? new Date()
    }
  });
}

/**
 * Bulk variant for tests that care about counts rather than individual rows.
 * Uses createMany, which is one INSERT rather than N.
 */
export async function createTrackedEvents(input: {
  count: number;
  eventType?: EventType;
  occurredAt?: Date;
  actorId?: string;
}) {
  const rows = Array.from({ length: input.count }, () => {
    const index = nextSequence();
    return {
      eventType: input.eventType ?? ("FEATURE_USED" as EventType),
      actorId: input.actorId,
      actorEmail: `actor-${index}@example.com`,
      entityType: "User",
      entityId: `entity-${index}`,
      metadata: { source: "test" },
      occurredAt: input.occurredAt ?? new Date()
    };
  });

  await prisma.trackedEvent.createMany({ data: rows });
  return rows.length;
}

export async function createAuditEvent(
  overrides: Partial<{
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: Date;
  }> = {}
) {
  const index = nextSequence();

  return prisma.auditEvent.create({
    data: {
      actorId: overrides.actorId,
      action: overrides.action ?? "DASHBOARD_VIEWED",
      entityType: overrides.entityType ?? "User",
      entityId: overrides.entityId ?? `audit-entity-${index}`,
      metadata: { source: "test" },
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
      createdAt: overrides.createdAt ?? new Date()
    }
  });
}

export async function createMonitoringMetric(
  overrides: Partial<{
    metricType: MonitoringMetricType;
    name: string;
    value: number;
    recordedAt: Date;
  }> = {}
) {
  const index = nextSequence();

  return prisma.monitoringMetric.create({
    data: {
      metricType: overrides.metricType ?? "API_LATENCY",
      name: overrides.name ?? `metric-${index}`,
      value: overrides.value ?? 120,
      unit: "ms",
      tags: { source: "test" },
      recordedAt: overrides.recordedAt ?? new Date()
    }
  });
}

export async function createExportJob(
  overrides: Partial<{
    requestedById: string;
    exportType: ExportType;
    status: ExportStatus;
    fileName: string | null;
    expiresAt: Date | null;
    filtersJson: Prisma.InputJsonValue;
  }> & { requestedById: string }
) {
  return prisma.exportJob.create({
    data: {
      requestedById: overrides.requestedById,
      exportType: overrides.exportType ?? "TRACKED_EVENTS",
      status: overrides.status ?? "PENDING",
      fileName: overrides.fileName ?? null,
      expiresAt: overrides.expiresAt ?? null,
      filtersJson: overrides.filtersJson ?? {}
    }
  });
}
