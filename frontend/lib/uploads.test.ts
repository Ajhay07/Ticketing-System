import { describe, expect, it } from "vitest";
import { addFiles, fileProblem, MAX_FILES_PER_TICKET, runWithConcurrency } from "./uploads";

const f = (name: string, size = 100, lastModified = 1) => ({ name, size, lastModified });

describe("fileProblem (per-file)", () => {
  it("accepts allowed types within size", () => {
    expect(fileProblem(f("report.PDF"))).toBeNull();
    expect(fileProblem(f("photo.jpeg", 25 * 1024 * 1024))).toBeNull();
  });
  it("rejects empty, oversize and disallowed files", () => {
    expect(fileProblem(f("a.pdf", 0))).toMatch(/empty/);
    expect(fileProblem(f("a.pdf", 25 * 1024 * 1024 + 1))).toMatch(/25 MB/);
    expect(fileProblem(f("run.exe"))).toMatch(/not an allowed/);
    expect(fileProblem(f("noext"))).toMatch(/not an allowed/);
  });
});

describe("addFiles", () => {
  it("validates each file independently: good files are kept when others fail", () => {
    const { files, errors } = addFiles([], [f("a.pdf"), f("evil.exe"), f("b.png"), f("huge.zip", 26 * 1024 * 1024)]);
    expect(files.map((x) => x.name)).toEqual(["a.pdf", "b.png"]);
    expect(errors).toHaveLength(2);
  });
  it("skips exact duplicates", () => {
    const first = addFiles([], [f("a.pdf")]).files;
    const { files, errors } = addFiles(first, [f("a.pdf")]);
    expect(files).toHaveLength(1);
    expect(errors[0]).toMatch(/already attached/);
  });
  it(`caps the list at ${MAX_FILES_PER_TICKET} files`, () => {
    const many = Array.from({ length: 12 }, (_, i) => f(`f${i}.pdf`, 10, i));
    const { files, errors } = addFiles([], many);
    expect(files).toHaveLength(MAX_FILES_PER_TICKET);
    expect(errors).toHaveLength(2);
  });
});

describe("runWithConcurrency", () => {
  it("never has more than `limit` workers in flight and finishes every item despite failures", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (n === 4) throw new Error("boom");
      done.push(n);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 5, 6, 7]);
  });
});
