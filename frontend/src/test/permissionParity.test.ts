// Reaches across the workspace on purpose: this test's entire job is to compare
// the frontend's mirror against the backend's authority. Importing the real
// module is what makes it a drift test rather than two copies of a guess.
//
// backend/src/shared/permissions.ts uses `import type` for its only import, so
// pulling it in here costs nothing at runtime — no Prisma, no database.
import { PERMISSIONS as BACKEND_PERMISSIONS } from "../../../backend/src/shared/permissions";
import { PERMISSIONS as FRONTEND_PERMISSIONS } from "../lib/permissions";

/**
 * If this fails, someone changed the permission matrix on one side only.
 * Fix the mirror — do not "fix" the test.
 */
describe("permission matrix parity", () => {
  it("covers exactly the same roles on both sides", () => {
    expect(Object.keys(FRONTEND_PERMISSIONS).sort()).toEqual(
      Object.keys(BACKEND_PERMISSIONS).sort()
    );
  });

  it("grants exactly the same permissions per role", () => {
    for (const role of Object.keys(BACKEND_PERMISSIONS) as Array<
      keyof typeof BACKEND_PERMISSIONS
    >) {
      const backend = [...BACKEND_PERMISSIONS[role]].sort();
      const frontend = [...(FRONTEND_PERMISSIONS[role] ?? [])].sort();

      expect(frontend, `role ${role} disagrees between frontend and backend`).toEqual(backend);
    }
  });
});
