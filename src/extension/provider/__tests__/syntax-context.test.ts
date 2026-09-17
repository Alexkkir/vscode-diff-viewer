import { pythonHunkPrefix } from "../syntax-context";

describe("partial Python string context", () => {
  it("recovers a fragment ending with a triple-quote argument terminator", () => {
    expect(pythonHunkPrefix(["SELECT {column}", '    """,', "    output,", ")", "if ready:"])).toBe('f"""');
    expect(pythonHunkPrefix(["text", "''')"])).toBe("f'''");
  });
  it("does not seed normal opening strings or ambiguous standalone quotes", () => {
    for (const lines of [
      ['query = f"""', "SELECT 1", '""",'],
      ['    f"""', "SELECT 1", '"""'],
      ['"""'],
      ['"""one line"""'],
      ['# """,', "if ready:"],
    ]) {
      expect(pythonHunkPrefix(lines)).toBeUndefined();
    }
  });
});
