import { replacementCase, type DiffContractCase } from "./diff-contract-corpus";

/**
 * Public synthetic review stories inspired by the conversation, not user source.
 * All pair/add/delete oracles below are handwritten source line numbers. Neither
 * parsing nor rendering supplies the expected alignment. The runner also checks
 * reverse direction and shifted line numbers, so each story appears only once.
 */
export const conversationMatchingCorpus: DiffContractCase[] = [
  // Repeated argument names need local context while the list items themselves
  // change component order. New machine identifiers must stay separate.
  replacementCase(
    "conversation-option-groups-labels-and-list-keys",
    [
      "groups = [",
      "    OptionGroupLeaf(",
      '        name="Inputs and Outputs",',
      "        option_names=[",
      '            "source-input-client",',
      '            "render-output-client",',
      "        ],",
      "    ),",
      "    OptionGroupLeaf(",
      '        name="Params",',
      "        option_names=[",
      '            "legacy-pool-renderer",',
      '            "gpu-trees-renderer",',
      "        ],",
      "    ),",
      "]",
    ],
    [
      "groups = [",
      "    OptionGroupLeaf(",
      '        name="Входы и выходы",',
      '        code="inputs_and_outputs",',
      "        option_names=[",
      '            "client-source-input",',
      '            "client-render-output",',
      "        ],",
      "    ),",
      "    OptionGroupLeaf(",
      '        name="Основное",',
      '        code="main",',
      "        option_names=[",
      '            "renderer-pool",',
      '            "renderer-gpu-trees",',
      '            "renderer-system-prompt",',
      "        ],",
      "    ),",
      "]",
    ],
    {
      pairs: [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        [8, 9],
        [9, 10],
        [10, 11],
        [11, 13],
        [12, 14],
        [13, 15],
        [14, 17],
        [15, 18],
        [16, 19],
      ],
      added: [4, 12, 16],
    },
  ),
  // Both the keyword and the list acquire an insertion before their related row.
  replacementCase(
    "conversation-insertions-before-label-and-key",
    [
      "build_options(",
      '    name="Advanced",',
      "    option_names=[",
      '        "worker-pool-console",',
      '        "gpu-trees-console",',
      "    ],",
      ")",
      "final = ready()",
    ],
    [
      "build_options(",
      '    code="advanced",',
      '    name="Расширенные",',
      "    option_names=[",
      '        "console-system-message",',
      '        "console-worker-pool",',
      '        "console-gpu-trees",',
      "    ],",
      ")",
      "final = ready()",
    ],
    {
      oldStart: 31,
      newStart: 51,
      pairs: [
        [31, 51],
        [32, 53],
        [33, 54],
        [34, 56],
        [35, 57],
        [36, 58],
        [37, 59],
        [38, 60],
      ],
      added: [52, 55],
    },
  ),
  // Removing long checker comments and unwrapping the import are one edit;
  // a removed import must not stand in for the newly introduced module.
  replacementCase(
    "conversation-unwrapped-imports-and-checker-comments",
    [
      "import obsolete  # checker: ignore[unresolved-import, missing-module]",
      "from .widgets import (  # checker: ignore[unresolved-import, missing-module]",
      "    Alpha,",
      "    Beta,",
      ")",
      "import runtime  # checker: ignore[unresolved-import, missing-module]",
      "",
      "def load():",
      "    return Alpha()",
    ],
    ["from .widgets import Alpha, Beta", "import runtime", "import metrics", "", "def load():", "    return Alpha()"],
    {
      pairs: [
        [2, 1],
        [6, 2],
        [8, 5],
        [9, 6],
      ],
      removed: [1, 3, 4, 5],
      added: [3],
    },
  ),
  // Lexical proximity to another long module must not outweigh module identity.
  replacementCase(
    "conversation-similar-module-before-unwrapped-header",
    [
      "from .worker_registry_cache_primary import Model, Builder",
      "from .worker_registry_cache_primars import (  # checker: ignore[unresolved-import]",
      "    Model,",
      "    Builder,",
      ")",
      "def build():",
      "    return Builder()",
    ],
    ["from .worker_registry_cache_primars import Model, Builder", "def build():", "    return Builder()"],
    {
      pairs: [
        [2, 1],
        [6, 2],
        [7, 3],
      ],
      removed: [1, 3, 4, 5],
    },
  ),
  // A rewritten guard and its early return stay together while annotations
  // disappear from the whole method and a real logging statement is added.
  replacementCase(
    "conversation-guard-return-and-annotation-removal",
    [
      "def resolve(value, cache):",
      "    if not exists(value):  # checker: ignore[invalid-argument-type]",
      "        return None  # checker: ignore[return-value-type]",
      "    candidate = cache.get(value)  # checker: ignore[unknown-member]",
      "    if candidate is None:  # checker: ignore[unnecessary-comparison]",
      "        return value  # checker: ignore[return-value-type]",
      "    return candidate  # checker: ignore[return-value-type]",
    ],
    [
      "def resolve(value, cache):",
      "    if value is None:",
      "        return None",
      "    candidate = cache.get(value)",
      "    if candidate is None:",
      "        return value",
      "    audit(candidate)",
      "    return candidate",
    ],
    {
      pairs: [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
        [6, 6],
        [7, 8],
      ],
      added: [7],
    },
  ),
  // Literal hashes remain source text beside the annotation-cleanup/guard edit.
  replacementCase(
    "conversation-literal-hash-beside-rewritten-guard",
    [
      "def label(value):",
      '    text = "# not an annotation"',
      "    if not exists(value):  # checker: ignore[invalid-argument-type]",
      "        return text  # checker: ignore[return-value-type]",
      "    return value  # checker: ignore[return-value-type]",
    ],
    [
      "def label(value):",
      '    text = "# not an annotation"',
      "    if value is None:",
      "        return text",
      "    audit(text)",
      "    return value",
    ],
    {
      pairs: [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 6],
      ],
      added: [5],
    },
  ),
  // A moved long URL is not a stronger identity than the surviving decorated
  // class. The earlier, similar class and its constructor really disappear.
  replacementCase(
    "conversation-decorated-rename-removed-class-and-url",
    [
      '@REGISTRY.register("worker_heavy")',
      "class HeavyWorker(Service):",
      '    """Heavy worker from',
      '    public/worker/registry."""',
      "    def __init__(self):",
      '        super().__init__(mode="heavy")',
      "",
      "# Worker size matches.",
      "# https://example.invalid/public/worker/registry.py?rev=123456789",
      '@REGISTRY.register("worker_light")',
      "class LightWorker(Service):",
      '    """Emulates the light worker from',
      '    public/worker/registry."""',
      "    def __init__(self):",
      '        super().__init__(mode="light")',
    ],
    [
      '@REGISTRY.register("worker_light_v2")',
      "class Config_Light_Worker(Service):",
      '    """Legacy light worker from',
      "    public/worker/registry.",
      "    https://example.invalid/public/worker/registry.py?rev=123456789",
      '    """',
      "    def __init__(self):",
      '        super().__init__(mode="light")',
    ],
    {
      pairs: [
        [10, 1],
        [11, 2],
        [12, 3],
        [13, 4],
        [14, 7],
        [15, 8],
      ],
      removed: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      added: [5, 6],
    },
  ),
  // Duplicate constructor bodies below the survivor cannot become its context;
  // the added docstring also must not absorb a deleted test-class line.
  replacementCase(
    "conversation-surviving-constructor-before-duplicate-tests",
    [
      '@REGISTRY.register("small")',
      "class SmallWorker(Service):",
      "    def __init__(self):",
      '        super().__init__(mode="small")',
      "",
      "class TestOne(Service):",
      "    def __init__(self):",
      '        super().__init__(mode="small")',
      "",
      "class TestTwo(Service):",
      "    def __init__(self):",
      '        super().__init__(mode="small")',
    ],
    [
      '@REGISTRY.register("small")',
      "class SmallWorker(Service):",
      '    """Kept for compatibility."""',
      "    def __init__(self):",
      '        super().__init__(mode="small")',
    ],
    {
      pairs: [
        [1, 1],
        [2, 2],
        [3, 4],
        [4, 5],
      ],
      removed: [5, 6, 7, 8, 9, 10, 11, 12],
      added: [3],
    },
  ),
  // A removed method and inserted documentation have no positional relationship,
  // even though they occupy the same gap between a class and a retained method.
  replacementCase(
    "conversation-constructor-replaced-by-unrelated-docstring",
    [
      "class Worker(Service):",
      "    def __init__(self):",
      "        super().__init__(config=Config())",
      "    def run(self):",
      "        return self.ready()",
    ],
    [
      "class Worker(Service):",
      '    """Worker configured externally by callers.',
      "    Keeps behavior of the run method.",
      '    """',
      "    def run(self):",
      "        return self.ready()",
    ],
    {
      pairs: [
        [1, 1],
        [4, 5],
        [5, 6],
      ],
      removed: [2, 3],
      added: [2, 3, 4],
    },
  ),
  // Nearby real code anchors do not make unrelated comments/prose a replacement.
  replacementCase(
    "conversation-unrelated-prose-between-code-anchors",
    [
      "def notes():",
      "    # aaaa bbbb cccc",
      '    "old prose describes optional inputs"',
      '    emit("ready")',
      "    return 1",
    ],
    [
      "def notes():",
      "    # xxxx yyyy zzzz",
      '    "new sentence discusses network errors"',
      '    emit("ready")',
      '    report("created")',
      "    return 1",
    ],
    {
      pairs: [
        [1, 1],
        [4, 4],
        [5, 6],
      ],
      removed: [2, 3],
      added: [2, 3, 5],
    },
  ),
  // A real component rename must not pull short keys, comments or a namespace-
  // sharing new entry into its alignment merely because they are adjacent.
  replacementCase(
    "conversation-strong-list-rename-with-weak-neighbors",
    ["option_names = [", '    "alpha-beta-worker",', '    "a-b-c",', "    # xxxxxxxxxx", "]"],
    [
      "option_names = [",
      '    "worker-beta-alpha",',
      '    "c-b-a-unrelated",',
      "    # yyyyyyyyyy",
      '    "worker-system-message",',
      "]",
    ],
    {
      pairs: [
        [1, 1],
        [2, 2],
        [5, 6],
      ],
      removed: [3, 4],
      added: [3, 4, 5],
    },
  ),
];
