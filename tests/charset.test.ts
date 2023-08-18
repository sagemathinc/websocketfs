import assert = require("assert");
import util = require("../lib/charsets");

import Encoding = util.Encoding;

var UTF8 = Encoding.UTF8;

describe("Encoding Tests", function () {
  beforeAll((done) => {
    done();
  });

  afterAll((done) => {
    done();
  });

  // incomplete chunks
  var chunk1 = Buffer.from([
    0xc5, 0xbd, 0x6c, 0x75, 0xc5, 0xa5, 0x6f, 0x75, 0xc4, 0x8d, 0x6b, 0xc3,
    0xbd, 0x20, 0x6b, 0xc5,
  ]); // "Žluťoučký k" + incomplete 'ů'
  var text1 = "Žluťoučký k";
  var chunk2 = Buffer.from([
    0xaf, 0xc5, 0x88, 0x20, 0xc3, 0xba, 0x70, 0xc4, 0x9b, 0x6c, 0x20, 0xc4,
  ]); // incomplete 'ů' + "ň úpěl " + incomplete 'ď'
  var text2 = "ň úpěl ";
  var chunk3 = Buffer.from([
    0x8f, 0xc3, 0xa1, 0x62, 0x65, 0x6c, 0x73, 0x6b, 0xc3, 0xa9, 0x20, 0xc3,
    0xb3, 0x64, 0x79,
  ]); // incomplete 'ď' + "ábelské ódy"

  // mix of two-byte and one-byte characters
  var chunk4 = Buffer.concat([chunk1, chunk2, chunk3]);
  var text4 = "Žluťoučký kůň úpěl ďábelské ódy";

  // three-byte characters
  var chunk5 = Buffer.from([
    0xe6, 0xad, 0xbb, 0xe9, 0xa9, 0xac, 0xe5, 0xbd, 0x93, 0xe6, 0xb4, 0xbb,
    0xe9, 0xa9, 0xac, 0xe5, 0x8c, 0xbb,
  ]);
  var text5 = "死马当活马医";

  // surrogate pairs
  var chunk6 = Buffer.from([
    0xf0, 0xa0, 0x9c, 0x8e, 0xf0, 0xa0, 0x9d, 0xb9, 0xf0, 0xa0, 0xb3, 0x8f,
    0xf0, 0xa1, 0x81, 0xbb, 0xf0, 0xa9, 0xb6, 0x98,
  ]);
  var text6 = "𠜎𠝹𠳏𡁻𩶘";

  var BAD_CHAR = String.fromCharCode(0xfffd); // REPLACEMENT_CHAR

  function assertEqualContents(actual: Buffer, expected: Buffer): void {
    var len = Math.min(actual.length, expected.length);
    var same = true;

    if (actual.length != expected.length) {
      same = false;
    } else {
      for (var i = 0; i < len; i++) {
        if (actual[i] != expected[i]) {
          same = false;
          break;
        }
      }
    }

    if (!same) assert.equal(actual, expected);
  }

  it("encode2byte", () => {
    var buffer = Buffer.alloc(1024);
    var count = UTF8.encode(text4, buffer, 0);
    var actual = buffer.slice(0, count);
    assertEqualContents(actual, chunk4);
  });

  it("encode3byte", () => {
    var buffer = Buffer.alloc(1024);
    var count = UTF8.encode(text5, buffer, 0);
    var actual = buffer.slice(0, count);
    assertEqualContents(actual, chunk5);
  });

  it("encode4byte", () => {
    var buffer = Buffer.alloc(1024);
    var count = UTF8.encode(text6, buffer, 0);
    var actual = buffer.slice(0, count);
    assertEqualContents(actual, chunk6);
  });

  it("encodeTooLong", () => {
    var buffer = Buffer.alloc(1024);
    var count = UTF8.encode(text6, buffer, 0, 3);
    assert.equal(count, -1);
  });

  it("encodeChunked", () => {
    var buffer = Buffer.alloc(1024);
    var encoder = UTF8.getEncoder(text6);
    var offset = 0;
    [3, 6, 7, 4].forEach((bytes) => {
      var count = encoder.read(buffer, offset, offset + bytes);
      assert.equal(count, bytes);
      assertEqualContents(
        buffer.slice(offset, offset + count),
        chunk6.slice(offset, offset + count),
      );
      offset += count;
    });
  });

  it("decode2byte", () => {
    var actual = UTF8.decode(chunk4, 0, chunk4.length);
    assert.equal(actual, text4);
  });

  it("decode3byte", () => {
    var actual = UTF8.decode(chunk5, 0, chunk5.length);
    assert.equal(actual, text5);
  });

  it("decode4byte", () => {
    var actual = UTF8.decode(chunk6, 0, chunk6.length);
    assert.equal(actual, text6);
  });

  it("decodeIncompleteEnd", () => {
    var actual = UTF8.decode(chunk1, 0, chunk1.length);
    assert.equal(actual, text1 + BAD_CHAR);
  });

  it("decodeIncompleteBoth", () => {
    var actual = UTF8.decode(chunk2, 0, chunk2.length);
    assert.equal(actual, BAD_CHAR + text2 + BAD_CHAR);
  });

  it("decodeWithState", () => {
    var decoder = UTF8.getDecoder();

    decoder.write(chunk1, 0, chunk1.length);
    decoder.write(chunk2, 0, chunk2.length);
    decoder.write(chunk3, 0, chunk3.length);

    var actual = decoder.text();
    assert.equal(actual, text4);
  });
});
