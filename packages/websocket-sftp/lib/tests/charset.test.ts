import assert from "assert";
import * as util from "../charsets";

import Encoding = util.Encoding;

const UTF8 = Encoding.UTF8;

describe("Encoding Tests", function () {
  beforeAll((done) => {
    done();
  });

  afterAll((done) => {
    done();
  });

  // incomplete chunks
  const chunk1 = Buffer.from([
    0xc5, 0xbd, 0x6c, 0x75, 0xc5, 0xa5, 0x6f, 0x75, 0xc4, 0x8d, 0x6b, 0xc3,
    0xbd, 0x20, 0x6b, 0xc5,
  ]); // "Žluťoučký k" + incomplete 'ů'
  const text1 = "Žluťoučký k";
  const chunk2 = Buffer.from([
    0xaf, 0xc5, 0x88, 0x20, 0xc3, 0xba, 0x70, 0xc4, 0x9b, 0x6c, 0x20, 0xc4,
  ]); // incomplete 'ů' + "ň úpěl " + incomplete 'ď'
  const text2 = "ň úpěl ";
  const chunk3 = Buffer.from([
    0x8f, 0xc3, 0xa1, 0x62, 0x65, 0x6c, 0x73, 0x6b, 0xc3, 0xa9, 0x20, 0xc3,
    0xb3, 0x64, 0x79,
  ]); // incomplete 'ď' + "ábelské ódy"

  // mix of two-byte and one-byte characters
  const chunk4 = Buffer.concat([chunk1, chunk2, chunk3]);
  const text4 = "Žluťoučký kůň úpěl ďábelské ódy";

  // three-byte characters
  const chunk5 = Buffer.from([
    0xe6, 0xad, 0xbb, 0xe9, 0xa9, 0xac, 0xe5, 0xbd, 0x93, 0xe6, 0xb4, 0xbb,
    0xe9, 0xa9, 0xac, 0xe5, 0x8c, 0xbb,
  ]);
  const text5 = "死马当活马医";

  // surrogate pairs
  const chunk6 = Buffer.from([
    0xf0, 0xa0, 0x9c, 0x8e, 0xf0, 0xa0, 0x9d, 0xb9, 0xf0, 0xa0, 0xb3, 0x8f,
    0xf0, 0xa1, 0x81, 0xbb, 0xf0, 0xa9, 0xb6, 0x98,
  ]);
  const text6 = "𠜎𠝹𠳏𡁻𩶘";

  const BAD_CHAR = String.fromCharCode(0xfffd); // REPLACEMENT_CHAR

  function assertEqualContents(actual: Buffer, expected: Buffer): void {
    const len = Math.min(actual.length, expected.length);
    let same = true;

    if (actual.length != expected.length) {
      same = false;
    } else {
      for (let i = 0; i < len; i++) {
        if (actual[i] != expected[i]) {
          same = false;
          break;
        }
      }
    }

    if (!same) assert.equal(actual, expected);
  }

  it("encode2byte", () => {
    const buffer = Buffer.alloc(1024);
    const count = UTF8.encode(text4, buffer, 0);
    const actual = buffer.slice(0, count);
    assertEqualContents(actual, chunk4);
  });

  it("encode3byte", () => {
    const buffer = Buffer.alloc(1024);
    const count = UTF8.encode(text5, buffer, 0);
    const actual = buffer.slice(0, count);
    assertEqualContents(actual, chunk5);
  });

  it("encode4byte", () => {
    const buffer = Buffer.alloc(1024);
    const count = UTF8.encode(text6, buffer, 0);
    const actual = buffer.slice(0, count);
    assertEqualContents(actual, chunk6);
  });

  it("encodeTooLong", () => {
    const buffer = Buffer.alloc(1024);
    const count = UTF8.encode(text6, buffer, 0, 3);
    assert.equal(count, -1);
  });

  it("encodeChunked", () => {
    const buffer = Buffer.alloc(1024);
    const encoder = UTF8.getEncoder(text6);
    let offset = 0;
    [3, 6, 7, 4].forEach((bytes) => {
      const count = encoder.read(buffer, offset, offset + bytes);
      assert.equal(count, bytes);
      assertEqualContents(
        buffer.slice(offset, offset + count),
        chunk6.slice(offset, offset + count),
      );
      offset += count;
    });
  });

  it("decode2byte", () => {
    const actual = UTF8.decode(chunk4, 0, chunk4.length);
    assert.equal(actual, text4);
  });

  it("decode3byte", () => {
    const actual = UTF8.decode(chunk5, 0, chunk5.length);
    assert.equal(actual, text5);
  });

  it("decode4byte", () => {
    const actual = UTF8.decode(chunk6, 0, chunk6.length);
    assert.equal(actual, text6);
  });

  it("decodeIncompleteEnd", () => {
    const actual = UTF8.decode(chunk1, 0, chunk1.length);
    assert.equal(actual, text1 + BAD_CHAR);
  });

  it("decodeIncompleteBoth", () => {
    const actual = UTF8.decode(chunk2, 0, chunk2.length);
    assert.equal(actual, BAD_CHAR + text2 + BAD_CHAR);
  });

  it("decodeWithState", () => {
    const decoder = UTF8.getDecoder();

    decoder.write(chunk1, 0, chunk1.length);
    decoder.write(chunk2, 0, chunk2.length);
    decoder.write(chunk3, 0, chunk3.length);

    const actual = decoder.text();
    assert.equal(actual, text4);
  });
});
