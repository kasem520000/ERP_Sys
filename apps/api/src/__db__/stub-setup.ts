import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function stubSetup(): Promise<() => Promise<void>> {
  console.log("STUB SETUP RAN");
  const file = join(tmpdir(), "stub-ran");
  writeFileSync(file, "1");
  return async () => {
    rmSync(file, { force: true });
    console.log("STUB TEARDOWN RAN");
  };
}
