import { describe, expect, test } from "vitest";
import type { Board } from "./board.ts";
import { lintBoardText, lintDuplicateEdges } from "./lint-text.ts";

function board(label: string, extra: Partial<Board["nodes"][number]> = {}): Board {
  return {
    schemaVersion: 1,
    title: "t",
    question: "q",
    groups: [],
    nodes: [{ id: "n", kind: "note", label, sourceIds: [], ...extra }],
    edges: [],
    sources: [],
  };
}

describe("lintBoardText", () => {
  test.each([
    ["Contact jane.doe@example.com", /email address/],
    ["Card 4111 1111 1111 1111", /card number/],
    ["Call +84 912 345 678", /phone number/],
    ["Saved to /home/alice/shots/cart.png", /absolute local path/],
    ["Saved to C:\\Users\\alice", /absolute local path/],
    ["Copied from /Users/bob/Desktop/x.png", /absolute local path/],
    ["Run from /home/alice", /absolute local path/],
    ["cwd=/Users/bob", /absolute local path/],
  ])("warns about %s", (label, pattern) => {
    const warnings = lintBoardText(board(label));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^nodes\[0\]\.label /);
    expect(warnings[0]).toMatch(pattern);
  });

  test.each([
    "Customer email",
    "Total (VND)",
    "Order #1234",
    "Step 12 of 30",
    "src/cart.ts:12",
    'to: "/_authenticated/ineligible/home/"',
    'to: "/_authenticated/home/dashboard/"',
    'to: "/home/"',
    "Opens /home/ after sign-in",
  ])("does not warn about placeholder text %s", (label) => {
    expect(lintBoardText(board(label))).toEqual([]);
  });

  test("checks action and unresolved too", () => {
    const warnings = lintBoardText(board("Pay", { action: "emails bob@shop.io" }));
    expect(warnings[0]).toMatch(/^nodes\[0\]\.action /);
  });
});

describe("lintBoardText on sources", () => {
  const withSources = (sources: Board["sources"]): Board => ({ ...board("Pay"), sources });

  test("warns when a code source cites a document", () => {
    for (const path of ["docs/requirements.md", "README.md", "spec/notes.txt", "a/docs/x.ts"]) {
      const warnings = lintBoardText(
        withSources([{ id: "s", kind: "code", path, line: 1, quote: "x" }]),
      );
      expect(warnings, path).toHaveLength(1);
      expect(warnings[0]).toMatch(/^sources\[0\]\.path cites a document as code.*kind "doc"/);
    }
    expect(
      lintBoardText(
        withSources([{ id: "s", kind: "doc", path: "docs/a.md", line: 1, quote: "x" }]),
      ),
    ).toEqual([]);
    expect(
      lintBoardText(withSources([{ id: "s", kind: "code", path: "src/doc.ts", line: 1 }])),
    ).toEqual([]);
  });

  test("checks quotes, link titles and URLs, and mockup labels", () => {
    const warnings = lintBoardText(
      withSources([
        { id: "a", kind: "code", path: "src/a.ts", line: 1, quote: "send to bob@shop.io" },
        { id: "b", kind: "doc", path: "docs/a.md", line: 1, quote: "Call +84 912 345 678" },
        { id: "c", kind: "link", url: "https://x.example/u/jane%40example.com", title: "Doc" },
        { id: "d", kind: "link", url: "https://x.example/d", title: "Jane jane@example.com" },
        { id: "e", kind: "mockup", label: "Mockup for jane@example.com" },
      ]),
    );
    expect(warnings.map((w) => w.split(" ")[0])).toEqual([
      "sources[0].quote",
      "sources[1].quote",
      "sources[2].url",
      "sources[3].title",
      "sources[4].label",
    ]);
  });

  test("does not read a URL path like /home/ as a local path", () => {
    expect(
      lintBoardText(
        withSources([{ id: "c", kind: "link", url: "https://x.example/home/docs", title: "Doc" }]),
      ),
    ).toEqual([]);
  });
});

describe("lintDuplicateEdges", () => {
  const edge = (id: string, extra: Partial<Board["edges"][number]> = {}) => ({
    id,
    from: "a",
    to: "b",
    kind: "navigates" as const,
    label: "opens",
    sourceIds: [id],
    ...extra,
  });

  test("warns when an edge repeats an earlier one and names both", () => {
    const warnings = lintDuplicateEdges({ edges: [edge("e1"), edge("e2"), edge("e3")] });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^edges\[1\] \(`e2`\) repeats edges\[0\] \(`e1`\).*merge them/);
    expect(warnings[1]).toMatch(/^edges\[2\] \(`e3`\) repeats edges\[0\]/);
  });

  test("does not warn when the target, kind or label differs", () => {
    expect(
      lintDuplicateEdges({
        edges: [
          edge("e1"),
          edge("e2", { to: "c" }),
          edge("e3", { kind: "flow" }),
          edge("e4", { label: "back" }),
          edge("e5", { to: undefined, toRef: "web:b" }),
          edge("e6", { from: "c" }),
        ],
      }),
    ).toEqual([]);
  });

  test("reaches validate warnings through lintBoardText", () => {
    const b: Board = { ...board("Pay"), edges: [edge("e1"), edge("e2")] };
    b.nodes = [
      { id: "a", kind: "note", label: "A", sourceIds: [] },
      { id: "b", kind: "note", label: "B", sourceIds: [] },
    ];
    expect(lintBoardText(b)).toEqual([expect.stringMatching(/^edges\[1\] /)]);
  });
});

