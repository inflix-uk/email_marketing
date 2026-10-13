import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  detectColumnTarget,
  mapRows,
  MAX_INVALID_EXAMPLES,
  parseCsv,
  splitFullName,
  suggestMapping,
  validateMapping,
  type ColumnMapping,
} from "./import";

describe("parseCsv", () => {
  test("splits the header row from the data rows", () => {
    const { headers, rows } = parseCsv("Email,Name\njane@example.com,Jane Doe\nbob@example.com,Bob\n");
    assert.deepEqual(headers, ["Email", "Name"]);
    assert.deepEqual(rows, [
      ["jane@example.com", "Jane Doe"],
      ["bob@example.com", "Bob"],
    ]);
  });

  test("strips a UTF-8 BOM and trims headers", () => {
    const { headers } = parseCsv(String.fromCharCode(0xfeff) + " Email , First name\nx@y.io,X");
    assert.deepEqual(headers, ["Email", "First name"]);
  });

  test("handles quoted cells with commas and newlines", () => {
    const { rows } = parseCsv('email,note\njane@example.com,"Hello, world\nsecond line"');
    assert.deepEqual(rows, [["jane@example.com", "Hello, world\nsecond line"]]);
  });

  test("detects semicolon-delimited files", () => {
    const { headers, rows } = parseCsv("email;first name\njane@example.com;Jane");
    assert.deepEqual(headers, ["email", "first name"]);
    assert.deepEqual(rows, [["jane@example.com", "Jane"]]);
  });

  test("skips blank lines and names blank headers", () => {
    const { headers, rows } = parseCsv("email,\n\njane@example.com,x\n   \n");
    assert.deepEqual(headers, ["email", "Column 2"]);
    assert.equal(rows.length, 1);
  });

  test("returns nothing for an empty file", () => {
    assert.deepEqual(parseCsv(""), { headers: [], rows: [] });
  });
});

describe("detectColumnTarget", () => {
  const cases: [string, string][] = [
    ["email", "email"],
    ["E-mail", "email"],
    ["Email Address", "email"],
    ["EMAIL_ADDRESS", "email"],
    ["First name", "first_name"],
    ["firstname", "first_name"],
    ["Given Name", "first_name"],
    ["Last Name", "last_name"],
    ["Surname", "last_name"],
    ["Name", "full_name"],
    ["Full name", "full_name"],
    ["Company", "field"],
    ["Email opt-in date", "field"],
  ];
  for (const [header, expected] of cases) {
    test(`${JSON.stringify(header)} -> ${expected}`, () => assert.equal(detectColumnTarget(header), expected));
  }
});

describe("suggestMapping", () => {
  test("maps known headers and turns the rest into slugified custom fields", () => {
    assert.deepEqual(suggestMapping(["Email Address", "First Name", "Surname", "Company Name", "City"]), [
      { target: "email" },
      { target: "first_name" },
      { target: "last_name" },
      { target: "field", fieldKey: "company_name" },
      { target: "field", fieldKey: "city" },
    ]);
  });

  test("splits a Name column when there are no first/last name columns", () => {
    assert.deepEqual(suggestMapping(["Name", "Email"]), [{ target: "full_name" }, { target: "email" }]);
  });

  test("keeps a Name column as a custom field when first/last names exist", () => {
    assert.deepEqual(suggestMapping(["First name", "Last name", "Name", "Email"]), [
      { target: "first_name" },
      { target: "last_name" },
      { target: "field", fieldKey: "name" },
      { target: "email" },
    ]);
  });

  test("uses only the first email column and never suggests a reserved field name", () => {
    const mapping = suggestMapping(["Email", "E-mail"]);
    assert.deepEqual(mapping[0], { target: "email" });
    assert.equal(mapping[1].target, "field");
    assert.equal(mapping[1].fieldKey, "e_mail");
    assert.deepEqual(suggestMapping(["Email", "email"])[1], { target: "field", fieldKey: "email_field" });
  });

  test("de-duplicates custom field keys", () => {
    const keys = suggestMapping(["Email", "Tag", "tag", "TAG"]).map((m) => m.fieldKey);
    assert.deepEqual(keys, [undefined, "tag", "tag_2", "tag_3"]);
  });

  test("always produces a valid mapping when there is an email column", () => {
    const headers = ["Email", "Name", "Phone #", "Ünïcødé", "", "first_name"];
    assert.equal(validateMapping(suggestMapping(headers), headers.length), null);
  });
});

describe("validateMapping", () => {
  const ok: ColumnMapping[] = [{ target: "email" }, { target: "field", fieldKey: "company" }];

  test("accepts a valid mapping", () => assert.equal(validateMapping(ok, 2), null));

  test("requires an email column", () => {
    assert.match(validateMapping([{ target: "first_name" }, { target: "ignore" }], 2)!, /email/i);
  });

  test("rejects two columns with the same target", () => {
    assert.match(validateMapping([{ target: "email" }, { target: "email" }], 2)!, /Only one column/);
    assert.match(
      validateMapping([{ target: "email" }, { target: "first_name" }, { target: "first_name" }], 3)!,
      /First name/,
    );
  });

  test("rejects missing, invalid, reserved and duplicate field keys", () => {
    assert.match(validateMapping([{ target: "email" }, { target: "field", fieldKey: " " }], 2)!, /name/);
    assert.match(validateMapping([{ target: "email" }, { target: "field", fieldKey: "my key" }], 2)!, /letters/);
    assert.match(validateMapping([{ target: "email" }, { target: "field", fieldKey: "first_name" }], 2)!, /built-in/);
    assert.match(
      validateMapping(
        [{ target: "email" }, { target: "field", fieldKey: "city" }, { target: "field", fieldKey: "city" }],
        3,
      )!,
      /same custom field/,
    );
  });

  test("ignored columns need no key", () => {
    assert.equal(validateMapping([{ target: "email" }, { target: "ignore" }], 2), null);
  });

  test("rejects a mapping for a different number of columns", () => {
    assert.notEqual(validateMapping(ok, 3), null);
  });
});

