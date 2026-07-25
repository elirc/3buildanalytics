import { promises as fs } from "node:fs";
import path from "node:path";

import { ExportStatus } from "@prisma/client";

import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { logInfo, logWarn } from "../../shared/utils/logger.js";

/**
 * Expires completed exports whose retention window has passed.
 *
 * Every completed export already carried an expiresAt — set to now + 7 days —
 * and nothing ever read it. The EXPIRED status existed in the enum and was
 * never used. So files accumulated on disk indefinitely, which for CSVs
 * containing whatever the requester could see is a slowly growing liability.
 *
 * Deliberately tolerant: a file that is already gone is a success, not an
 * error. The goal is that no expired job still advertises a download, and a
 * missing file has already achieved that.
 */
export const exportCleanupService = {
  async run(now = new Date()) {
    const expired = await prisma.exportJob.findMany({
      where: {
        status: ExportStatus.COMPLETED,
        expiresAt: { not: null, lte: now }
      },
      select: { id: true, fileName: true }
    });

    let filesDeleted = 0;

    for (const job of expired) {
      if (job.fileName) {
        try {
          await fs.unlink(path.join(resolveStorageDir(), job.fileName));
          filesDeleted += 1;
        } catch (error) {
          // ENOENT means someone or something already removed it — fine.
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") {
            logWarn("export.cleanup.unlink_failed", { exportJobId: job.id, error: code });
          }
        }
      }

      // Clear fileName/fileUrl as well as the status: a row that still names a
      // file it no longer has is exactly the state the seed used to leave
      // behind, and it produces a download that fails confusingly.
      await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: ExportStatus.EXPIRED,
          fileName: null,
          fileUrl: null
        }
      });
    }

    if (expired.length > 0) {
      logInfo("export.cleanup.completed", { expired: expired.length, filesDeleted });
    }

    return { expired: expired.length, filesDeleted };
  },

  retentionDays() {
    return env.EXPORT_RETENTION_DAYS;
  }
};

function resolveStorageDir() {
  return path.resolve(process.cwd(), env.EXPORT_STORAGE_DIR);
}