/**
 * Fake credentials, assembled at runtime from split pieces so the repository holds no string a
 * secret scanner would report. The bodies are a fixed, obviously fake run of letters and digits.
 */
const body = (n: number) => "Fake0Value1Not2Real3".repeat(4).slice(0, n);
const join = (...parts: string[]) => parts.join("");
const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const FAKE = {
  pem: join(
    "-----BEGIN ",
    "RSA PRIVATE",
    " KEY-----\n",
    body(40),
    "\n-----END RSA ",
    "PRIVATE KEY-----",
  ),
  pemEscaped: join("-----BEGIN ", "PRIVATE", " KEY-----\\n", body(40)),
  aws: join("AK", "IA", body(16).toUpperCase()),
  githubClassic: join("gh", "p_", body(36)),
  githubServer: join("gh", "s_", body(36)),
  githubFine: join("github", "_pat_", body(22), "_", body(40)),
  slack: join("xo", "xb-", "1234567890-", body(24)),
  stripe: join("sk", "_live_", body(24)),
  stripeRestricted: join("rk", "_live_", body(24)),
  jwt: [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: "fake-user" }), body(20)].join("."),
  password: join("hunter", "2", "Fake!"),
};

describe("lintBoardText on secrets", () => {
  const warn = (label: string) => lintBoardText(board(label));

  test.each([
    ["a PEM private key block", FAKE.pem, "a private key"],
    ["a PEM block quoted from a JSON string", `const key = "${FAKE.pemEscaped}"`, "a private key"],
    ["an AWS access key id", `aws key ${FAKE.aws}`, "an AWS access key id"],
    ["a classic GitHub token", `token ${FAKE.githubClassic}`, "a GitHub token"],
    ["a GitHub server token", FAKE.githubServer, "a GitHub token"],
    ["a fine-grained GitHub token", FAKE.githubFine, "a GitHub token"],
    ["a Slack token", `bot ${FAKE.slack}`, "a Slack token"],
    ["a Stripe secret key", FAKE.stripe, "a Stripe secret key"],
    ["a Stripe restricted key", FAKE.stripeRestricted, "a Stripe secret key"],
    ["a JWT", `Authorization: Bearer ${FAKE.jwt}`, "a JWT"],
    ["a quoted password", `password: "${FAKE.password}"`, "a password or secret assigned"],
    ["an env-file token", `API_TOKEN=${body(12)}`, "a password or secret assigned"],
    ["a JSON client secret", `"client_secret": "${body(10)}"`, "a password or secret assigned"],
    ["an api key constant", `const apiKey = '${body(10)}';`, "a password or secret assigned"],
    ["a private key setting", `PRIVATE_KEY := "${body(10)}"`, "a password or secret assigned"],
  ])("warns about %s and names its kind", (_, label, kind) => {
    const warnings = warn(label);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^nodes\[0\]\.label looks like it contains /);
    expect(warnings[0]).toContain(kind);
    expect(warnings[0]).toContain('"<redacted>"');
  });

  test.each([
    [
      "a PEM header with no key material",
      join('if (pem.startsWith("-----BEGIN ', "PRIVATE", ' KEY-----"))'),
    ],
    ["a PEM public key", join("-----BEGIN PUBLIC", " KEY-----\n", body(20))],
    ["AWS's documented sample key", join("AK", "IA", "IOSFODNN7", "EXAMPLE")],
    ["an AWS-like id that is too short", join("AK", "IA", "1234ABCD")],
    ["a GitHub prefix with no token", "tokens start with ghp_ or github_pat_"],
    ["a GitHub placeholder token", join("gh", "p_", "x".repeat(36))],
    ["a Slack prefix with a placeholder", "set SLACK_BOT to xoxb-your-bot-token"],
    ["a Stripe test key", join("sk", "_test_", body(16))],
    ["a Stripe placeholder", join("sk", "_live_", "x".repeat(24))],
    ["a JWT header alone", b64url({ alg: "none" })],
    ["two base64url parts", [b64url({ alg: "HS256" }), b64url({ sub: "x" })].join(".")],
  ])("does not warn about %s", (_, label) => {
    expect(warn(label)).toEqual([]);
  });

  test.each([
    "password: <password>",
    'token: "<token>"',
    'password: "***"',
    "API_TOKEN=xxx",
    "API_TOKEN=xxxxxxxxxxxx",
    'password: "changeme"',
    'password = "change-me-2"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the text under test is a placeholder written this way
    "DB_PASSWORD=${DB_PASSWORD}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the text under test is a placeholder written this way
    'apiKey: "${API_KEY}"',
    "SECRET_KEY=$SECRET_KEY",
    'token: "{{ token }}"',
    "const token = process.env.API_TOKEN;",
    "apiKey: import.meta.env.VITE_API_KEY",
    'password = os.environ["DB_PASSWORD"]',
    'secret: "<redacted>"',
    'api_key = "your_api_key_here"',
    'token: "example-token-1"',
  ])("does not warn about the placeholder %s", (label) => {
    expect(warn(label)).toEqual([]);
  });

  test.each([
    "const token = await getToken(user);",
    "if (password === input) return true;",
    "password: req.body.password",
    "token: string",
    "password: z.string().min(8)",
    "const { accessToken } = session;",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the text under test is a placeholder written this way
    "headers: { Authorization: `Bearer ${token}` }",
    "TOKEN_TTL=3600",
    'passwordLabel: "Mật khẩu"',
    'tokenType: "Bearer"',
    'tokenExpiresIn: "15m"',
    'passwordKey: "auth.password"',
    "resetToken = generateResetToken()",
    "Reset password via emailed token",
  ])("does not warn about code that names a secret %s", (label) => {
    expect(warn(label)).toEqual([]);
  });

  test("never prints the matched value", () => {
    for (const value of [
      FAKE.pem,
      FAKE.aws,
      FAKE.githubClassic,
      FAKE.githubFine,
      FAKE.slack,
      FAKE.stripe,
      FAKE.jwt,
      FAKE.password,
    ]) {
      const warnings = lintBoardText({
        ...board(`password: "${value}"`),
        sources: [
          { id: "s", kind: "code", path: "src/a.ts", line: 1, quote: `secret = "${value}"` },
        ],
      });
      expect(warnings).toHaveLength(2);
      for (const w of warnings) {
        expect(w).not.toContain(value);
        expect(w).not.toContain(value.slice(4, 16));
      }
    }
  });

  test("checks link URLs and edge labels for secrets", () => {
    const b: Board = {
      ...board("Pay"),
      edges: [{ id: "e", from: "n", to: "n", kind: "flow", label: FAKE.slack, sourceIds: [] }],
      sources: [
        { id: "s", kind: "link", url: `https://x.example/cb?token=${FAKE.jwt}`, title: "cb" },
      ],
    };
    const warnings = lintBoardText(b);
    expect(warnings.find((w) => w.startsWith("edges[0].label"))).toContain("a Slack token");
    expect(warnings.find((w) => w.startsWith("sources[0].url"))).toContain("a JWT");
  });

  test("still reports a long mixed token with no vendor prefix as an access token", () => {
    expect(warn(`key ${body(40)}`)[0]).toContain("an access token");
  });
});

