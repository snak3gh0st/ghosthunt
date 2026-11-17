import { expect, it } from "vitest";
import { runProcess } from "../../src/bounty/process.js";

it("keeps stdout JSON separate from process diagnostics", async () => {
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      'process.stderr.write("notice");process.stdout.write(JSON.stringify({ok:true}))',
    ],
    { cwd: process.cwd() },
  );
  expect(JSON.parse(result.output)).toEqual({ ok: true });
  expect(result.stderr).toBe("notice");
});
it("terminates processes that exceed their deadline", async () => {
  await expect(
    runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      cwd: process.cwd(),
      timeout: 40,
    }),
  ).rejects.toThrow("Tempo máximo");
});
it("caps output and does not interpret shell syntax in arguments", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write(process.argv[1])", "$(echo unsafe);`whoami`"],
    { cwd: process.cwd() },
  );
  expect(result.output).toBe("$(echo unsafe);`whoami`");
  await expect(
    runProcess(
      process.execPath,
      ["-e", 'process.stdout.write("a".repeat(300))'],
      { cwd: process.cwd(), maxBytes: 10 },
    ),
  ).rejects.toThrow("limite");
});
