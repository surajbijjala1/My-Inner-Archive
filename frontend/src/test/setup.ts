import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Every test starts from an empty device: no token, no draft, no settings.
afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
