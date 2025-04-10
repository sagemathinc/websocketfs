import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readFileLz4, writeFileLz4 } from "./util";

describe("test compression using writeFileLz4 is compatible with command line lz4", () => {
  it("compression output is compatible with lz4 tool and content is 'hello'", async () => {
    // Write "hello" to a temporary file ending in .lz4
    const tempFilePath = join(tmpdir(), `tempfile.lz4`);
    try {
      const content = "hello websocketfs!";
      await writeFileLz4(tempFilePath, content);
      const read = await readFileLz4(tempFilePath);
      expect(read.toString()).toEqual(content);
    } finally {
      // Clean up the temporary file
      await unlink(tempFilePath);
    }
  });
});
