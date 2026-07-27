import { createHash } from "node:crypto";

export function deriveSeed(masterSeed, streamName, version = "0.1.0") {
  const digest = createHash("sha256")
    .update(`${version}\0${masterSeed}\0${streamName}`, "utf8")
    .digest();
  return digest.readUInt32LE(0);
}

export class DeterministicRng {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive deve ser um inteiro positivo.");
    }
    return Math.floor(this.next() * maxExclusive);
  }

  shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(index + 1);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }
}

export function createStream(masterSeed, streamName, version) {
  return new DeterministicRng(deriveSeed(masterSeed, streamName, version));
}
