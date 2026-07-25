import { fireEvent, render, screen } from "@testing-library/react";

import { Pagination } from "../components/Pagination";

function setup(overrides: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();

  render(
    <Pagination
      page={2}
      pageSize={25}
      total={130}
      pageCount={6}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      {...overrides}
    />
  );

  return { onPageChange, onPageSizeChange };
}

describe("Pagination", () => {
  it("describes the visible slice in human terms", () => {
    setup();
    expect(screen.getByText("Showing 26–50 of 130")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 6")).toBeInTheDocument();
  });

  it("clamps the last row to the total on a partial final page", () => {
    setup({ page: 6, total: 130, pageCount: 6 });
    expect(screen.getByText("Showing 126–130 of 130")).toBeInTheDocument();
  });

  it("disables Previous on the first page", () => {
    setup({ page: 1 });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next on the last page", () => {
    setup({ page: 6, pageCount: 6 });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("reports no results rather than 'showing 0-0 of 0'", () => {
    setup({ page: 1, total: 0, pageCount: 1 });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("emits the neighbouring page when navigating", () => {
    const { onPageChange } = setup({ page: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("emits a numeric page size", () => {
    const { onPageSizeChange } = setup();

    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "100" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
  });
});
