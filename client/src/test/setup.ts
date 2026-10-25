import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The default 1 s for findBy* queries is tight when server and client
// projects run in parallel on a loaded CI machine.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => cleanup());
