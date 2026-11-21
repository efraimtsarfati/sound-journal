import { describe, expect, it } from "vitest";
import { CoreError } from "./errors";
import { isStatusLikeTag, normalizeArtistName, normalizeTagName } from "./text";

describe("normalizeArtistName", () => {
  it("lowercases, strips accents and punctuation, collapses spaces, drops a leading the", () => {
    expect(normalizeArtistName("  Sigur   Rós ")).toBe("sigur ros");
    expect(normalizeArtistName("The Smiths")).toBe("smiths");
    expect(normalizeArtistName("AC/DC")).toBe("acdc");
    expect(normalizeArtistName("Guns N' Roses")).toBe("guns n roses");
    expect(normalizeArtistName("Beyoncé")).toBe("beyonce");
  });

  it("keeps a lone 'The' and names that are all punctuation", () => {
    expect(normalizeArtistName("The")).toBe("the");
    expect(normalizeArtistName("The The")).toBe("the");
    expect(normalizeArtistName("!!!")).toBe("!!!");
  });

  it("keeps non-Latin letters", () => {
    expect(normalizeArtistName("坂本龍一")).toBe("坂本龍一");
  });
});

describe("status-like tag names", () => {
  it("are refused in every spelling", () => {
    for (const n of ["needs_why", "Needs Why", "needs-tags", "tagged", " TAGGED "]) {
      expect(isStatusLikeTag(n), n).toBe(true);
      expect(() => normalizeTagName(n), n).toThrow(CoreError);
    }
    expect(normalizeTagName("tagged-out").slug).toBe("tagged-out");
  });
});
