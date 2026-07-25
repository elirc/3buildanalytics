import { apiClient } from "./client";
import type { Role } from "../auth/auth.store";
import type { PagedResponse } from "./events.api";

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function getUsers(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  isActive?: string;
  sortBy?: string;
  sortDir?: string;
}) {
  const query = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((accumulator, [key, value]) => {
      if (value !== undefined && value !== "") accumulator[key] = String(value);
      return accumulator;
    }, {})
  ).toString();

  return apiClient<PagedResponse<AdminUser>>(`/api/users?${query}`);
}

export function createUser(payload: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: Role;
}) {
  return apiClient<AdminUser>("/api/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateUser(
  id: string,
  payload: { firstName?: string; lastName?: string; role?: Role; isActive?: boolean }
) {
  return apiClient<AdminUser>(`/api/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}
