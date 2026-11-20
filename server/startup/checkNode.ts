// Side-effect module: import it first so it runs before native modules load.
import { nodeVersionError } from "./nodeVersion";

const problem = nodeVersionError();
if (problem) {
  console.error(problem);
  process.exit(1);
}
