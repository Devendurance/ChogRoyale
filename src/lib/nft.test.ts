import { describe, it, expect } from "vitest";
import { parseTokenId } from "@/lib/nft-contract";
import { resolveMetadata, METADATA_MAX_BYTES } from "@/lib/metadata";

const fixtureDoc = {
  name: "CHOG #1",
  description: "Test fixture",
  image: "ipfs://bafyimage/1.webp",
  attributes: [
    { trait_type: "Background", value: "Deep Aqua" },
    { trait_type: "Background", value: "Deep Aqua" },
    { trait_type: "Mystery", value: 42 },
    { trait_type: "Nested", value: { strange: ["a", 1, null] } },
    { trait_type: "Missing", value: null },
  ],
  unknownTopLevel: { keep: true },
};

const dataUri = (doc: unknown) =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`;

describe("parseTokenId", () => {
  it("accepts decimal strings and safe numbers", () => {
    expect(parseTokenId("1")).toBe(BigInt(1));
    expect(parseTokenId("007")).toBe(BigInt(7));
  });

  it("rejects non-numeric, negative, hex and oversized input", () => {
    for (const bad of ["", "abc", "-1", "0x1", "1.5", "1e3", "9".repeat(79), null, undefined, {}, []]) {
      expect(() => parseTokenId(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("resolveMetadata data URIs", () => {
  it("preserves original traits exactly, including duplicates and odd values", async () => {
    const resolved = await resolveMetadata(dataUri(fixtureDoc));
    expect(resolved.name).toBe("CHOG #1");
    expect(resolved.imageOriginal).toBe("ipfs://bafyimage/1.webp");
    expect(resolved.attributesOriginal).toEqual(fixtureDoc.attributes);
    expect((resolved.document as Record<string, unknown>).unknownTopLevel).toEqual({ keep: true });
    expect(resolved.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tolerates missing name/image with nulls", async () => {
    const resolved = await resolveMetadata(dataUri({ attributes: [] }));
    expect(resolved.name).toBeNull();
    expect(resolved.imageOriginal).toBeNull();
    expect(resolved.attributesOriginal).toEqual([]);
  });

  it("rejects malformed JSON and non-object documents", async () => {
    await expect(resolveMetadata("data:application/json;base64,!!!")).rejects.toMatchObject({
      code: "UNPROCESSABLE",
    });
    await expect(resolveMetadata(dataUri([1, 2, 3]))).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(resolveMetadata(dataUri("just a string"))).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("rejects oversized documents", async () => {
    const big = `data:application/json;base64,${Buffer.alloc(METADATA_MAX_BYTES + 1).toString("base64")}`;
    await expect(resolveMetadata(big)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
});

describe("resolveMetadata URI safety", () => {
  it("rejects unsupported schemes without network access", async () => {
    await expect(resolveMetadata("ftp://example.com/meta.json")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(resolveMetadata("http://example.com/meta.json")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(resolveMetadata("ipfs://../escape.json")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects private-network destinations", async () => {
    await expect(resolveMetadata("https://127.0.0.1/meta.json")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