describe("lintBoardText on long text", () => {
  // Shapes that made a pattern rescan a long run from every start position. Built at runtime.
  const N = 40_000;
  const rep = (unit: string) => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
  test.each([
    ["letters", rep("a")],
    ["digits", rep("1")],
    ["dashes", rep("-")],
    ["digit and dash runs", rep("1-")],
    ["word characters with underscores", rep("ab_")],
    ["a repeated AWS prefix", rep("AKIA")],
    ["a repeated GitHub prefix", rep(["gh", "p_"].join(""))],
    ["a repeated keyword in one name", rep("token")],
    ["repeated api-key names", rep("x-api-key-")],
    ["an assignment chain", rep("a=")],
    ["repeated scheme separators", rep("a://")],
    ["repeated at signs", rep("a@b.")],
  ])("lints %s quickly", (_, label) => {
    const started = performance.now();
    lintBoardText(board(label));
    expect(performance.now() - started).toBeLessThan(200);
  });

  test("still reads a secret assigned to an api-key name", () => {
    const value = ["Fake0", "Value1", "Not2"].join("");
    expect(lintBoardText(board(`x-api-key: "${value}"`))[0]).toContain("a password or secret");
  });

  test("does not let a plain assignment hide a secret one after it", () => {
    const value = ["Fake0", "Value1", "Not2"].join("");
    const label = `mode: process.env.X1private_key: "${value}"`;
    expect(lintBoardText(board(label))[0]).toContain("a password or secret");
  });
});