describe("splitFullName", () => {
  test("first word is the first name, the rest the last name", () => {
    assert.deepEqual(splitFullName("Jane Doe"), { firstName: "Jane", lastName: "Doe" });
    assert.deepEqual(splitFullName("Ludwig van Beethoven"), { firstName: "Ludwig", lastName: "van Beethoven" });
  });

  test("handles 'Last, First'", () => {
    assert.deepEqual(splitFullName("Doe, Jane"), { firstName: "Jane", lastName: "Doe" });
    assert.deepEqual(splitFullName("Doe,"), { firstName: undefined, lastName: "Doe" });
  });

  test("single names and extra whitespace", () => {
    assert.deepEqual(splitFullName("  Cher "), { firstName: "Cher" });
    assert.deepEqual(splitFullName("  Mary   Ann  "), { firstName: "Mary", lastName: "Ann" });
    assert.deepEqual(splitFullName("   "), {});
  });
});

describe("mapRows", () => {
  const mapping: ColumnMapping[] = [
    { target: "email" },
    { target: "first_name" },
    { target: "last_name" },
    { target: "field", fieldKey: "company" },
    { target: "ignore" },
  ];

  test("maps cells, lower-cases emails and drops empty values", () => {
    const result = mapRows([[" Jane@Example.COM ", "Jane", "", "Acme", "secret"]], mapping);
    assert.deepEqual(result.contacts, [
      { email: "jane@example.com", firstName: "Jane", lastName: undefined, fields: { company: "Acme" } },
    ]);
    assert.equal(result.totalRows, 1);
  });

  test("skips invalid and missing emails and reports spreadsheet row numbers", () => {
    const result = mapRows(
      [
        ["ok@example.com", "A", "", "", ""],
        ["not-an-email", "B", "", "", ""],
        ["", "C", "", "", ""],
        ["also ok@example.com", "D", "", "", ""],
      ],
      mapping,
    );
    assert.deepEqual(
      result.contacts.map((c) => c.email),
      ["ok@example.com"],
    );
    assert.equal(result.invalidCount, 3);
    assert.deepEqual(result.invalid, [
      { row: 3, value: "not-an-email", reason: "Not a valid email address" },
      { row: 4, value: "", reason: "Email is missing" },
      { row: 5, value: "also ok@example.com", reason: "Not a valid email address" },
    ]);
  });

  test("caps the number of invalid examples but counts them all", () => {
    const rows = Array.from({ length: MAX_INVALID_EXAMPLES + 15 }, (_, i) => [`bad${i}`]);
    const result = mapRows(rows, [{ target: "email" }]);
    assert.equal(result.invalid.length, MAX_INVALID_EXAMPLES);
    assert.equal(result.invalidCount, MAX_INVALID_EXAMPLES + 15);
  });

  test("merges duplicate emails within the file; later non-empty values win", () => {
    const result = mapRows(
      [
        ["jane@example.com", "Jane", "Doe", "Acme", ""],
        ["JANE@example.com", "", "Smith", "", ""],
        ["jane@example.com ", "Janet", "", "Globex", ""],
        ["bob@example.com", "Bob", "", "", ""],
      ],
      mapping,
    );
    assert.equal(result.duplicateCount, 2);
    assert.deepEqual(result.contacts, [
      { email: "jane@example.com", firstName: "Janet", lastName: "Smith", fields: { company: "Globex" } },
      { email: "bob@example.com", firstName: "Bob", lastName: undefined, fields: {} },
    ]);
  });

  test("splits a full-name column without overriding explicit first/last names", () => {
    const m: ColumnMapping[] = [{ target: "full_name" }, { target: "email" }, { target: "last_name" }];
    const result = mapRows(
      [
        ["Jane Doe", "jane@example.com", ""],
        ["Bob Stone", "bob@example.com", "Stoneman"],
      ],
      m,
    );
    assert.deepEqual(
      result.contacts.map((c) => [c.firstName, c.lastName]),
      [
        ["Jane", "Doe"],
        ["Bob", "Stoneman"],
      ],
    );
  });

  test("tolerates short rows", () => {
    const result = mapRows([["jane@example.com"]], mapping);
    assert.deepEqual(result.contacts, [{ email: "jane@example.com", firstName: undefined, lastName: undefined, fields: {} }]);
  });

  test("works end-to-end with parseCsv and suggestMapping", () => {
    const { headers, rows } = parseCsv("Name,E-mail,Company\nJane Doe,JANE@EXAMPLE.COM,Acme\nBad,nope,\n");
    const mapping = suggestMapping(headers);
    assert.equal(validateMapping(mapping, headers.length), null);
    const result = mapRows(rows, mapping);
    assert.deepEqual(result.contacts, [
      { email: "jane@example.com", firstName: "Jane", lastName: "Doe", fields: { company: "Acme" } },
    ]);
    assert.equal(result.invalidCount, 1);
  });
});
