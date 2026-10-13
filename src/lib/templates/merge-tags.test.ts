import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findMalformedMergeTags,
  findMergeTags,
  formatMergeTag,
  isBuiltInMergeTag,
  suggestBuiltInMergeTag,
  toCustomFieldKey,
} from "./merge-tags";

describe("findMergeTags", () => {
  it("finds tags with and without fallbacks", () => {
    const tags = findMergeTags("Hi {{ first_name | there }}, {{fields.company}} {{plan|}}");
    assert.deepEqual(
      tags.map(({ key, fallback, raw }) => ({ key, fallback, raw })),
      [
        { key: "first_name", fallback: "there", raw: "{{ first_name | there }}" },
        { key: "fields.company", fallback: null, raw: "{{fields.company}}" },
        { key: "plan", fallback: "", raw: "{{plan|}}" },
      ],
    );
    assert.equal(tags[0].index, 3);
  });
});

describe("findMalformedMergeTags", () => {
  it("returns nothing for valid tags", () => {
    assert.deepEqual(findMalformedMergeTags("{{a}} {{ b | c }} {{fields.x-y}}"), []);
  });

  it("finds tags that won't render", () => {
    assert.deepEqual(findMalformedMergeTags("{{first name}} {{ok}} {{last_name} {{"), [
      "{{first name}}",
      "{{last_name}",
      "{{",
    ]);
  });

  it("truncates long snippets", () => {
    const [snippet] = findMalformedMergeTags(`{{${"x ".repeat(40)}}}`);
    assert.ok(snippet.endsWith("…"));
    assert.ok(snippet.length <= 41);
  });
});

describe("isBuiltInMergeTag / suggestBuiltInMergeTag", () => {
  it("recognises built-ins case-insensitively", () => {
    assert.equal(isBuiltInMergeTag("first_name"), true);
    assert.equal(isBuiltInMergeTag("UNSUBSCRIBE_URL"), true);
    assert.equal(isBuiltInMergeTag("company"), false);
  });

  it("suggests built-ins for common typos and aliases", () => {
    assert.equal(suggestBuiltInMergeTag("firstname"), "first_name");
    assert.equal(suggestBuiltInMergeTag("First-Name"), "first_name");
    assert.equal(suggestBuiltInMergeTag("unsubscribe"), "unsubscribe_url");
    assert.equal(suggestBuiltInMergeTag("fname"), "first_name");
    assert.equal(suggestBuiltInMergeTag("company"), null);
    assert.equal(suggestBuiltInMergeTag("first_name"), null);
  });
});

describe("formatMergeTag", () => {
  it("formats with and without a fallback", () => {
    assert.equal(formatMergeTag("first_name"), "{{first_name}}");
    assert.equal(formatMergeTag("first_name", "  there "), "{{first_name | there}}");
    assert.equal(formatMergeTag("x", "a}}b{"), "{{x | ab}}");
    assert.equal(formatMergeTag("x", "   "), "{{x}}");
  });
});

describe("toCustomFieldKey", () => {
  it("normalises free-form input", () => {
    assert.equal(toCustomFieldKey("company"), "company");
    assert.equal(toCustomFieldKey(" fields.company "), "company");
    assert.equal(toCustomFieldKey("Home city"), "Home_city");
    assert.equal(toCustomFieldKey("plan-tier!"), "plan-tier");
    assert.equal(toCustomFieldKey("{{ }}"), "");
    assert.equal(toCustomFieldKey("{{fields.plan}}"), "plan");
    assert.equal(toCustomFieldKey("__"), "");
    assert.equal(toCustomFieldKey(".a.b."), "a.b");
  });
});
