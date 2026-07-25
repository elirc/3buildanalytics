import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import { RequireAuth } from "../auth/RequireAuth";
import { RequireRole } from "../auth/RequireRole";
import { renderWithProviders } from "./helpers/renderWithProviders";

function Protected() {
  return <p>protected content</p>;
}

function LoginScreen() {
  return <p>login screen</p>;
}

function Home() {
  return <p>home</p>;
}

describe("RequireAuth", () => {
  it("renders the child route when a session exists", () => {
    renderWithProviders(
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Protected />} />
        </Route>
        <Route path="/login" element={<LoginScreen />} />
      </Routes>,
      { role: "READ_ONLY" }
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("redirects to /login when signed out", () => {
    renderWithProviders(
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Protected />} />
        </Route>
        <Route path="/login" element={<LoginScreen />} />
      </Routes>,
      { role: null }
    );

    expect(screen.getByText("login screen")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });
});

describe("RequireRole", () => {
  it("renders the child route for an allowed role", () => {
    renderWithProviders(
      <Routes>
        <Route element={<RequireRole roles={["SYSTEM_ADMIN", "ENGINEERING_ADMIN"]} />}>
          <Route path="/monitoring" element={<Protected />} />
        </Route>
        <Route path="/" element={<Home />} />
      </Routes>,
      { role: "ENGINEERING_ADMIN", initialEntries: ["/monitoring"] }
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("redirects to / for a disallowed role", () => {
    renderWithProviders(
      <Routes>
        <Route element={<RequireRole roles={["SYSTEM_ADMIN", "ENGINEERING_ADMIN"]} />}>
          <Route path="/monitoring" element={<Protected />} />
        </Route>
        <Route path="/" element={<Home />} />
      </Routes>,
      { role: "READ_ONLY", initialEntries: ["/monitoring"] }
    );

    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });
});
