/*
Port of tests from https://github.com/streamich/memfs/tree/master/src/__tests__

*/

import * as tmp from "tmp-promise";
import bind from "../bind";
import { join } from "path";
import fs from "fs/promises";
import fscb from "fs";
import { callback, delay } from "awaiting";

let dir1, dir2, fuse, target;

beforeAll(async () => {
  // Create temporary directories
  dir1 = await tmp.dir({ unsafeCleanup: true });
  dir2 = await tmp.dir({ unsafeCleanup: true });
  fuse = await bind(dir1.path, dir2.path);
  target = dir2.path;
});

afterAll(async () => {
  // Clean up
  await dir1?.cleanup();
  await dir2?.cleanup();
  await fuse?.unmount();
});

async function clean() {
  for (const file of await fs.readdir(target)) {
    await fs.unlink(join(target, file));
  }
}

describe("appendFile(file, data[, options], callback)", () => {
  let path;
  it("Simple write to non-existing file", async () => {
    await clean();
    path = join(target, "test");
    await fs.appendFile(path, "hello");
    expect(await fs.readFile(path, "utf8")).toEqual("hello");
  });
  it("Append to existing file", async () => {
    await fs.appendFile(path, "c");
    expect(await fs.readFile(path, "utf8")).toEqual("helloc");
  });
});

function numHandles() {
  // @ts-ignore this is poking deep into the private api
  const clients = Array.from(fuse.server._wss.clients) as any[];
  if (clients.length != 1) {
    throw Error("assume only one client");
  }
  const handles = clients[0].session._fs._handles;
  //console.log(handles);
  let i = 0;
  for (const handle of handles) {
    if (handle != null) {
      i += 1;
    }
  }
  return i;
}

describe(".close(fd)", () => {
  it("Closes file without errors", async () => {
    const fd = await fs.open(join(target, "test.txt"), "w");
    await fd.close();
  });

  it("Closing same file descriptor twice throws EBADF", async () => {
    const fd = await callback(fscb.open, join(target, "test.txt"), "w");
    await callback(fscb.close, fd);
    expect(async () => {
      await callback(fscb.close, fd);
    }).rejects.toThrow("EBADF");
  });

  it("Closing a file decreases the number of open files", async () => {
    const fd = await fs.open(join(target, "test.txt"), "w");
    const before = numHandles();
    await fd.close();
    // NOTE: it doesn't get freed on server instantly.
    await delay(100);
    const after = numHandles();
    expect(after).toBe(before - 1);
  });
});



describe("renameSync(fromPath, toPath)", () => {
  it("Renames a simple case", async () => {
    await clean();
    await fs.writeFile(join(target, "foo"), "bar");
    await fs.rename(join(target, "foo"), join(target, "foo2"));
    expect(await fs.readdir(target)).toEqual(["foo2"]);
  });
});
