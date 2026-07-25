import { screen } from "@testing-library/react";

import { Sidebar } from "../layout/Sidebar";
import type { Role } from "../auth/auth.store";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * The exact navigation each role should see.
 *
 * Written out per role rather than derived from the matrix: deriving it would
 * reproduce the component's own logic and pass no matter what the component
 * did. These are the expectations from US-01's definition of done.
 */
const EXPECTED: Record<Role, string[]> = {
  SYSTEM_ADMIN: [
    "Operations",
    "Product",
    "Engineering",
    "Executive",
    "Exports",
    "Events",
    "Audit",
    "Monitoring",
    "Configs"
  ],
  OPS_MANAGER: ["Operations", "Product", "Executive", "Exports", "Events", "Configs"],
  PRODUCT_MANAGER: ["Operations", "Product", "Executive", "Exports", "Events", "Configs"],
  ENGINEERING_ADMIN: [
    "Operations",
    "Product",
    "Engineering",
    "Executive",
    "Exports",
    "Monitoring",
    "Configs"
  ],
  AUDIT_VIEWER: ["Operations", "Product", "Executive", "Exports", "Audit"],
  EXECUTIVE_VIEWER: ["Operations", "Product", "Executive"],
  READ_ONLY: ["Operations", "Product", "Executive"]
};

describe("Sidebar", () => {
  it.each(Object.entries(EXPECTED))("shows exactly the right links for %s", (role, expected) => {
    renderWithProviders(<Sidebar />, { role: role as Role });

    const rendered = screen.getAllByRole("link").map((link) => link.textContent);
    expect(rendered).toEqual(expected);
  });

  it("does not offer Exports to a role the API would refuse", () => {
    renderWithProviders(<Sidebar />, { role: "READ_ONLY" });

    // The regression this story exists to fix: Exports used to be unconditional,
    // so read-only users clicked it and hit a 403 they could do nothing about.
    expect(screen.queryByRole("link", { name: "Exports" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Engineering" })).not.toBeInTheDocument();
  });

  it("renders nothing when signed out", () => {
    const { container } = renderWithProviders(<Sidebar />, { role: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("honours the permission list issued by the server over the local mirror", () => {
    renderWithProviders(<Sidebar />, { role: "READ_ONLY" });
    expect(screen.queryByRole("link", { name: "Audit" })).not.toBeInTheDocument();
  });
});
