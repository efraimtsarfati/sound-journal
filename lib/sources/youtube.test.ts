import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveTitleArtist,
  fetchOEmbed,
  parseTimeParam,
  parseYouTubeUrl,
  youtubeWatchUrl,
  YouTubeError,
} from "./youtube";

const ID = "dQw4w9WgXcQ";
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "__fixtures__", name), "utf8"));

describe("parseTimeParam", () => {
  it.each([
    ["90", 90],
    ["90s", 90],
    ["1m30s", 90],
    ["1h2m3s", 3723],
    ["2m", 120],
    ["12.7", 12],
  ])("%s -> %s", (raw, sec) => expect(parseTimeParam(raw)).toBe(sec));
  it.each(["", "abc", "1x", "m", null, undefined])("rejects %s", (raw) => expect(parseTimeParam(raw)).toBeNull());
});

describe("parseYouTubeUrl", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, null],
    [`https://youtube.com/watch?v=${ID}&t=75`, 75],
    [`https://www.youtube.com/watch?t=1m15s&v=${ID}`, 75],
    [`https://m.youtube.com/watch?v=${ID}&t=75s`, 75],
    [`https://music.youtube.com/watch?v=${ID}&si=abc`, null],
    [`https://youtu.be/${ID}`, null],
    [`https://youtu.be/${ID}?t=30`, 30],
    [`https://youtu.be/${ID}?si=xyz&t=1h1m1s`, 3661],
    [`https://www.youtube.com/embed/${ID}?start=12`, 12],
    [`https://www.youtube.com/shorts/${ID}`, null],
    [`https://www.youtube.com/watch?v=${ID}#t=45`, 45],
    [`www.youtube.com/watch?v=${ID}`, null],
    [`  https://youtu.be/${ID}  `, null],
    [`https://www.youtube.com/watch?v=${ID}&list=PL123&index=2&t=5`, 5],
  ])("parses %s", (input, startSec) => {
    expect(parseYouTubeUrl(input)).toEqual({ videoId: ID, startSec });
  });

  it.each([
    "",
    "not a url",
    "https://example.com/watch?v=" + ID,
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@someone",
    "https://notyoutube.com/watch?v=" + ID,
    "https://youtube.com.evil.test/watch?v=" + ID,
    "javascript:alert(1)",
    "ftp://youtu.be/" + ID,
  ])("rejects %s", (input) => expect(parseYouTubeUrl(input)).toBeNull());

  it("ignores an unparseable t= rather than guessing", () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=soon`)).toEqual({ videoId: ID, startSec: null });
  });
});

describe("youtubeWatchUrl", () => {
  it("builds canonical and timestamped links", () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(youtubeWatchUrl(ID, 75.9)).toBe(`https://www.youtube.com/watch?v=${ID}&t=75s`);
    expect(youtubeWatchUrl(ID, 0)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

describe("fetchOEmbed", () => {
  const respond = (status: number, body?: unknown) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  });

  it("returns raw title and channel from a recorded response", async () => {
    let requested = "";
    const res = await fetchOEmbed(ID, {
      fetch: async (url) => {
        requested = url;
        return respond(200, fixture("oembed-official-video.json"))();
      },
    });
    expect(res).toEqual({
      rawTitle: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
      rawChannel: "Rick Astley",
    });
    expect(requested).toContain("https://www.youtube.com/oembed?");
    expect(decodeURIComponent(requested)).toContain(`url=https://www.youtube.com/watch?v=${ID}`);
  });

  it("maps statuses to typed errors", async () => {
    await expect(fetchOEmbed(ID, { fetch: respond(404) })).rejects.toMatchObject({ code: "not_found" });
    await expect(fetchOEmbed(ID, { fetch: respond(401) })).rejects.toMatchObject({ code: "not_embeddable" });
    await expect(fetchOEmbed(ID, { fetch: respond(403) })).rejects.toMatchObject({ code: "not_embeddable" });
    await expect(fetchOEmbed(ID, { fetch: respond(500) })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("treats network failure, bad JSON and a missing title as unavailable", async () => {
    await expect(
      fetchOEmbed(ID, {
        fetch: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toBeInstanceOf(YouTubeError);
    await expect(fetchOEmbed(ID, { fetch: respond(200) })).rejects.toMatchObject({ code: "unavailable" });
    await expect(fetchOEmbed(ID, { fetch: respond(200, { author_name: "x" }) })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("deriveTitleArtist", () => {
  it("splits artist - title and strips noise (recorded response)", () => {
    const f = fixture("oembed-official-video.json");
    expect(deriveTitleArtist(f.title, f.author_name)).toEqual({
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
    });
  });

  it("uses a Topic channel as the artist (recorded-shape response)", () => {
    const f = fixture("oembed-topic-channel.json");
    expect(deriveTitleArtist(f.title, f.author_name)).toEqual({ title: "Leave Me Alone", artist: "New Order" });
  });

  it("drops a title prefix that repeats the Topic artist", () => {
    expect(deriveTitleArtist("New Order - Leave Me Alone", "New Order - Topic")).toEqual({
      title: "Leave Me Alone",
      artist: "New Order",
    });
  });

  it("keeps the whole title when the Topic channel and title prefix disagree", () => {
    expect(deriveTitleArtist("Live - Something", "Band - Topic")).toEqual({ title: "Live - Something", artist: "Band" });
  });

  it.each([
    ["Artist - Song (Official Audio)", "Song", "Artist"],
    ["Artist - Song [Official Video]", "Song", "Artist"],
    ["Artist - Song (Lyrics)", "Song", "Artist"],
    ["Artist - Song (Remastered 2011)", "Song", "Artist"],
    ["Artist - Song (2011 Remaster)", "Song", "Artist"],
    ["Artist - Song (1986)", "Song", "Artist"],
    ["Artist - Song - Remastered 2015", "Song", "Artist"],
    ["Artist - Song | Official Audio", "Song", "Artist"],
    ["Artist – Song", "Song", "Artist"],
    ["Artist - Song (Official Video) [HD]", "Song", "Artist"],
  ])("cleans %s", (raw, title, artist) => {
    expect(deriveTitleArtist(raw, "Some Channel")).toEqual({ title, artist });
  });

  it("keeps meaningful brackets", () => {
    expect(deriveTitleArtist("Artist - Song (feat. Someone)", "c")).toEqual({
      title: "Song (feat. Someone)",
      artist: "Artist",
    });
    expect(deriveTitleArtist("Artist - Song (Live at Wembley)", "c").title).toBe("Song (Live at Wembley)");
  });

  it("never turns an ordinary channel into the artist", () => {
    expect(deriveTitleArtist("Some Song (Official Video)", "RandomUploader")).toEqual({
      title: "Some Song",
      artist: null,
    });
  });

  it("splits only on the first ' - ' and keeps hyphenated words intact", () => {
    expect(deriveTitleArtist("Jay-Z - Song - Part 2", "c")).toEqual({ title: "Song - Part 2", artist: "Jay-Z" });
  });

  it("falls back to the raw title if cleaning empties it", () => {
    expect(deriveTitleArtist("(Official Video)", "c").title).toBe("(Official Video)");
  });
});
