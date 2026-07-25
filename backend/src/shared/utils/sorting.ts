import { AppError } from "../errors/AppError.js";
import { ERROR_CODES } from "../errors/errorCodes.js";

export type SortDirection = "asc" | "desc";

/**
 * Resolves a caller-supplied sort into a Prisma orderBy.
 *
 * The column is matched against an explicit allowlist and never interpolated.
 * `orderBy` is one of the few places Prisma will happily accept an arbitrary
 * key, so an unchecked `sortBy` is a direct path from query string to query
 * plan. Anything not on the list is a 400, not a silent fallback — a caller who
 * asked to sort by something we do not support should be told, not quietly
 * given a different answer.
 */
export function resolveSort<TColumn extends string>(input: {
  sortBy?: string;
  sortDir?: string;
  allowed: readonly TColumn[];
  defaultColumn: TColumn;
  defaultDirection?: SortDirection;
}): { column: TColumn; direction: SortDirection } {
  const direction = resolveDirection(input.sortDir, input.defaultDirection ?? "desc");

  if (input.sortBy === undefined || input.sortBy === "") {
    return { column: input.defaultColumn, direction };
  }

  if (!input.allowed.includes(input.sortBy as TColumn)) {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      `Cannot sort by "${input.sortBy}". Allowed: ${input.allowed.join(", ")}`,
      400
    );
  }

  return { column: input.sortBy as TColumn, direction };
}

function resolveDirection(value: string | undefined, fallback: SortDirection): SortDirection {
  if (value === undefined || value === "") {
    return fallback;
  }

  if (value !== "asc" && value !== "desc") {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'sortDir must be "asc" or "desc"', 400);
  }

  return value;
}

/** total/pageSize, floored at 1 so an empty result still reports one page. */
export function toPageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}
